import { penceToPounds } from './itsCumulativeUpdate.js';
import type { PropertyAnnualSubmission } from './hmrc/client.js';
import type { PropertySummary } from './itsPropertyUpdate.js';
import { getTaxBands } from './taxBands.js';
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

export type PropertyExpenseChoice = 'allowance' | 'actual';

/**
 * Builds HMRC's UK property annual body (Property Business API v6). The property allowance and actual
 * expenses are mutually exclusive, so 'actual' sends no allowance. The allowance cannot exceed the rent
 * received, and nothing is sent when there was none. Amounts stay in pence until the pounds edge.
 */
export function buildPropertyAnnualSubmission(
  summary: PropertySummary,
  choice: PropertyExpenseChoice,
  taxYear: string,
): PropertyAnnualSubmission {
  const incomePence = summary.incomeCategories.reduce((sum, { totalPence }) => sum + totalPence, 0);
  const allowancePence = Math.min(getTaxBands(taxYear).propertyAllowancePence, incomePence);
  if (choice === 'allowance' && allowancePence > 0) {
    return { ukProperty: { allowances: { propertyIncomeAllowance: Number(penceToPounds(allowancePence)) } } };
  }
  return { ukProperty: {} };
}
