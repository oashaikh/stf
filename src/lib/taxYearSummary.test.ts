import { describe, expect, it } from 'vitest';

import { buildProfitAndLoss } from './profitAndLoss.js';
import { buildTaxYearSummary, taxYearPeriod, type TaxYearLine } from './taxYearSummary.js';

const line = (over: Partial<TaxYearLine>): TaxYearLine => ({
  date: '2026-07-10',
  accountId: 'sales',
  accountName: 'Sales',
  accountType: 'income',
  taxCategory: 'turnover',
  amountPence: -100000,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});
const expense = (taxCategory: string | null, amountPence: number, over: Partial<TaxYearLine> = {}) =>
  line({ accountId: taxCategory ?? 'none', accountName: taxCategory ?? 'None', accountType: 'expense', taxCategory, amountPence, ...over });

const period = taxYearPeriod('2026-27')!;

describe('taxYearPeriod', () => {
  it('runs 6 April to 5 April', () => {
    expect(period).toEqual({ start: '2026-04-06', end: '2027-04-05' });
  });
  it.each(['2026', '2026-28', '26-27', 'abc', '2026-2027'])('rejects %s', (value) => {
    expect(taxYearPeriod(value)).toBeNull();
  });
  it('handles the century rollover', () => {
    expect(taxYearPeriod('2099-00')).toEqual({ start: '2099-04-06', end: '2100-04-05' });
  });
});

describe('buildTaxYearSummary', () => {
  it('splits income, groups allowable expenses by HMRC category and keeps disallowable out', () => {
    const summary = buildTaxYearSummary(
      [
        line({}),
        line({ accountId: 'other', accountName: 'Other', taxCategory: 'other-income', amountPence: -5000 }),
        expense('travel', 20000),
        expense('travel', 3000, { accountId: 'fuel', accountName: 'Fuel' }),
        expense('premises', 10000),
        expense('disallowable', 4000),
      ],
      period,
      0,
    );
    expect(summary.turnoverPence).toBe(100000);
    expect(summary.otherIncomePence).toBe(5000);
    expect(summary.expenseCategories).toEqual([
      { taxCategory: 'travel', totalPence: 23000 },
      { taxCategory: 'premises', totalPence: 10000 },
    ]);
    expect(summary.allowableExpensesPence).toBe(33000);
    expect(summary.disallowableExpensesPence).toBe(4000);
    expect(summary.netProfitPence).toBe(72000);
  });

  it('includes 5 April and 6 April of the right years, and excludes the day outside', () => {
    const summary = buildTaxYearSummary(
      [
        line({ date: '2026-04-05', amountPence: -1 }),
        line({ date: '2026-04-06', amountPence: -10 }),
        line({ date: '2027-04-05', amountPence: -100 }),
        line({ date: '2027-04-06', amountPence: -1000 }),
      ],
      period,
      0,
    );
    expect(summary.turnoverPence).toBe(110);
  });

  it('ignores drafts and deleted lines', () => {
    const summary = buildTaxYearSummary([line({ status: 'draft' }), line({ deletedAt: '2026-08-01T00:00:00.000Z' })], period, 0);
    expect(summary.turnoverPence).toBe(0);
  });

  it('warns about accounts with no tax category and leaves them out of the figures', () => {
    const summary = buildTaxYearSummary([line({}), expense(null, 700), expense(null, 300), line({ accountId: 'x', accountName: 'X', taxCategory: null, amountPence: -50 })], period, 0);
    expect(summary.uncategorisedAccounts).toEqual([
      { accountId: 'none', accountName: 'None', accountType: 'expense', totalPence: 1000 },
      { accountId: 'x', accountName: 'X', accountType: 'income', totalPence: 50 },
    ]);
    expect(summary.allowableExpensesPence).toBe(0);
    expect(summary.netProfitPence).toBe(100000);
  });

  it('reconciles with the profit and loss for the same range', () => {
    const lines = [line({}), line({ taxCategory: 'other-income', accountId: 'o', amountPence: -5000 }), expense('travel', 20000), expense('disallowable', 4000), expense(null, 700)];
    const summary = buildTaxYearSummary(lines, period, 0);
    const profitAndLoss = buildProfitAndLoss(lines, period);
    const uncategorisedExpensePence = 700;
    expect(summary.netProfitPence - summary.disallowableExpensesPence - uncategorisedExpensePence).toBe(profitAndLoss.profitPence);
    expect(summary.turnoverPence + summary.otherIncomePence).toBe(profitAndLoss.incomePence);
  });

  it('adds the mileage claim to travel alongside ledger travel and lowers net profit', () => {
    const summary = buildTaxYearSummary([line({}), expense('travel', 20000)], period, 4500);
    expect(summary.expenseCategories).toEqual([{ taxCategory: 'travel', totalPence: 24500 }]);
    expect(summary.allowableExpensesPence).toBe(24500);
    expect(summary.netProfitPence).toBe(75500);
  });

  it('creates the travel row when the ledger has none', () => {
    const summary = buildTaxYearSummary([line({})], period, 4500);
    expect(summary.expenseCategories).toEqual([{ taxCategory: 'travel', totalPence: 4500 }]);
  });

  it('changes nothing for a zero claim', () => {
    const summary = buildTaxYearSummary([line({})], period, 0);
    expect(summary.expenseCategories).toEqual([]);
    expect(summary.netProfitPence).toBe(100000);
  });
});
