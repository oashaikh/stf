import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createTradingAllowanceHandler } from '../../settings/trading-allowance';
import type { AuthDeps } from '../auth';
import type { TradingAllowanceMethod, TradingAllowanceStore } from '../tradingAllowance';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const taxYear = '2025-26';

describe('trading-allowance route', () => {
  // Same shape as the database store: one row per (user, year), audit only on a change.
  let rows: Map<string, TradingAllowanceMethod>;
  let audits: { userId: string; before: string | null; after: string }[];
  const key = (userId: string, year: string) => `${userId}|${year}`;
  const store: TradingAllowanceStore = {
    get: async (userId, year) => rows.get(key(userId, year)),
    set: async (userId, year, method) => {
      const before = rows.get(key(userId, year));
      if (before !== method) {
        rows.set(key(userId, year), method);
        audits.push({ userId, before: before ?? null, after: method });
      }
      return method;
    },
  };
  const call = (method: string, body?: unknown, userId?: string, query = '') =>
    createTradingAllowanceHandler(store, authDeps)(
      new Request(`https://app.test/api/settings/trading-allowance${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );
  const reset = () => {
    rows = new Map();
    audits = [];
  };

  it('requires sign-in', async () => {
    reset();
    expect((await call('GET', undefined, undefined, `?taxYear=${taxYear}`)).status).toBe(401);
    expect((await call('PUT', { taxYear, method: 'allowance' })).status).toBe(401);
    expect(rows.size).toBe(0);
  });

  it('defaults to actual expenses until the owner chooses', async () => {
    reset();
    expect(await (await call('GET', undefined, 'u1', `?taxYear=${taxYear}`)).json()).toEqual({ ok: true, method: 'actual' });
  });

  it.each([
    ['unknown tax year', { taxYear: '2099-00', method: 'allowance' }],
    ['malformed tax year', { taxYear: '2025/26', method: 'allowance' }],
    ['inherited property as year', { taxYear: 'constructor', method: 'allowance' }],
    ['unknown method', { taxYear, method: 'flat' }],
    ['missing method', { taxYear }],
    ['no body', null],
  ])('rejects a PUT with %s', async (_name, body) => {
    reset();
    const response = await call('PUT', body, 'u1');
    expect(response.status).toBe(400);
    expect(rows.size).toBe(0);
  });

  it('rejects a GET with a missing or bad tax year', async () => {
    reset();
    expect((await call('GET', undefined, 'u1')).status).toBe(400);
    expect((await call('GET', undefined, 'u1', '?taxYear=1999-00')).status).toBe(400);
  });

  it('rejects other methods', async () => {
    reset();
    expect((await call('DELETE', undefined, 'u1')).status).toBe(405);
  });

  it("never shows or changes another user's choice, and ignores a client-supplied id", async () => {
    reset();
    await call('PUT', { taxYear, method: 'allowance' }, 'u2');
    const read = await call('GET', undefined, 'u1', `?taxYear=${taxYear}&userId=u2`);
    expect((await read.json()).method).toBe('actual');
    await call('PUT', { taxYear, method: 'actual', userId: 'u2' }, 'u1', '?userId=u2');
    expect(rows.get(key('u2', taxYear))).toBe('allowance');
    expect(rows.get(key('u1', taxYear))).toBe('actual');
  });

  it('writes an audit event on a change and none on a no-op, leaving one row', async () => {
    reset();
    await call('PUT', { taxYear, method: 'allowance' }, 'u1');
    await call('PUT', { taxYear, method: 'allowance' }, 'u1');
    expect(audits).toEqual([{ userId: 'u1', before: null, after: 'allowance' }]);
    await call('PUT', { taxYear, method: 'actual' }, 'u1');
    expect(audits).toHaveLength(2);
    expect(audits[1]).toEqual({ userId: 'u1', before: 'allowance', after: 'actual' });
    expect(rows.size).toBe(1);
    expect(await (await call('GET', undefined, 'u1', `?taxYear=${taxYear}`)).json()).toEqual({ ok: true, method: 'actual' });
  });
});
