import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';

import { accounts, transactionLines, transactions } from '../../server/src/db/schema.js';
import { addPence, formatPenceRaw } from '../../src/lib/money.js';
import { db } from './db.js';

export const EXPORT_ROW_LIMIT = 20000;
export const EXPORT_MAX_RANGE_DAYS = 366;
const ROWS_PER_CHUNK = 500;
const DAY_MS = 86_400_000;

export interface ExportLine {
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  accountCode: string;
  accountName: string;
  // Raw ledger signs (architectures.md): debit positive, credit negative, so income reads negative.
  amountPence: number;
  vatPence: number;
  status: 'draft' | 'confirmed' | 'reconciled' | 'voided';
  source: string;
}

// Injected like DashboardStore so tests never touch a database. Scoped by userId.
export interface ExportStore {
  /** Live (not deleted) lines in the inclusive range, oldest first, at most `limit` rows. */
  loadExportLines(userId: string, from: string, to: string, limit: number): Promise<ExportLine[]>;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    // Rejects 2026-13-01 and rolled-over dates such as 2026-02-30.
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  });

const exportQuery = z.object({ from: isoDate, to: isoDate });

export const TOO_LARGE_MESSAGE = `That is too much to export at once. Choose a range of ${EXPORT_MAX_RANGE_DAYS} days or fewer.`;
export const TOO_MANY_ROWS_MESSAGE = `That range has more than ${EXPORT_ROW_LIMIT} rows. Choose a shorter range.`;

export type ExportRange = { from: string; to: string } | { error: string; code: 'INVALID_RANGE' | 'RANGE_TOO_LARGE' };

/** Only `from` and `to` are read; any other parameter, including a user id, is ignored. */
export function parseExportRange(params: URLSearchParams): ExportRange {
  const parsed = exportQuery.safeParse({ from: params.get('from'), to: params.get('to') });
  if (!parsed.success) return { error: 'Enter a valid from and to date as YYYY-MM-DD.', code: 'INVALID_RANGE' };
  const { from, to } = parsed.data;
  if (from > to) return { error: 'The from date must not be after the to date.', code: 'INVALID_RANGE' };
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  if (days > EXPORT_MAX_RANGE_DAYS) return { error: TOO_LARGE_MESSAGE, code: 'RANGE_TOO_LARGE' };
  return { from, to };
}

const HEADER = ['date', 'description', 'reference', 'account code', 'account name', 'net', 'VAT', 'gross', 'status', 'source'];

// RFC 4180 quoting. A leading = + - @ is prefixed with a quote so spreadsheets read it as text, not a formula.
function textCell(value: string | null): string {
  let text = value ?? '';
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(line: ExportLine): string {
  return [
    line.date,
    textCell(line.description),
    textCell(line.reference),
    textCell(line.accountCode),
    textCell(line.accountName),
    formatPenceRaw(line.amountPence),
    formatPenceRaw(line.vatPence),
    formatPenceRaw(addPence(line.amountPence, line.vatPence)),
    line.status,
    textCell(line.source),
  ].join(',');
}

/** The CSV as a stream of row chunks, so the whole body is never one string. */
export function buildCsv(lines: ExportLine[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${HEADER.join(',')}\r\n`));
    },
    pull(controller) {
      if (next >= lines.length) return controller.close();
      const chunk = lines.slice(next, next + ROWS_PER_CHUNK);
      next += chunk.length;
      controller.enqueue(encoder.encode(chunk.map((line) => `${csvRow(line)}\r\n`).join('')));
    },
  });
}

/** Loads one row over the cap to tell "exactly at the cap" from "too many". Returns an error message or the CSV. */
export async function exportEntries(store: ExportStore, userId: string, from: string, to: string) {
  const lines = await store.loadExportLines(userId, from, to, EXPORT_ROW_LIMIT + 1);
  if (lines.length > EXPORT_ROW_LIMIT) return { error: TOO_MANY_ROWS_MESSAGE } as const;
  return { csv: buildCsv(lines) } as const;
}

// Query audit: filters on transactions.user_id and date, served by transactions_user_date_idx (user_id, date);
// lines come in by transaction_lines_transaction_id_idx, accounts by primary key and the same user. Ordered by
// date then transaction id and carries a LIMIT. Voided entries (deleted_at set) are excluded.
export const databaseExportStore: ExportStore = {
  async loadExportLines(userId, from, to, limit) {
    return db
      .select({
        date: transactions.date,
        description: transactions.description,
        reference: transactions.reference,
        accountCode: accounts.code,
        accountName: accounts.name,
        amountPence: transactionLines.amountPence,
        vatPence: transactionLines.vatPence,
        status: transactions.status,
        source: transactions.source,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .innerJoin(accounts, and(eq(transactionLines.accountId, accounts.id), eq(accounts.userId, userId)))
      .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt), gte(transactions.date, from), lte(transactions.date, to)))
      .orderBy(asc(transactions.date), asc(transactions.id), asc(transactionLines.id))
      .limit(limit);
  },
};
