import { isPropertyCategory } from './chartOfAccounts.js';
import type { DatePeriod } from './dashboardSummary.js';
import type { PropertyCumulativeSummary } from './hmrc/client.js';
import { penceToPounds } from './itsCumulativeUpdate.js';
import { contributesToReturn } from './vat.js';
import type { ExpenseCategoryTotal, TaxYearLine } from './taxYearSummary.js';

export interface PropertySummary extends DatePeriod {
  incomeCategories: ExpenseCategoryTotal[];
  expenseCategories: ExpenseCategoryTotal[];
}

type IncomeField = keyof NonNullable<PropertyCumulativeSummary['ukProperty']['income']>;
type ExpenseField = keyof NonNullable<PropertyCumulativeSummary['ukProperty']['expenses']>;

// Our property- slugs (chartOfAccounts.ts) to HMRC's fields. Premiums, reverse premiums and tax
// deducted have no category yet, so they are never sent.
const HMRC_INCOME_FIELD: Record<string, IncomeField> = { 'property-rent-received': 'periodAmount' };
const HMRC_EXPENSE_FIELD: Record<string, ExpenseField> = {
  'property-premises-running-costs': 'premisesRunningCosts',
  'property-repairs-maintenance': 'repairsAndMaintenance',
  'property-finance-costs': 'financialCosts',
  'property-professional-fees': 'professionalFees',
  'property-cost-of-services': 'costOfServices',
  'property-travel-costs': 'travelCosts',
  'property-other-costs': 'other',
};

/** Property lines only, same inclusion rule as the self-employment summary. Income comes out positive. */
export function buildPropertySummary(lines: TaxYearLine[], period: DatePeriod): PropertySummary {
  const income = new Map<string, number>();
  const expenses = new Map<string, number>();
  for (const line of lines) {
    if (!contributesToReturn(line, period) || !isPropertyCategory(line.taxCategory)) continue;
    const isIncome = line.accountType === 'income';
    const totals = isIncome ? income : expenses;
    totals.set(line.taxCategory!, (totals.get(line.taxCategory!) ?? 0) + (isIncome ? -line.amountPence : line.amountPence));
  }
  const rows = (totals: Map<string, number>) => [...totals].map(([taxCategory, totalPence]) => ({ taxCategory, totalPence }));
  return { ...period, incomeCategories: rows(income), expenseCategories: rows(expenses) };
}

// HMRC takes property amounts as JSON numbers. The text from penceToPounds has at most two decimals,
// so the number prints back exactly as the pounds figure shown to the owner.
const pounds = (pence: number): number => Number(penceToPounds(pence));

/** Maps the year-to-date property totals onto HMRC's cumulative request. Categories without a field are not sent. */
export function buildPropertyCumulativeSummary(summary: PropertySummary): PropertyCumulativeSummary {
  const income: NonNullable<PropertyCumulativeSummary['ukProperty']['income']> = {};
  for (const { taxCategory, totalPence } of summary.incomeCategories) {
    const field = HMRC_INCOME_FIELD[taxCategory];
    if (field) income[field] = pounds(totalPence);
  }
  const expenses: NonNullable<PropertyCumulativeSummary['ukProperty']['expenses']> = {};
  for (const { taxCategory, totalPence } of summary.expenseCategories) {
    const field = HMRC_EXPENSE_FIELD[taxCategory];
    if (field) expenses[field] = pounds(totalPence);
  }
  return {
    fromDate: summary.start,
    toDate: summary.end,
    ukProperty: {
      ...(Object.keys(income).length > 0 && { income }),
      ...(Object.keys(expenses).length > 0 && { expenses }),
    },
  };
}
