import { dashboardPeriods, type DatePeriod } from './dashboardSummary.js';
import { currentTaxYear } from './taxBands.js';
import { contributesToReturn, type LedgerLine } from './vat.js';

export interface ProfitLossLine extends LedgerLine {
  accountId: string;
  accountName: string;
}

export interface ProfitLossRow {
  accountId: string;
  accountName: string;
  totalPence: number; // positive for both income and expenses
}

export interface ProfitAndLoss extends DatePeriod {
  income: ProfitLossRow[];
  expenses: ProfitLossRow[];
  incomePence: number;
  expensesPence: number;
  profitPence: number;
}

export const PROFIT_AND_LOSS_PRESETS = ['this-tax-year', 'last-tax-year', 'last-quarter'] as const;
export type ProfitAndLossPreset = (typeof PROFIT_AND_LOSS_PRESETS)[number];

const isoDay = (year: number, monthIndex: number, day: number) => new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);

export function profitAndLossPresets(now: Date): Record<ProfitAndLossPreset, DatePeriod> {
  const thisStartYear = Number(currentTaxYear(now).slice(0, 4));
  const { quarter } = dashboardPeriods(now);
  const quarterStartMonth = Number(quarter.start.slice(5, 7)) - 1;
  const lastQuarterStart = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth - 3, 1));
  return {
    'this-tax-year': { start: isoDay(thisStartYear, 3, 6), end: isoDay(thisStartYear + 1, 3, 5) },
    'last-tax-year': { start: isoDay(thisStartYear - 1, 3, 6), end: isoDay(thisStartYear, 3, 5) },
    'last-quarter': {
      start: lastQuarterStart.toISOString().slice(0, 10),
      end: isoDay(lastQuarterStart.getUTCFullYear(), lastQuarterStart.getUTCMonth() + 3, 0),
    },
  };
}

/**
 * Income and expense totals per account for an inclusive range, using the VAT return's inclusion rule.
 * Ledger amounts are already net of VAT (VAT sits in vatPence), so the figures are net for a VAT
 * registered owner and equal to the full amount for one who is not.
 */
export function buildProfitAndLoss(lines: ProfitLossLine[], period: DatePeriod): ProfitAndLoss {
  const income = new Map<string, ProfitLossRow>();
  const expenses = new Map<string, ProfitLossRow>();
  for (const line of lines) {
    if (!contributesToReturn(line, period)) continue;
    const rows = line.accountType === 'income' ? income : expenses;
    const signed = line.accountType === 'income' ? -line.amountPence : line.amountPence; // income is a credit
    const row = rows.get(line.accountId) ?? { accountId: line.accountId, accountName: line.accountName, totalPence: 0 };
    row.totalPence += signed;
    rows.set(line.accountId, row);
  }
  const sum = (rows: Map<string, ProfitLossRow>) => [...rows.values()].reduce((total, row) => total + row.totalPence, 0);
  const incomePence = sum(income);
  const expensesPence = sum(expenses);
  return {
    ...period,
    income: [...income.values()],
    expenses: [...expenses.values()],
    incomePence,
    expensesPence,
    profitPence: incomePence - expensesPence,
  };
}
