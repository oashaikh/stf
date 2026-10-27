import { describe, expect, it } from 'vitest';

import { buildProfitAndLoss, profitAndLossPresets, type ProfitLossLine } from './profitAndLoss';
import { summariseLedger } from './dashboardSummary';

const line = (over: Partial<ProfitLossLine>): ProfitLossLine => ({
  date: '2026-06-01',
  accountId: 'a-sales',
  accountName: 'Sales',
  accountType: 'income',
  amountPence: -100000,
  vatPence: -20000,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});

const period = { start: '2026-04-06', end: '2027-04-05' };

describe('buildProfitAndLoss', () => {
  it('groups by account with income and profit positive, net of VAT', () => {
    const report = buildProfitAndLoss(
      [
        line({}),
        line({ amountPence: -50000, vatPence: -10000 }),
        line({ accountId: 'a-travel', accountName: 'Travel', accountType: 'expense', amountPence: 30000, vatPence: 6000 }),
        line({ accountId: 'a-fees', accountName: 'Fees', accountType: 'expense', amountPence: 5000, vatPence: 0 }),
      ],
      period,
    );
    expect(report.income).toEqual([{ accountId: 'a-sales', accountName: 'Sales', totalPence: 150000 }]);
    expect(report.expenses.map((row) => row.totalPence)).toEqual([30000, 5000]);
    expect(report).toMatchObject({ incomePence: 150000, expensesPence: 35000, profitPence: 115000 });
  });

  it('excludes draft, voided, deleted, non-P&L accounts and dates outside the range', () => {
    const report = buildProfitAndLoss(
      [
        line({ status: 'draft' }),
        line({ status: 'voided' }),
        line({ deletedAt: '2026-07-01T00:00:00.000Z' }),
        line({ accountType: 'asset', amountPence: 99900 }),
        line({ date: '2026-04-05' }),
        line({ date: '2027-04-06' }),
        line({ date: '2026-04-06', amountPence: -100 }),
        line({ date: '2027-04-05', status: 'reconciled', amountPence: -200 }),
      ],
      period,
    );
    expect(report.incomePence).toBe(300);
    expect(report.expensesPence).toBe(0);
  });

  it('matches the dashboard summary for the same lines and range', () => {
    const lines = [
      line({}),
      line({ accountType: 'expense', accountId: 'a-x', accountName: 'X', amountPence: 12345, vatPence: 0 }),
      line({ status: 'draft' }),
    ];
    const report = buildProfitAndLoss(lines, period);
    const summary = summariseLedger(lines, period);
    expect([report.incomePence, report.expensesPence, report.profitPence]).toEqual([
      summary.incomePence,
      summary.expensesPence,
      summary.profitPence,
    ]);
  });

  it('reports a loss as negative profit', () => {
    const report = buildProfitAndLoss([line({ accountType: 'expense', amountPence: 500, vatPence: 0 })], period);
    expect(report.profitPence).toBe(-500);
  });
});

describe('profitAndLossPresets', () => {
  it('splits tax years on 6 April', () => {
    expect(profitAndLossPresets(new Date('2026-04-05T12:00:00Z'))).toMatchObject({
      'this-tax-year': { start: '2025-04-06', end: '2026-04-05' },
      'last-tax-year': { start: '2024-04-06', end: '2025-04-05' },
    });
    expect(profitAndLossPresets(new Date('2026-04-06T00:00:00Z'))['this-tax-year']).toEqual({
      start: '2026-04-06',
      end: '2027-04-05',
    });
  });

  it('last quarter is the previous calendar quarter, across a year boundary too', () => {
    expect(profitAndLossPresets(new Date('2026-10-26T00:00:00Z'))['last-quarter']).toEqual({ start: '2026-07-01', end: '2026-09-30' });
    expect(profitAndLossPresets(new Date('2026-02-10T00:00:00Z'))['last-quarter']).toEqual({ start: '2025-10-01', end: '2025-12-31' });
  });
});
