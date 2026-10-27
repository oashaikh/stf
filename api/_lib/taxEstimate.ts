import { estimateTax, TAX_BANDS } from '../../src/lib/taxBands.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
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
  const { netProfitPence } = await getTaxYearSummary(store, userId, period);
  const { profitPence, incomeTaxPence, class2NicPence, class4NicPence, totalTaxPence } = estimateTax(netProfitPence, taxYear);
  return { taxYear, profitPence, incomeTaxPence, class2NicPence, class4NicPence, totalTaxPence, setAsidePence: totalTaxPence };
}
