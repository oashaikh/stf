import { describe, expect, it } from 'vitest';
import { buildAnnualSubmission, buildPropertyAnnualSubmission } from './itsAnnualSubmission.js';
import { getTaxBands } from './taxBands.js';
import type { TaxYearSummary } from './taxYearSummary.js';

const summary: TaxYearSummary = {
  start: '2026-04-06',
  end: '2027-04-05',
  turnoverPence: 5000000,
  otherIncomePence: 0,
  expenseCategories: [{ taxCategory: 'travel', totalPence: 120000 }],
  allowableExpensesPence: 120000,
  disallowableExpensesPence: 0,
  netProfitPence: 4880000,
  uncategorisedAccounts: [],
  expenseMethod: 'allowance',
  tradingAllowancePence: getTaxBands('2026-27').tradingAllowancePence,
  profitWithActualExpensesPence: 4880000,
  profitWithAllowancePence: 4000000,
  lowerProfitMethod: 'allowance',
};

describe('buildAnnualSubmission', () => {
  it('sends the tax-year band value as the trading allowance when the owner chose the allowance', () => {
    const expectedPounds = (getTaxBands('2026-27').tradingAllowancePence / 100).toFixed(2);
    expect(buildAnnualSubmission(summary)).toEqual({ allowances: { tradingIncomeAllowance: expectedPounds } });
  });

  it('sends no trading allowance and no expense adjustments when the owner chose actual expenses', () => {
    const submission = buildAnnualSubmission({ ...summary, expenseMethod: 'actual' });
    expect(submission).toEqual({});
    expect(JSON.stringify(submission)).not.toContain('tradingIncomeAllowance');
  });

  it('writes a zero allowance as 0.00', () => {
    expect(buildAnnualSubmission({ ...summary, tradingAllowancePence: 0 })).toEqual({
      allowances: { tradingIncomeAllowance: '0.00' },
    });
  });

  it('still builds for a loss year', () => {
    const lossYear = { ...summary, turnoverPence: 0, netProfitPence: -120000, profitWithActualExpensesPence: -120000 };
    expect(buildAnnualSubmission(lossYear).allowances?.tradingIncomeAllowance).toBe('1000.00');
    expect(buildAnnualSubmission({ ...lossYear, expenseMethod: 'actual' })).toEqual({});
  });

  it('never sends the allowance together with expense adjustments', () => {
    for (const expenseMethod of ['allowance', 'actual'] as const) {
      const submission = buildAnnualSubmission({ ...summary, expenseMethod });
      expect(Boolean(submission.allowances) && Boolean(submission.adjustments)).toBe(false);
    }
  });
});

describe('buildPropertyAnnualSubmission', () => {
  const property = (rentPence: number) => ({
    start: '2026-04-06',
    end: '2027-04-05',
    incomeCategories: rentPence ? [{ taxCategory: 'property-rent-received', totalPence: rentPence }] : [],
    expenseCategories: [],
  });

  it('claims the property allowance in pounds when the owner chooses it', () => {
    expect(buildPropertyAnnualSubmission(property(500000), 'allowance', '2026-27')).toEqual({
      ukProperty: { allowances: { propertyIncomeAllowance: 1000 } },
    });
  });

  it('caps the allowance at the rent received', () => {
    expect(buildPropertyAnnualSubmission(property(45050), 'allowance', '2026-27')).toEqual({
      ukProperty: { allowances: { propertyIncomeAllowance: 450.5 } },
    });
  });

  it('sends no allowance when the owner claims actual costs', () => {
    expect(buildPropertyAnnualSubmission(property(500000), 'actual', '2026-27')).toEqual({ ukProperty: {} });
  });

  it('sends no allowance when there is no rent', () => {
    expect(buildPropertyAnnualSubmission(property(0), 'allowance', '2026-27')).toEqual({ ukProperty: {} });
  });
});
