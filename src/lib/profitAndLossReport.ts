import type { ProfitAndLoss } from './profitAndLoss';
import { formatPenceRaw } from './money';

export type { ProfitAndLoss };

export async function fetchProfitAndLoss(start: string, end: string): Promise<ProfitAndLoss> {
  const response = await fetch(`/api/profit-and-loss?${new URLSearchParams({ start, end })}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load the report');
  return (await response.json()).data;
}

// A leading = + - @ makes spreadsheets run the cell as a formula, and category names are user typed.
const csvCell = (text: string) => {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Amounts are pounds with two decimals, taken from pence by money.ts. */
export function profitAndLossCsv(report: ProfitAndLoss): string {
  const line = (section: string, category: string, amount: string) => [csvCell(section), csvCell(category), amount].join(',');
  return [
    line('Section', 'Category', 'Amount (GBP)'),
    ...report.income.map((row) => line('Income', row.accountName, formatPenceRaw(row.totalPence))),
    line('Income', 'Total income', formatPenceRaw(report.incomePence)),
    ...report.expenses.map((row) => line('Expenses', row.accountName, formatPenceRaw(row.totalPence))),
    line('Expenses', 'Total expenses', formatPenceRaw(report.expensesPence)),
    line('Profit', 'Net profit', formatPenceRaw(report.profitPence)),
  ].join('\r\n') + '\r\n';
}
