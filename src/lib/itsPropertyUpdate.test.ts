import { describe, expect, it } from 'vitest';
import { buildPropertyCumulativeSummary, buildPropertySummary } from './itsPropertyUpdate.js';
import type { TaxYearLine } from './taxYearSummary.js';

const period = { start: '2026-04-06', end: '2026-07-05' };

const line = (over: Partial<TaxYearLine>): TaxYearLine => ({
  date: '2026-05-01',
  accountId: 'rent',
  accountName: 'Rent received',
  accountType: 'income',
  taxCategory: 'property-rent-received',
  amountPence: -120050,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});

describe('buildPropertySummary', () => {
  it('totals only property categories in the period, income as positive pence', () => {
    const summary = buildPropertySummary(
      [
        line({}),
        line({ amountPence: -5000 }),
        line({ accountType: 'expense', taxCategory: 'property-finance-costs', amountPence: 30000 }),
        line({ taxCategory: 'turnover', amountPence: -999999 }),
        line({ date: '2026-07-06', amountPence: -777 }),
        line({ deletedAt: '2026-05-02T00:00:00Z', amountPence: -888 }),
      ],
      period,
    );
    expect(summary).toEqual({
      ...period,
      incomeCategories: [{ taxCategory: 'property-rent-received', totalPence: 125050 }],
      expenseCategories: [{ taxCategory: 'property-finance-costs', totalPence: 30000 }],
    });
  });
});

describe('buildPropertyCumulativeSummary', () => {
  const base = { ...period, incomeCategories: [], expenseCategories: [] };

  it('maps rent and every expense category to its HMRC field in pounds', () => {
    const body = buildPropertyCumulativeSummary({
      ...base,
      incomeCategories: [{ taxCategory: 'property-rent-received', totalPence: 125050 }],
      expenseCategories: [
        { taxCategory: 'property-premises-running-costs', totalPence: 100 },
        { taxCategory: 'property-repairs-maintenance', totalPence: 205 },
        { taxCategory: 'property-finance-costs', totalPence: 300 },
        { taxCategory: 'property-professional-fees', totalPence: 400 },
        { taxCategory: 'property-cost-of-services', totalPence: 500 },
        { taxCategory: 'property-other-costs', totalPence: 600 },
        { taxCategory: 'property-travel-costs', totalPence: 700 },
      ],
    });
    expect(body).toEqual({
      fromDate: '2026-04-06',
      toDate: '2026-07-05',
      ukProperty: {
        income: { periodAmount: 1250.5 },
        expenses: {
          premisesRunningCosts: 1,
          repairsAndMaintenance: 2.05,
          financialCosts: 3,
          professionalFees: 4,
          costOfServices: 5,
          other: 6,
          travelCosts: 7,
        },
      },
    });
  });

  it('omits empty categories and sections', () => {
    expect(buildPropertyCumulativeSummary(base)).toEqual({ fromDate: '2026-04-06', toDate: '2026-07-05', ukProperty: {} });
  });

  it('keeps negative amounts and drops categories HMRC has no field for', () => {
    const body = buildPropertyCumulativeSummary({
      ...base,
      expenseCategories: [
        { taxCategory: 'property-repairs-maintenance', totalPence: -250 },
        { taxCategory: 'disallowable', totalPence: 999 },
      ],
    });
    expect(body.ukProperty.expenses).toEqual({ repairsAndMaintenance: -2.5 });
  });
});
