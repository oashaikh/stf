import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createDashboardHandler } from '../../dashboard';
import type { AuthDeps } from '../auth';
import type { DashboardStore, RecentEntry } from '../dashboard';
import type { LedgerLine } from '../../../src/lib/vat';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const NOW = new Date('2026-10-26T12:00:00Z');
const day = (date: string, accountType: LedgerLine['accountType'], amountPence: number, vatPence: number): LedgerLine => ({
  date,
  accountType,
  amountPence,
  vatPence,
  status: 'confirmed',
  deletedAt: null,
});
const recent: RecentEntry = { id: 'e1', date: '2026-10-25', description: 'Train to client', status: 'confirmed', kind: 'expense', grossPence: 12000 };

function makeStore() {
  const asked: string[] = [];
  const store: DashboardStore = {
    async loadDailyTotals(userId, period) {
      asked.push(`${userId}:${period.start}..${period.end}`);
      return [
        day('2026-04-05', 'income', -99900, -19980), // last tax year
        day('2026-05-01', 'income', -500000, -100000),
        day('2026-09-30', 'expense', 20000, 4000), // before this month and quarter
        day('2026-10-02', 'income', -250000, -50000),
        day('2026-10-20', 'expense', 100000, 20000),
      ];
    },
    async countDrafts(userId) {
      asked.push(`${userId}:drafts`);
      return 3;
    },
    async listRecentEntries(userId) {
      asked.push(`${userId}:recent`);
      return [recent];
    },
  };
  return { store, asked };
}

const get = (store: DashboardStore, userId?: string, method = 'GET') =>
  createDashboardHandler(store, authDeps, () => NOW)(
    new Request('https://app.test/api/dashboard', { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} }),
  );

describe('dashboard route', () => {
  it('returns the exact shape the dashboard renders', async () => {
    const { store } = makeStore();
    const response = await get(store, 'owner');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        taxYear: {
          start: '2026-04-06',
          end: '2027-04-05',
          incomePence: 750000,
          expensesPence: 120000,
          profitPence: 630000,
          vatCollectedPence: 150000,
          vatPaidPence: 24000,
        },
        month: {
          start: '2026-10-01',
          end: '2026-10-31',
          incomePence: 250000,
          expensesPence: 100000,
          profitPence: 150000,
          vatCollectedPence: 50000,
          vatPaidPence: 20000,
        },
        vatQuarter: { start: '2026-10-01', end: '2026-12-31', vatCollectedPence: 50000, vatPaidPence: 20000 },
        draftCount: 3,
        recentEntries: [recent],
      },
    });
  });

  it('scopes every store call to the session user and queries one widest range', async () => {
    const { store, asked } = makeStore();
    await get(store, 'owner_b');
    expect(asked).toHaveLength(3);
    expect(asked.every((entry) => entry.startsWith('owner_b:'))).toBe(true);
    expect(asked).toContain('owner_b:2026-04-06..2027-04-05');
  });

  it('refuses a request without a session and never touches the store', async () => {
    const { store, asked } = makeStore();
    const response = await get(store);
    expect(response.status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('refuses methods other than GET', async () => {
    const { store } = makeStore();
    expect((await get(store, 'owner', 'POST')).status).toBe(405);
  });
});
