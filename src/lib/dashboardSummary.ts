import { currentTaxYear } from './taxBands.js';
import { contributesToReturn, type LedgerLine } from './vat.js';

export interface DatePeriod {
  start: string; // inclusive YYYY-MM-DD
  end: string;
}

export interface LedgerTotals {
  incomePence: number;
  expensesPence: number;
  profitPence: number;
  vatCollectedPence: number;
  vatPaidPence: number;
}

export interface DashboardPeriods {
  taxYear: DatePeriod;
  month: DatePeriod;
  quarter: DatePeriod; // calendar quarter, an estimate of the VAT period only
}

const isoDay = (year: number, monthIndex: number, day: number) => new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);

/** The periods the dashboard sums over, as at `now`. The UK tax year starts on 6 April. */
export function dashboardPeriods(now: Date): DashboardPeriods {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const taxYearStart = Number(currentTaxYear(now).slice(0, 4));
  const quarterStartMonth = month - (month % 3);
  return {
    taxYear: { start: isoDay(taxYearStart, 3, 6), end: isoDay(taxYearStart + 1, 3, 5) },
    month: { start: isoDay(year, month, 1), end: isoDay(year, month + 1, 0) },
    quarter: { start: isoDay(year, quarterStartMonth, 1), end: isoDay(year, quarterStartMonth + 3, 0) },
  };
}

/** Sums with the same inclusion rule as the VAT return. Ledger signs flip so income and VAT collected read positive. */
export function summariseLedger(lines: LedgerLine[], period: DatePeriod): LedgerTotals {
  const totals = { incomePence: 0, expensesPence: 0, profitPence: 0, vatCollectedPence: 0, vatPaidPence: 0 };
  for (const line of lines) {
    if (!contributesToReturn(line, period)) continue;
    if (line.accountType === 'income') {
      totals.incomePence -= line.amountPence;
      totals.vatCollectedPence -= line.vatPence;
    } else {
      totals.expensesPence += line.amountPence;
      totals.vatPaidPence += line.vatPence;
    }
  }
  totals.profitPence = totals.incomePence - totals.expensesPence;
  return totals;
}
