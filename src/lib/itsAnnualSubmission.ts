import { penceToPounds } from './itsCumulativeUpdate.js';
import type { TaxYearSummary } from './taxYearSummary.js';

/** HMRC self-employment annual submission body. Amounts are pounds strings. */
export interface AnnualSubmission {
  adjustments?: Record<string, string>;
  allowances?: { tradingIncomeAllowance: string };
}

/**
 * Builds the year-end allowances and adjustments from the owner's expense method (STF-31).
 * The trading allowance and actual expenses are mutually exclusive, so 'actual' sends no allowance.
 * STF records no adjustments, so `adjustments` is never set.
 */
export function buildAnnualSubmission(summary: TaxYearSummary): AnnualSubmission {
  if (summary.expenseMethod === 'allowance') {
    return { allowances: { tradingIncomeAllowance: penceToPounds(summary.tradingAllowancePence) } };
  }
  return {};
}
