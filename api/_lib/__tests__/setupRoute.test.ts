import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createSetupHandler } from '../../settings/setup';
import type { AuthDeps } from '../auth';
import type { SetupProgress, SetupProgressStore } from '../setupProgress';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

describe('setup route', () => {
  let rows: Record<string, SetupProgress & { vatNumber: string | null }>;
  const now = new Date('2026-11-02T10:00:00Z');
  const store: SetupProgressStore = {
    get: async (userId) => {
      const row = rows[userId];
      return row && { businessType: row.businessType, vatRegistered: row.vatRegistered, skippedSteps: row.skippedSteps, finishedAt: row.finishedAt };
    },
    update: async (userId, update, finishedAt) => {
      const row = rows[userId];
      if (update.businessType) row.businessType = update.businessType;
      if (update.vatRegistered !== undefined) row.vatRegistered = update.vatRegistered;
      if (update.skippedSteps) row.skippedSteps = update.skippedSteps;
      if (update.finish) row.finishedAt = finishedAt;
    },
  };
  const call = (method: string, body?: unknown, userId?: string) =>
    createSetupHandler(store, authDeps, () => now)(
      new Request('https://app.test/api/settings/setup', {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );

  beforeEach(() => {
    rows = {
      u1: { businessType: 'sole_trader', vatRegistered: null, skippedSteps: [], finishedAt: null, vatNumber: '123456789' },
      u2: { businessType: 'partnership', vatRegistered: true, skippedSteps: ['bank'], finishedAt: null, vatNumber: null },
    };
  });

  it('refuses unauthenticated reads and writes without touching the row', async () => {
    const before = JSON.stringify(rows);
    expect((await call('GET')).status).toBe(401);
    expect((await call('POST', { vatRegistered: true, finish: true })).status).toBe(401);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('returns only the four fields for the caller', async () => {
    const response = await call('GET', undefined, 'u2');
    expect(await response.json()).toEqual({
      ok: true,
      businessType: 'partnership',
      vatRegistered: true,
      skippedSteps: ['bank'],
      finishedAt: null,
    });
  });

  it.each([
    { businessType: 'charity' },
    { vatRegistered: 'no' },
    { skippedSteps: ['nope'] },
    { skippedSteps: ['vat', 'vat'] },
  ])('returns 400 for %j and changes nothing', async (body) => {
    const before = JSON.stringify(rows);
    expect((await call('POST', body, 'u1')).status).toBe(400);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('returns 400 for a body that is not JSON', async () => {
    const response = await createSetupHandler(store, authDeps, () => now)(
      new Request('https://app.test/api/settings/setup', { method: 'POST', body: 'x', headers: { cookie: 'stf_session=tok-u1' } }),
    );
    expect(response.status).toBe(400);
  });

  it('saves answers for the caller only', async () => {
    const response = await call('POST', { businessType: 'limited_company', skippedSteps: ['hmrc'] }, 'u1');
    expect(await response.json()).toMatchObject({ businessType: 'limited_company', skippedSteps: ['hmrc'] });
    expect(rows.u2.businessType).toBe('partnership');
  });

  it('sets finishedAt on the server and ignores a client timestamp', async () => {
    const response = await call('POST', { finish: true, finishedAt: '2001-01-01T00:00:00Z' }, 'u1');
    expect((await response.json()).finishedAt).toBe(now.toISOString());
    expect(rows.u1.finishedAt).toEqual(now);
    expect(rows.u2.finishedAt).toBeNull();
  });

  it('leaves an existing VAT number alone when vatRegistered becomes false', async () => {
    await call('POST', { vatRegistered: false }, 'u1');
    expect(rows.u1.vatRegistered).toBe(false);
    expect(rows.u1.vatNumber).toBe('123456789');
  });

  it('refuses other methods', async () => {
    expect((await call('DELETE', undefined, 'u1')).status).toBe(405);
  });
});
