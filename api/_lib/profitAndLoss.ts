import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { accounts, transactionLines, transactions } from '../../server/src/db/schema.js';
import type { DatePeriod } from '../../src/lib/dashboardSummary.js';
import {
  buildProfitAndLoss,
  PROFIT_AND_LOSS_PRESETS,
  profitAndLossPresets,
  type ProfitAndLoss,
  type ProfitAndLossPreset,
  type ProfitLossLine,
} from '../../src/lib/profitAndLoss.js';
import { db } from './db.js';
import { LEDGER_LINE_LIMIT } from './vatReturns.js';

// Injected so tests never touch a database. Scoped by userId from the session.
export interface ProfitAndLossStore {
  /** Confirmed or reconciled income and expense lines in the range, one joined query. Throws if over LEDGER_LINE_LIMIT. */
  loadLines(userId: string, period: DatePeriod): Promise<ProfitLossLine[]>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (value: string) => ISO_DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Reads `?preset=` or `?start=&end=`. Returns an error message for anything else. */
export function parseProfitAndLossPeriod(params: URLSearchParams, now: Date): DatePeriod | string {
  const preset = params.get('preset');
  if (preset !== null) {
    if (!(PROFIT_AND_LOSS_PRESETS as readonly string[]).includes(preset)) return 'Unknown preset';
    return profitAndLossPresets(now)[preset as ProfitAndLossPreset];
  }
  const start = params.get('start');
  const end = params.get('end');
  if (!start || !end || !isRealDate(start) || !isRealDate(end)) return 'Give a preset, or start and end as YYYY-MM-DD';
  if (start > end) return 'start must not be after end';
  return { start, end };
}

export const getProfitAndLoss = async (store: ProfitAndLossStore, userId: string, period: DatePeriod): Promise<ProfitAndLoss> =>
  buildProfitAndLoss(await store.loadLines(userId, period), period);

// Query audit: filters on transactions.user_id and date, served by transactions_user_date_idx
// (user_id, date); accounts join on primary key and the same user; carries a LIMIT.
export const databaseProfitAndLossStore: ProfitAndLossStore = {
  async loadLines(userId, period) {
    const rows = await db
      .select({
        date: transactions.date,
        accountId: accounts.id,
        accountName: accounts.name,
        accountType: accounts.accountType,
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
    if (rows.length > LEDGER_LINE_LIMIT) throw new Error('Ledger too large for one profit and loss report');
    return rows.map((row) => ({ ...row, deletedAt: row.deletedAt?.toISOString() ?? null }));
  },
};
