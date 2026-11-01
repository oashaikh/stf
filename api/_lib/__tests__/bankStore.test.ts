import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptToken } from '../../../server/src/lib/hmrcCrypto';

// Records what the store sends to the database; select resolves to `selected`.
const calls = vi.hoisted(() => ({
  inserted: [] as Record<string, string>[],
  conflict: [] as unknown[],
  updated: [] as Record<string, unknown>[],
  wheres: [] as SQL[],
  limits: [] as number[],
  selected: [] as unknown[],
}));

vi.mock('../db.js', () => {
  const selectChain = {
    from: () => selectChain,
    where: (condition: SQL) => (calls.wheres.push(condition), selectChain),
    orderBy: () => selectChain,
    limit: async (count: number) => (calls.limits.push(count), calls.selected),
  };
  return {
    db: {
      insert: () => ({
        values: (values: Record<string, string>) => (calls.inserted.push(values), { onConflictDoUpdate: async (config: unknown) => void calls.conflict.push(config) }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => (calls.updated.push(values), { where: async (condition: SQL) => void calls.wheres.push(condition) }),
      }),
      select: () => selectChain,
    },
  };
});

import { databaseBankStore } from '../bankStore';

const dialect = new PgDialect();
const render = (condition: SQL) => dialect.sqlToQuery(condition);

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  Object.assign(calls, { inserted: [], conflict: [], updated: [], wheres: [], limits: [], selected: [] });
});

describe('databaseBankStore', () => {
  it('stores both tokens as ciphertext that decrypts to the plaintext', async () => {
    await databaseBankStore.save('u1', {
      providerAccountId: 'acc-1',
      displayName: 'Sandbox Current',
      maskedAccountNumber: '5678',
      consentExpiresAt: new Date('2027-01-30T00:00:00Z'),
      accessToken: 'access-plain',
      refreshToken: 'refresh-plain',
      tokenExpiresAt: new Date('2026-11-01T11:00:00Z'),
    });
    const [row] = calls.inserted;
    expect(row.userId).toBe('u1');
    expect(row.accessTokenEncrypted).not.toContain('access-plain');
    expect(row.refreshTokenEncrypted).not.toContain('refresh-plain');
    expect(decryptToken(row.accessTokenEncrypted)).toBe('access-plain');
    expect(decryptToken(row.refreshTokenEncrypted)).toBe('refresh-plain');
  });

  it('soft-deletes: sets deleted_at, blanks the ciphertext and filters on the user id', async () => {
    await databaseBankStore.disconnect('u1');
    const [set] = calls.updated;
    expect(set.deletedAt).toBeInstanceOf(Date);
    expect(set.accessTokenEncrypted).toBe('');
    expect(set.refreshTokenEncrypted).toBe('');
    expect(render(calls.wheres[0]).params).toContain('u1');
  });

  it('status query is scoped to the user, bounded, and returns no token', async () => {
    calls.selected = [{ displayName: 'Sandbox Current', maskedAccountNumber: '5678', consentExpiresAt: new Date(Date.now() - 1000) }];
    const status = await databaseBankStore.status('u1');
    expect(render(calls.wheres[0]).params).toContain('u1');
    expect(calls.limits).toEqual([1]);
    expect(status.expired).toBe(true);
    expect(JSON.stringify(status)).not.toMatch(/token/i);
  });

  it('status is not connected when there is no active row', async () => {
    expect(await databaseBankStore.status('u1')).toMatchObject({ connected: false, expired: false });
  });
});
