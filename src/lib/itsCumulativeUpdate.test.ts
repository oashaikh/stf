import { describe, expect, it } from 'vitest';
import { buildCumulativePeriodSummary, quarterEndDate } from './itsCumulativeUpdate.js';
import type { TaxYearSummary } from './taxYearSummary.js';
import { selfEmploymentCumulativePath } from './hmrc/client.js';

const emptySummary: TaxYearSummary = {
  start: '2026-04-06',
  end: '2026-07-05',
  turnoverPence: 0,
  otherIncomePence: 0,
  expenseCategories: [],
  allowableExpensesPence: 0,
  disallowableExpensesPence: 0,
  netProfitPence: 0,
  uncategorisedAccounts: [],
  expenseMethod: 'actual',
  tradingAllowancePence: 100000,
  profitWithActualExpensesPence: 0,
  profitWithAllowancePence: 0,
  lowerProfitMethod: 'actual',
};

const busySummary: TaxYearSummary = {
  ...emptySummary,
  turnoverPence: 123456,
  otherIncomePence: 5,
  expenseCategories: [
    { taxCategory: 'cost-of-goods', totalPence: 100 },
    { taxCategory: 'travel', totalPence: 200 },
    { taxCategory: 'premises', totalPence: 300 },
    { taxCategory: 'admin-office', totalPence: 400 },
    { taxCategory: 'advertising', totalPence: 500 },
    { taxCategory: 'professional-fees', totalPence: 600 },
    { taxCategory: 'finance-costs', totalPence: 700 },
    { taxCategory: 'other-allowable', totalPence: 801 },
    { taxCategory: 'disallowable', totalPence: 9999 },
  ],
  allowableExpensesPence: 3601,
  disallowableExpensesPence: 9999,
  uncategorisedAccounts: [{ accountId: 'a', accountName: 'Mystery', accountType: 'expense', totalPence: 4242 }],
};

describe('buildCumulativePeriodSummary', () => {
  it('maps every category to its HMRC field and writes pounds with two decimals', () => {
    expect(buildCumulativePeriodSummary(busySummary)).toEqual({
      periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-07-05' },
      periodIncome: { turnover: '1234.56', other: '0.05' },
      periodExpenses: {
        costOfGoods: '1.00',
        carVanTravelExpenses: '2.00',
        premisesRunningCosts: '3.00',
        adminCosts: '4.00',
        advertisingCosts: '5.00',
        professionalFees: '6.00',
        financeCharges: '7.00',
        otherExpenses: '8.01',
      },
    });
  });

  it('never sends disallowable or uncategorised amounts', () => {
    const json = JSON.stringify(buildCumulativePeriodSummary(busySummary));
    expect(json).not.toContain('99.99');
    expect(json).not.toContain('42.42');
  });

  it('gives zero figures for a quarter with no activity', () => {
    expect(buildCumulativePeriodSummary(emptySummary)).toEqual({
      periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-07-05' },
      periodIncome: { turnover: '0.00', other: '0.00' },
      periodExpenses: {},
    });
  });

  it('converts pence to pounds without float maths', () => {
    const turnoverFor = (turnoverPence: number) =>
      buildCumulativePeriodSummary({ ...emptySummary, turnoverPence }).periodIncome.turnover;
    expect(turnoverFor(0)).toBe('0.00');
    expect(turnoverFor(5)).toBe('0.05');
    expect(turnoverFor(100)).toBe('1.00');
    expect(turnoverFor(123456)).toBe('1234.56');
    expect(turnoverFor(-5)).toBe('-0.05');
    expect(turnoverFor(-123456)).toBe('-1234.56');
  });

  it('sends the trading allowance instead of expenses when that method is chosen', () => {
    const payload = buildCumulativePeriodSummary({ ...busySummary, expenseMethod: 'allowance' });
    expect(payload.periodExpenses).toBeUndefined();
    expect(payload.periodAllowances).toEqual({ tradingIncomeAllowance: '1000.00' });
  });

  it('ends each quarter on its HMRC date and starts the period on 6 April', () => {
    expect(quarterEndDate('2026-27', 1)).toBe('2026-07-05');
    expect(quarterEndDate('2026-27', 2)).toBe('2026-10-05');
    expect(quarterEndDate('2026-27', 3)).toBe('2027-01-05');
    expect(quarterEndDate('2026-27', 4)).toBe('2027-04-05');
  });
});

describe('selfEmploymentCumulativePath', () => {
  it('builds the cumulative period path', () => {
    expect(selfEmploymentCumulativePath('AA123456A', 'XAIS12345678910', '2026-27')).toBe(
      '/individuals/business/self-employment/AA123456A/XAIS12345678910/cumulative/2026-27',
    );
  });
});
