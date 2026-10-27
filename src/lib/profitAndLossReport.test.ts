import { describe, expect, it } from 'vitest';

import { profitAndLossCsv, type ProfitAndLoss } from './profitAndLossReport';

const report: ProfitAndLoss = {
  start: '2026-04-06',
  end: '2027-04-05',
  income: [{ accountId: 'a1', accountName: 'Sales', totalPence: 150005 }],
  expenses: [
    { accountId: 'a2', accountName: 'Travel, "rail"', totalPence: 4000 },
    { accountId: 'a3', accountName: '=SUM(A1)', totalPence: 99 },
  ],
  incomePence: 150005,
  expensesPence: 4099,
  profitPence: 145906,
};

describe('profitAndLossCsv', () => {
  it('writes pounds with two decimals, totals and net profit', () => {
    expect(profitAndLossCsv(report).split('\r\n')).toEqual([
      'Section,Category,Amount (GBP)',
      'Income,Sales,1500.05',
      'Income,Total income,1500.05',
      'Expenses,"Travel, ""rail""",40.00',
      "Expenses,'=SUM(A1),0.99",
      'Expenses,Total expenses,40.99',
      'Profit,Net profit,1459.06',
      '',
    ]);
  });

  it('keeps a loss negative', () => {
    expect(profitAndLossCsv({ ...report, income: [], incomePence: 0, profitPence: -4099 })).toContain('Profit,Net profit,-40.99');
  });
});
