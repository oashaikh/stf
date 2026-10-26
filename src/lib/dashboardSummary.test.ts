import { describe, expect, it } from 'vitest';

import { dashboardPeriods, summariseLedger } from './dashboardSummary';
import type { LedgerLine } from './vat';

const line = (over: Partial<LedgerLine>): LedgerLine => ({
  date: '2026-04-06',
  accountType: 'income',
  amountPence: -10000,
  vatPence: -2000,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});

describe('dashboardPeriods', () => {
  it('puts 5 April in the tax year that started the previous April', () => {
    expect(dashboardPeriods(new Date('2026-04-05T12:00:00Z')).taxYear).toEqual({ start: '2025-04-06', end: '2026-04-05' });
  });

  it('puts 6 April in the new tax year, and its quarter starts on 1 April', () => {
    const periods = dashboardPeriods(new Date('2026-04-06T12:00:00Z'));
    expect(periods.taxYear.start).toBe('2026-04-06');
    expect(periods.month).toEqual({ start: '2026-04-01', end: '2026-04-30' });
    expect(periods.quarter).toEqual({ start: '2026-04-01', end: '2026-06-30' });
  });

  it('handles February in a leap year and a December quarter', () => {
    expect(dashboardPeriods(new Date('2028-02-10T12:00:00Z')).month.end).toBe('2028-02-29');
    expect(dashboardPeriods(new Date('2026-12-31T12:00:00Z')).quarter).toEqual({ start: '2026-10-01', end: '2026-12-31' });
  });
});

describe('summariseLedger', () => {
  const taxYear = { start: '2026-04-06', end: '2027-04-05' };

  it('counts 6 April but not 5 April', () => {
    const lines = [line({ date: '2026-04-05' }), line({ date: '2026-04-06', amountPence: -500, vatPence: 0 })];
    expect(summariseLedger(lines, taxYear)).toEqual({ incomePence: 500, expensesPence: 0, profitPence: 500, vatCollectedPence: 0, vatPaidPence: 0 });
  });

  it('excludes draft, voided and deleted lines, and non income/expense accounts', () => {
    const lines = [
      line({ status: 'draft' }),
      line({ status: 'voided' }),
      line({ deletedAt: '2026-05-01T00:00:00.000Z' }),
      line({ accountType: 'asset' }),
      line({ status: 'reconciled', amountPence: -3000, vatPence: -600 }),
      line({ accountType: 'expense', amountPence: 1000, vatPence: 200 }),
    ];
    expect(summariseLedger(lines, taxYear)).toEqual({
      incomePence: 3000,
      expensesPence: 1000,
      profitPence: 2000,
      vatCollectedPence: 600,
      vatPaidPence: 200,
    });
  });
});
