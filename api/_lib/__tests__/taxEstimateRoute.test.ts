import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createTaxEstimateHandler } from '../../tax-estimate';
import { estimateTax } from '../../../src/lib/taxBands';
import type { TaxYearLine } from '../../../src/lib/taxYearSummary';
import type { AuthDeps } from '../auth';
import type { TaxYearSummaryStore } from '../taxYearSummary';

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
  amountPence: -6000000,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});

function makeStore(lines: TaxYearLine[], choice?: 'actual' | 'allowance') {
  const asked: string[] = [];
  const store: TaxYearSummaryStore = {
    async loadChoice(userId, taxYear) {
      asked.push(`choice:${userId}:${taxYear}`);
      return choice;
    },
    async loadLines(userId, period) {
      asked.push(`${userId}:${period.start}..${period.end}`);
      return lines;
    },
    async loadTrips() {
      return [];
    },
  };
  return { store, asked };
}

const get = (store: TaxYearSummaryStore, query = '?taxYear=2026-27', userId?: string, method = 'GET') =>
  createTaxEstimateHandler(store, authDeps)(
    new Request(`https://app.test/api/tax-estimate${query}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} }),
  );

describe('tax estimate route', () => {
  it('returns exactly what the shared estimateTax gives for the year profit, scoped to the session user', async () => {
    const { store, asked } = makeStore([line({})]);
    const response = await get(store, '?taxYear=2026-27&userId=someone-else', 'owner_b');
    expect(response.status).toBe(200);
    expect(asked).toEqual(['owner_b:2026-04-06..2027-04-05', 'choice:owner_b:2026-27']);
    const expected = estimateTax(6000000, '2026-27');
    const { data } = await response.json();
    expect(data).toEqual({
      taxYear: '2026-27',
      profitPence: 6000000,
      incomeTaxPence: expected.incomeTaxPence,
      class2NicPence: expected.class2NicPence,
      class4NicPence: expected.class4NicPence,
      totalTaxPence: expected.totalTaxPence,
      setAsidePence: expected.totalTaxPence,
      expenseMethod: 'actual',
      tradingAllowancePence: 100000,
      profitWithActualExpensesPence: 6000000,
      profitWithAllowancePence: 5900000,
      lowerProfitMethod: 'allowance',
    });
    expect(data.totalTaxPence).toBeGreaterThan(0);
  });

  it('follows the allowance choice: estimate matches estimateTax on income minus the allowance', async () => {
    const lines = [line({}), line({ accountId: 'travel', accountType: 'expense', taxCategory: 'travel', amountPence: 5000000 })];
    const { data } = await (await get(makeStore(lines, 'allowance').store, '?taxYear=2026-27', 'owner')).json();
    const expected = estimateTax(5900000, '2026-27');
    expect(data).toMatchObject({ expenseMethod: 'allowance', profitPence: 5900000, totalTaxPence: expected.totalTaxPence });
    const actual = await (await get(makeStore(lines).store, '?taxYear=2026-27', 'owner')).json();
    expect(actual.data.profitPence).toBe(1000000);
  });

  it('gives nil profit and nil tax when the allowance is chosen and income is below it', async () => {
    const { data } = await (await get(makeStore([line({ amountPence: -80000 })], 'allowance').store, '?taxYear=2026-27', 'owner')).json();
    expect(data).toMatchObject({ profitPence: 0, totalTaxPence: 0, profitWithAllowancePence: 0 });
  });

  it('counts other income towards the gross income used for the allowance', async () => {
    const lines = [line({ amountPence: -80000 }), line({ accountId: 'misc', taxCategory: 'other-income', amountPence: -60000 })];
    const { data } = await (await get(makeStore(lines, 'allowance').store, '?taxYear=2026-27', 'owner')).json();
    expect(data.profitPence).toBe(40000);
  });

  it('changes the estimate when a new entry is added', async () => {
    const before = await (await get(makeStore([line({})]).store, '?taxYear=2026-27', 'owner')).json();
    const more = await (await get(makeStore([line({}), line({ amountPence: -1000000 })]).store, '?taxYear=2026-27', 'owner')).json();
    expect(more.data.profitPence).toBe(before.data.profitPence + 1000000);
    expect(more.data.totalTaxPence).toBeGreaterThan(before.data.totalTaxPence);
  });

  it.each(['', '?taxYear=2026', '?taxYear=2026-28', '?taxYear=2019-20'])('rejects bad or unsupported tax year %s without touching the store', async (query) => {
    const { store, asked } = makeStore([]);
    expect((await get(store, query, 'owner')).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it('refuses a request without a session and never touches the store', async () => {
    const { store, asked } = makeStore([]);
    expect((await get(store)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('refuses methods other than GET', async () => {
    expect((await get(makeStore([]).store, '?taxYear=2026-27', 'owner', 'POST')).status).toBe(405);
  });
});
