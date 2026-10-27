import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createTaxYearSummaryHandler } from '../../tax-year-summary';
import type { AuthDeps } from '../auth';
import type { TaxYearSummaryStore } from '../taxYearSummary';
import type { StoredTrip } from '../mileage';
import type { TaxYearLine } from '../../../src/lib/taxYearSummary';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const line = (over: Partial<TaxYearLine>): TaxYearLine => ({
  date: '2026-07-10',
  accountId: 'sales',
  accountName: 'Sales',
  accountType: 'income',
  taxCategory: 'turnover',
  amountPence: -200000,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});

const trip = (over: Partial<StoredTrip>): StoredTrip => ({
  id: 't1',
  date: '2026-07-11',
  from: 'A',
  to: 'B',
  purpose: 'Client visit',
  distanceTenths: 1000,
  vehicleType: 'car',
  createdAt: '2026-07-11T09:00:00.000Z',
  deletedAt: null,
  ...over,
});

function makeStore(trips: StoredTrip[] = [], choice?: 'actual' | 'allowance') {
  const asked: string[] = [];
  const store: TaxYearSummaryStore = {
    async loadChoice(userId, taxYear) {
      asked.push(`choice:${userId}:${taxYear}`);
      return choice;
    },
    async loadLines(userId, period) {
      asked.push(`${userId}:${period.start}..${period.end}`);
      return [line({}), line({ accountId: 'travel', accountType: 'expense', taxCategory: 'travel', amountPence: 5000 })];
    },
    async loadTrips(userId, period) {
      asked.push(`trips ${userId}:${period.start}..${period.end}`);
      return trips;
    },
  };
  return { store, asked };
}

const get = (store: TaxYearSummaryStore, query = '?taxYear=2026-27', userId?: string, method = 'GET') =>
  createTaxYearSummaryHandler(store, authDeps)(
    new Request(`https://app.test/api/tax-year-summary${query}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} }),
  );

describe('tax year summary route', () => {
  it('returns the summary for the tax year, scoped to the session user not a client id', async () => {
    const { store, asked } = makeStore();
    const response = await get(store, '?taxYear=2026-27&userId=someone-else', 'owner_b');
    expect(response.status).toBe(200);
    expect(asked).toEqual(['owner_b:2026-04-06..2027-04-05', 'trips owner_b:2026-04-06..2027-04-05', 'choice:owner_b:2026-27']);
    const body = await response.json();
    expect(body.data).toMatchObject({
      turnoverPence: 200000,
      allowableExpensesPence: 5000,
      netProfitPence: 195000,
      uncategorisedAccounts: [],
      expenseMethod: 'actual',
      tradingAllowancePence: 100000,
      profitWithActualExpensesPence: 195000,
      profitWithAllowancePence: 100000,
      lowerProfitMethod: 'allowance',
    });
  });

  it('adds the mileage claim to travel on top of ledger travel and lowers net profit', async () => {
    const { store } = makeStore([trip({}), trip({ id: 't2', distanceTenths: 500, vehicleType: 'motorcycle' })]);
    // 100 car miles at 45p = 4500p, 50 motorcycle miles at 24p = 1200p, plus 5000p ledger travel.
    const { data } = await (await get(store, '?taxYear=2026-27', 'owner')).json();
    expect(data.expenseCategories).toEqual([{ taxCategory: 'travel', totalPence: 10700 }]);
    expect(data.netProfitPence).toBe(200000 - 10700);
  });

  it('leaves voided trips out of the claim', async () => {
    const { store } = makeStore([trip({}), trip({ id: 't2', deletedAt: '2026-07-12T00:00:00.000Z' })]);
    const { data } = await (await get(store, '?taxYear=2026-27', 'owner')).json();
    expect(data.expenseCategories).toEqual([{ taxCategory: 'travel', totalPence: 9500 }]);
  });

  it('uses the trading allowance for net profit when the owner chose it', async () => {
    const { data } = await (await get(makeStore([], 'allowance').store, '?taxYear=2026-27', 'owner')).json();
    expect(data).toMatchObject({ expenseMethod: 'allowance', netProfitPence: 100000, allowableExpensesPence: 5000 });
  });

  it('keeps net profit on actual expenses even when the allowance would be lower, until the owner chooses', async () => {
    const { data } = await (await get(makeStore().store, '?taxYear=2026-27', 'owner')).json();
    expect(data).toMatchObject({ expenseMethod: 'actual', lowerProfitMethod: 'allowance', netProfitPence: 195000 });
  });

  it.each(['', '?taxYear=2026', '?taxYear=2026-28', '?taxYear=2019-20', '?taxYear=2022-23'])('rejects bad tax year %s without touching the store', async (query) => {
    const { store, asked } = makeStore();
    expect((await get(store, query, 'owner')).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it('refuses a request without a session and never touches the store', async () => {
    const { store, asked } = makeStore();
    expect((await get(store)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('refuses methods other than GET', async () => {
    const { store } = makeStore();
    expect((await get(store, '?taxYear=2026-27', 'owner', 'POST')).status).toBe(405);
  });
});
