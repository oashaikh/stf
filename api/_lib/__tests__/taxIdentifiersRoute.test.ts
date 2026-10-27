import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createTaxIdentifiersHandler } from '../../settings/tax-identifiers';
import type { AuthDeps } from '../auth';
import { maskNino, maskUtr, type StoredTaxIdentifiers, type TaxIdentifiersStore } from '../taxIdentifiers';
import { decryptToken } from '../../../server/src/lib/hmrcCrypto';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

describe('masking', () => {
  it('keeps only the tail of each identifier', () => {
    expect(maskNino('AB123456C')).toBe('••••••56C');
    expect(maskUtr('1234567890')).toBe('••••••7890');
  });
});

describe('tax-identifiers route', () => {
  let rows: Record<string, StoredTaxIdentifiers>;
  const store: TaxIdentifiersStore = {
    get: async (userId) => rows[userId],
    update: async (userId, patch) => (userId in rows ? (rows[userId] = { ...rows[userId], ...patch }) : undefined),
  };
  const call = (method: string, body?: unknown, userId?: string, query = '') =>
    createTaxIdentifiersHandler(store, authDeps)(
      new Request(`https://app.test/api/settings/tax-identifiers${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );

  beforeEach(() => {
    vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    rows = { u1: { ninoEncrypted: null, utrEncrypted: null }, u2: { ninoEncrypted: null, utrEncrypted: null } };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('requires sign-in', async () => {
    expect((await call('GET')).status).toBe(401);
    expect((await call('PUT', { utr: '1234567890' })).status).toBe(401);
  });

  it('stores both values encrypted and returns only masked forms', async () => {
    const response = await call('PUT', { nino: 'ab 12 34 56 c', utr: '12345 67890' }, 'u1');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: true, nino: '••••••56C', utr: '••••••7890' });
    expect(text).not.toContain('123456');
    expect(rows.u1.ninoEncrypted).not.toContain('AB');
    expect(decryptToken(rows.u1.ninoEncrypted!)).toBe('AB123456C');
    expect(decryptToken(rows.u1.utrEncrypted!)).toBe('1234567890');
  });

  it('reads only the caller values, ignoring a client-supplied id', async () => {
    await call('PUT', { utr: '1234567890' }, 'u2');
    const body = await (await call('GET', undefined, 'u1', '?userId=u2')).json();
    expect(body).toEqual({ ok: true, nino: null, utr: null });
    expect(rows.u2.utrEncrypted).not.toBeNull();
  });

  it('leaves a field alone when omitted and clears it when blank', async () => {
    await call('PUT', { nino: 'AB123456C', utr: '1234567890' }, 'u1');
    const kept = await (await call('PUT', { utr: '' }, 'u1')).json();
    expect(kept).toEqual({ ok: true, nino: '••••••56C', utr: null });
  });

  it.each([
    ['short NINO', { nino: 'AB12345C' }],
    ['NINO with banned prefix', { nino: 'BG123456C' }],
    ['NINO with bad suffix', { nino: 'QQ123456E' }],
    ['NINO using letter O', { nino: 'OO123456C' }],
    ['nine-digit UTR', { utr: '123456789' }],
    ['eleven-digit UTR', { utr: '12345678901' }],
    ['lettered UTR', { utr: '12345678AB' }],
    ['non-string UTR', { utr: 1234567890 }],
  ])('refuses %s without storing anything', async (_name, body) => {
    const response = await call('PUT', body, 'u1');
    expect(response.status).toBe(400);
    expect(rows.u1).toEqual({ ninoEncrypted: null, utrEncrypted: null });
  });

  it('refuses other methods and unknown users', async () => {
    expect((await call('DELETE', undefined, 'u1')).status).toBe(405);
    expect((await call('GET', undefined, 'u9')).status).toBe(404);
  });
});
