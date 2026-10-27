import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createProfitAndLossHandler } from '../../profit-and-loss';
import type { AuthDeps } from '../auth';
import type { ProfitAndLossStore } from '../profitAndLoss';
import type { ProfitLossLine } from '../../../src/lib/profitAndLoss';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const NOW = new Date('2026-10-26T12:00:00Z');
const line = (over: Partial<ProfitLossLine>): ProfitLossLine => ({
  date: '2026-07-10',
  accountId: 'sales',
  accountName: 'Sales',
  accountType: 'income',
  amountPence: -200000,
  vatPence: -40000,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});

function makeStore() {
  const asked: string[] = [];
  const store: ProfitAndLossStore = {
    async loadLines(userId, period) {
      asked.push(`${userId}:${period.start}..${period.end}`);
      return [
        line({}),
        line({ accountId: 'travel', accountName: 'Travel', accountType: 'expense', amountPence: 5000, vatPence: 1000 }),
        line({ status: 'draft', amountPence: -999 }),
        line({ date: '2026-10-01', amountPence: -777 }), // outside last quarter
      ];
    },
  };
  return { store, asked };
}

const get = (store: ProfitAndLossStore, query = '?preset=last-quarter', userId?: string, method = 'GET') =>
  createProfitAndLossHandler(store, authDeps, () => NOW)(
    new Request(`https://app.test/api/profit-and-loss${query}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} }),
  );

describe('profit and loss route', () => {
  it('returns the report for a preset', async () => {
    const { store } = makeStore();
    const response = await get(store, '?preset=last-quarter', 'owner');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        start: '2026-07-01',
        end: '2026-09-30',
        income: [{ accountId: 'sales', accountName: 'Sales', totalPence: 200000 }],
        expenses: [{ accountId: 'travel', accountName: 'Travel', totalPence: 5000 }],
        incomePence: 200000,
        expensesPence: 5000,
        profitPence: 195000,
      },
    });
  });

  it('accepts an explicit range and scopes the store call to the session user', async () => {
    const { store, asked } = makeStore();
    await get(store, '?start=2026-04-06&end=2026-12-31&userId=someone-else', 'owner_b');
    expect(asked).toEqual(['owner_b:2026-04-06..2026-12-31']);
  });

  it.each(['', '?preset=forever', '?start=2026-01-01', '?start=2026-02-30&end=2026-03-01', '?start=2026-05-01&end=2026-04-01', '?start=x&end=y'])(
    'rejects bad period %s without touching the store',
    async (query) => {
      const { store, asked } = makeStore();
      const response = await get(store, query, 'owner');
      expect(response.status).toBe(400);
      expect(asked).toEqual([]);
    },
  );

  it('refuses a request without a session and never touches the store', async () => {
    const { store, asked } = makeStore();
    expect((await get(store)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('refuses methods other than GET', async () => {
    const { store } = makeStore();
    expect((await get(store, '?preset=last-quarter', 'owner', 'POST')).status).toBe(405);
  });
});
