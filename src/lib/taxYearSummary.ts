import type { DatePeriod } from './dashboardSummary.js';
import type { ProfitLossLine } from './profitAndLoss.js';
import { contributesToReturn } from './vat.js';

export interface TaxYearLine extends ProfitLossLine {
  taxCategory: string | null; // slug from the account (chartOfAccounts.ts)
}

export interface ExpenseCategoryTotal {
  taxCategory: string;
  totalPence: number;
}

export interface UncategorisedAccount {
  accountId: string;
  accountName: string;
  accountType: 'income' | 'expense';
  totalPence: number;
}

export interface TaxYearSummary extends DatePeriod {
  turnoverPence: number;
  otherIncomePence: number;
  expenseCategories: ExpenseCategoryTotal[];
  allowableExpensesPence: number;
  /** Shown for information; not part of allowable expenses or net profit. */
  disallowableExpensesPence: number;
  netProfitPence: number;
  /** Accounts with no usable tax category. Left out of every figure above until the owner fixes them. */
  uncategorisedAccounts: UncategorisedAccount[];
}

/** '2026-27' becomes 6 April 2026 to 5 April 2027. Null when the label is not a consecutive pair of years. */
export function taxYearPeriod(taxYear: string): DatePeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(taxYear);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (Number(match[2]) !== (startYear + 1) % 100) return null;
  return { start: `${startYear}-04-06`, end: `${startYear + 1}-04-05` };
}

/**
 * HMRC self-employment summary for one tax year, from the same lines and inclusion rule as the
 * profit and loss. Dates are the transaction dates, so this is the cash or accruals answer the
 * owner's posting dates give; it does not re-date invoices.
 */
export function buildTaxYearSummary(lines: TaxYearLine[], period: DatePeriod): TaxYearSummary {
  let turnoverPence = 0;
  let otherIncomePence = 0;
  let disallowableExpensesPence = 0;
  const expenseCategories = new Map<string, number>();
  const uncategorised = new Map<string, UncategorisedAccount>();

  for (const line of lines) {
    if (!contributesToReturn(line, period)) continue;
    const isIncome = line.accountType === 'income';
    const totalPence = isIncome ? -line.amountPence : line.amountPence; // income is a credit
    const category = line.taxCategory;
    if (isIncome && category === 'turnover') turnoverPence += totalPence;
    else if (isIncome && category === 'other-income') otherIncomePence += totalPence;
    else if (!isIncome && category === 'disallowable') disallowableExpensesPence += totalPence;
    else if (!isIncome && category !== null && category !== 'turnover' && category !== 'other-income') {
      expenseCategories.set(category, (expenseCategories.get(category) ?? 0) + totalPence);
    } else {
      const existing = uncategorised.get(line.accountId);
      if (existing) existing.totalPence += totalPence;
      else uncategorised.set(line.accountId, { accountId: line.accountId, accountName: line.accountName, accountType: isIncome ? 'income' : 'expense', totalPence });
    }
  }

  const categoryTotals = [...expenseCategories].map(([taxCategory, totalPence]) => ({ taxCategory, totalPence }));
  const allowableExpensesPence = categoryTotals.reduce((total, row) => total + row.totalPence, 0);
  return {
    ...period,
    turnoverPence,
    otherIncomePence,
    expenseCategories: categoryTotals,
    allowableExpensesPence,
    disallowableExpensesPence,
    netProfitPence: turnoverPence + otherIncomePence - allowableExpensesPence,
    uncategorisedAccounts: [...uncategorised.values()],
  };
}
