import type { CumulativePeriodSummary } from './hmrc/client.js';
import { taxYearPeriod, type TaxYearSummary } from './taxYearSummary.js';

/** Our tax category slug (chartOfAccounts.ts) to the HMRC periodExpenses field. 'disallowable' is deliberately absent. */
const HMRC_EXPENSE_FIELD: Record<string, keyof NonNullable<CumulativePeriodSummary['periodExpenses']>> = {
  'cost-of-goods': 'costOfGoods',
  travel: 'carVanTravelExpenses',
  premises: 'premisesRunningCosts',
  'admin-office': 'adminCosts',
  advertising: 'advertisingCosts',
  'professional-fees': 'professionalFees',
  'finance-costs': 'financeCharges',
  'other-allowable': 'otherExpenses',
};

const QUARTER_END_MONTH_DAY = ['07-05', '10-05', '01-05', '04-05'];

/** Quarter ends are 5 Jul, 5 Oct, 5 Jan and 5 Apr; the last two fall in the year after the tax year starts. */
export function quarterEndDate(taxYear: string, quarter: 1 | 2 | 3 | 4): string {
  const period = taxYearPeriod(taxYear);
  if (!period) throw new Error(`Invalid tax year: ${taxYear}`);
  const startYear = Number(period.start.slice(0, 4));
  return `${quarter >= 3 ? startYear + 1 : startYear}-${QUARTER_END_MONTH_DAY[quarter - 1]}`;
}

/** Integer pence to a pounds string. String maths on the whole and fraction parts keeps floats out of money. */
export function penceToPounds(pence: number): string {
  const sign = pence < 0 ? '-' : '';
  const absolute = Math.abs(pence);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/**
 * Maps the tax year summary from 6 April to the quarter end onto HMRC's cumulative period fields.
 * Disallowable and uncategorised amounts are never sent. The trading allowance replaces expenses.
 */
export function buildCumulativePeriodSummary(summary: TaxYearSummary): CumulativePeriodSummary {
  const payload: CumulativePeriodSummary = {
    periodDates: { periodStartDate: summary.start, periodEndDate: summary.end },
    periodIncome: {
      turnover: penceToPounds(summary.turnoverPence),
      other: penceToPounds(summary.otherIncomePence),
    },
  };

  if (summary.expenseMethod === 'allowance') {
    payload.periodAllowances = { tradingIncomeAllowance: penceToPounds(summary.tradingAllowancePence) };
    return payload;
  }

  payload.periodExpenses = {};
  for (const { taxCategory, totalPence } of summary.expenseCategories) {
    const field = HMRC_EXPENSE_FIELD[taxCategory];
    if (field) payload.periodExpenses[field] = penceToPounds(totalPence);
  }
  return payload;
}
