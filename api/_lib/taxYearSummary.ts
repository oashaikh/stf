import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { accounts, transactionLines, transactions } from '../../server/src/db/schema.js';
import type { DatePeriod } from '../../src/lib/dashboardSummary.js';
import { TAX_BANDS } from '../../src/lib/taxBands.js';
import { compareExpenseMethods } from '../../src/lib/tradingAllowance.js';
import { buildTaxYearSummary, taxYearLabel, taxYearPeriod, type ExpenseMethod, type TaxYearLine, type TaxYearSummary } from '../../src/lib/taxYearSummary.js';
import { db } from './db.js';
import { databaseTradingAllowanceStore } from './tradingAllowance.js';
import { LEDGER_LINE_LIMIT } from './vatReturns.js';

// Injected so tests never touch a database. Scoped by userId from the session.
export interface TaxYearSummaryStore {
  /** Confirmed or reconciled income and expense lines in the range, one joined query. Throws if over LEDGER_LINE_LIMIT. */
  loadLines(userId: string, period: DatePeriod): Promise<TaxYearLine[]>;
  /** The owner's stored expense method for the tax year; undefined until they choose. */
  loadChoice(userId: string, taxYear: string): Promise<ExpenseMethod | undefined>;
}

/** Reads `?taxYear=2026-27`. Returns the period, or null unless the year is well formed and has tax bands (the allowance comes from there). */
export const parseTaxYearPeriod = (params: URLSearchParams): DatePeriod | null => {
  const taxYear = params.get('taxYear') ?? '';
  return taxYear in TAX_BANDS ? taxYearPeriod(taxYear) : null;
};

// netProfitPence is profit under the owner's chosen method, so the estimate and every other reader follow it.
export async function getTaxYearSummary(store: TaxYearSummaryStore, userId: string, period: DatePeriod): Promise<TaxYearSummary> {
  const taxYear = taxYearLabel(period);
  const [lines, choice] = await Promise.all([store.loadLines(userId, period), store.loadChoice(userId, taxYear)]);
  const actual = buildTaxYearSummary(lines, period);
  const expenseMethod = choice ?? 'actual';
  // Other business income counts towards the allowance threshold, so it is part of gross income.
  const comparison = compareExpenseMethods(actual.turnoverPence + actual.otherIncomePence, actual.allowableExpensesPence, taxYear);
  return {
    ...actual,
    netProfitPence: expenseMethod === 'allowance' ? comparison.allowanceProfitPence : comparison.actualProfitPence,
    expenseMethod,
    tradingAllowancePence: TAX_BANDS[taxYear].tradingAllowancePence,
    profitWithActualExpensesPence: comparison.actualProfitPence,
    profitWithAllowancePence: comparison.allowanceProfitPence,
    lowerProfitMethod: comparison.lowerProfitMethod,
  };
}

// Query audit: filters on transactions.user_id and date, served by transactions_user_date_idx
// (user_id, date); accounts join on primary key and the same user; carries a LIMIT.
export const databaseTaxYearSummaryStore: TaxYearSummaryStore = {
  loadChoice: (userId, taxYear) => databaseTradingAllowanceStore.get(userId, taxYear),

  async loadLines(userId, period) {
    const rows = await db
      .select({
        date: transactions.date,
        accountId: accounts.id,
        accountName: accounts.name,
        accountType: accounts.accountType,
        taxCategory: accounts.taxCategory,
        amountPence: transactionLines.amountPence,
        vatPence: transactionLines.vatPence,
        status: transactions.status,
        deletedAt: transactions.deletedAt,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .innerJoin(accounts, and(eq(transactionLines.accountId, accounts.id), eq(accounts.userId, userId)))
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          inArray(transactions.status, ['confirmed', 'reconciled']),
          inArray(accounts.accountType, ['income', 'expense']),
          gte(transactions.date, period.start),
          lte(transactions.date, period.end),
        ),
      )
      .limit(LEDGER_LINE_LIMIT + 1);
    if (rows.length > LEDGER_LINE_LIMIT) throw new Error('Ledger too large for one tax year summary');
    return rows.map((row) => ({ ...row, deletedAt: row.deletedAt?.toISOString() ?? null }));
  },
};
