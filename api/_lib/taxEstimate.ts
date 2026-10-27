import { estimateTax, TAX_BANDS } from '../../src/lib/taxBands.js';
import { taxYearPeriod, type ExpenseMethod } from '../../src/lib/taxYearSummary.js';
import { getTaxYearSummary, type TaxYearSummaryStore } from './taxYearSummary.js';

export interface TaxEstimateResult {
  taxYear: string;
  profitPence: number;
  incomeTaxPence: number;
  class2NicPence: number;
  class4NicPence: number;
  totalTaxPence: number;
  /** Equal to the total: the amount to keep aside for the bill. */
  setAsidePence: number;
  /** The method profitPence is based on, with both profits so the Tax page can compare. */
  expenseMethod: ExpenseMethod;
  tradingAllowancePence: number;
  profitWithActualExpensesPence: number;
  profitWithAllowancePence: number;
  lowerProfitMethod: ExpenseMethod;
}

/** Reads `?taxYear=2026-27`. Null unless the year is well formed and has an entry in the tax bands file. */
export function parseEstimateTaxYear(params: URLSearchParams): string | null {
  const taxYear = params.get('taxYear') ?? '';
  return taxYearPeriod(taxYear) && taxYear in TAX_BANDS ? taxYear : null;
}

// Tax maths stays in estimateTax; this only feeds it the year's profit from the shared summary.
export async function getTaxEstimate(store: TaxYearSummaryStore, userId: string, taxYear: string): Promise<TaxEstimateResult> {
  const period = taxYearPeriod(taxYear);
  if (!period) throw new Error(`Invalid tax year: ${taxYear}`);
  const { netProfitPence, ...comparison } = await getTaxYearSummary(store, userId, period);
  const { profitPence, incomeTaxPence, class2NicPence, class4NicPence, totalTaxPence } = estimateTax(netProfitPence, taxYear);
  return { taxYear, profitPence, incomeTaxPence, class2NicPence, class4NicPence, totalTaxPence, setAsidePence: totalTaxPence,
    expenseMethod: comparison.expenseMethod,
    tradingAllowancePence: comparison.tradingAllowancePence,
    profitWithActualExpensesPence: comparison.profitWithActualExpensesPence,
    profitWithAllowancePence: comparison.profitWithAllowancePence,
    lowerProfitMethod: comparison.lowerProfitMethod,
  };
}
