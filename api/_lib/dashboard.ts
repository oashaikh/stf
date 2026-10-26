import { and, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import { accounts, transactionLines, transactions } from '../../server/src/db/schema.js';
import { dashboardPeriods, summariseLedger, type DatePeriod, type LedgerTotals } from '../../src/lib/dashboardSummary.js';
import type { LedgerLine } from '../../src/lib/vat.js';
import { db } from './db.js';
import { LEDGER_LINE_LIMIT } from './vatReturns.js';

export const RECENT_ENTRY_LIMIT = 5;
const RECENT_ENTRY_LINE_LIMIT = RECENT_ENTRY_LIMIT * 20;

export interface RecentEntry {
  id: string;
  date: string;
  description: string;
  status: 'draft' | 'confirmed' | 'reconciled';
  kind: 'income' | 'expense' | 'other';
  grossPence: number; // positive, net plus VAT
}

export interface DashboardSummary {
  taxYear: LedgerTotals & DatePeriod;
  month: LedgerTotals & DatePeriod;
  vatQuarter: DatePeriod & { vatCollectedPence: number; vatPaidPence: number };
  draftCount: number;
  recentEntries: RecentEntry[];
}

// Injected like VatReturnStore so tests never touch a database. Every method is scoped by userId.
export interface DashboardStore {
  /** Confirmed or reconciled income and expense totals per day and account type, one grouped query. Throws if over LEDGER_LINE_LIMIT. */
  loadDailyTotals(userId: string, period: DatePeriod): Promise<LedgerLine[]>;
  countDrafts(userId: string): Promise<number>;
  /** The newest RECENT_ENTRY_LIMIT live entries, two queries in all. */
  listRecentEntries(userId: string): Promise<RecentEntry[]>;
}

export async function getDashboardSummary(store: DashboardStore, userId: string, now: Date): Promise<DashboardSummary> {
  const { taxYear, month, quarter } = dashboardPeriods(now);
  const widest = {
    start: [taxYear.start, quarter.start].sort()[0],
    end: [taxYear.end, quarter.end].sort().reverse()[0],
  };
  const [days, draftCount, recentEntries] = await Promise.all([
    store.loadDailyTotals(userId, widest),
    store.countDrafts(userId),
    store.listRecentEntries(userId),
  ]);
  const { vatCollectedPence, vatPaidPence } = summariseLedger(days, quarter);
  return {
    taxYear: { ...taxYear, ...summariseLedger(days, taxYear) },
    month: { ...month, ...summariseLedger(days, month) },
    vatQuarter: { ...quarter, vatCollectedPence, vatPaidPence },
    draftCount,
    recentEntries,
  };
}

// Query audit: every query filters on transactions.user_id from the session. The daily totals and the
// recent list are served by transactions_user_date_idx (user_id, date) and carry a LIMIT; the draft count
// reads the same index and returns one row; recent lines come in by the transaction_id foreign key with a
// LIMIT, and accounts by primary key.
export const databaseDashboardStore: DashboardStore = {
  async loadDailyTotals(userId, period) {
    const rows = await db
      .select({
        date: transactions.date,
        accountType: accounts.accountType,
        amountPence: sql<string>`sum(${transactionLines.amountPence})`,
        vatPence: sql<string>`sum(${transactionLines.vatPence})`,
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
      .groupBy(transactions.date, accounts.accountType)
      .limit(LEDGER_LINE_LIMIT + 1);
    if (rows.length > LEDGER_LINE_LIMIT) throw new Error('Ledger too large for the dashboard summary');
    // The query already applied the inclusion rule, so each group stands in for a confirmed, live line.
    return rows.map((row) => ({
      date: row.date,
      accountType: row.accountType,
      amountPence: Number(row.amountPence),
      vatPence: Number(row.vatPence),
      status: 'confirmed',
      deletedAt: null,
    }));
  },

  async countDrafts(userId) {
    const [row] = await db
      .select({ drafts: count() })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.status, 'draft'), isNull(transactions.deletedAt)))
      .limit(1);
    return row?.drafts ?? 0;
  },

  async listRecentEntries(userId) {
    const headers = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        status: transactions.status,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), inArray(transactions.status, ['draft', 'confirmed', 'reconciled'])))
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(RECENT_ENTRY_LIMIT);
    if (headers.length === 0) return [];
    const totals = await db
      .select({
        transactionId: transactionLines.transactionId,
        accountType: accounts.accountType,
        grossPence: sql<string>`sum(${transactionLines.amountPence} + ${transactionLines.vatPence})`,
      })
      .from(transactionLines)
      .innerJoin(accounts, and(eq(transactionLines.accountId, accounts.id), eq(accounts.userId, userId)))
      .where(
        and(
          inArray(transactionLines.transactionId, headers.map((header) => header.id)),
          inArray(accounts.accountType, ['income', 'expense']),
        ),
      )
      .groupBy(transactionLines.transactionId, accounts.accountType)
      .limit(RECENT_ENTRY_LINE_LIMIT);
    return headers.map((header) => {
      // An entry can carry both income and expense lines; label it by the larger side.
      const total = totals
        .filter((candidate) => candidate.transactionId === header.id)
        .reduce<(typeof totals)[number] | undefined>(
          (largest, candidate) => (!largest || Math.abs(Number(candidate.grossPence)) > Math.abs(Number(largest.grossPence)) ? candidate : largest),
          undefined,
        );
      return {
        id: header.id,
        date: header.date,
        description: header.description,
        status: header.status as RecentEntry['status'],
        kind: total?.accountType === 'income' || total?.accountType === 'expense' ? total.accountType : 'other',
        grossPence: Math.abs(Number(total?.grossPence ?? 0)),
      };
    });
  },
};
