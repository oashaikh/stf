import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { accounts, transactionLines, transactions } from '../../server/src/db/schema.js';
import type { DatePeriod } from '../../src/lib/dashboardSummary.js';
import { buildTaxYearSummary, taxYearPeriod, type TaxYearLine, type TaxYearSummary } from '../../src/lib/taxYearSummary.js';
import { db } from './db.js';
import { LEDGER_LINE_LIMIT } from './vatReturns.js';

// Injected so tests never touch a database. Scoped by userId from the session.
export interface TaxYearSummaryStore {
  /** Confirmed or reconciled income and expense lines in the range, one joined query. Throws if over LEDGER_LINE_LIMIT. */
  loadLines(userId: string, period: DatePeriod): Promise<TaxYearLine[]>;
}

/** Reads `?taxYear=2026-27`. Returns the period, or null for anything else. */
export const parseTaxYearPeriod = (params: URLSearchParams): DatePeriod | null => taxYearPeriod(params.get('taxYear') ?? '');

export const getTaxYearSummary = async (store: TaxYearSummaryStore, userId: string, period: DatePeriod): Promise<TaxYearSummary> =>
  buildTaxYearSummary(await store.loadLines(userId, period), period);

// Query audit: filters on transactions.user_id and date, served by transactions_user_date_idx
// (user_id, date); accounts join on primary key and the same user; carries a LIMIT.
export const databaseTaxYearSummaryStore: TaxYearSummaryStore = {
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
