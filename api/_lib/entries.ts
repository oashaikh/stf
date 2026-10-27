import { and, asc, desc, eq, exists, ilike, inArray, isNull, lte, gte, or, isNotNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import {
  accounts,
  auditEvents,
  receipts,
  transactionLines,
  transactions,
  users,
  vatReturnDrafts,
  vatSubmissions,
  type AccountRow,
} from '../../server/src/db/schema.js';
import { BANK_ACCOUNT_CODE, TRADE_DEBTORS_CODE, VAT_CONTROL_CODE } from '../../src/lib/chartOfAccounts.js';
import { MAX_AMOUNT_PENCE } from '../../src/lib/entryForm.js';
import { postEntry, type PostedLine } from '../../src/lib/postingRules.js';
import { databaseAccountStore } from './accounts.js';
import { db } from './db.js';

export const MAX_DAYS_AHEAD = 7;
export const ENTRY_LINE_LIMIT = 10;

export interface EntryHeader {
  date: string;
  description: string;
  reference: string | null;
  status: 'draft' | 'confirmed';
}

export interface Entry extends EntryHeader {
  id: string;
  source: 'manual';
  lines: PostedLine[];
}

export interface PostingContext {
  /** Undefined when the account does not exist or belongs to someone else. */
  category: Pick<AccountRow, 'accountType' | 'archivedAt'> | undefined;
  hasVatNumber: boolean;
  bankAccountId: string;
  vatControlAccountId: string;
  debtorsAccountId: string;
}

// Injected like VatReturnStore so route tests never touch a database. Every method is scoped by userId.
export interface EntryStore {
  loadPostingContext(userId: string, categoryAccountId: string): Promise<PostingContext>;
  /** Writes the transaction, its lines and the entry.create audit event in one database transaction. */
  create(userId: string, header: EntryHeader, lines: PostedLine[]): Promise<Entry>;
  get(userId: string, entryId: string): Promise<Entry | undefined>;
  /** True when the date sits in a period with a confirmed VAT return draft or a submitted VAT submission. */
  isDateLocked(userId: string, date: string): Promise<boolean>;
  /** Voids the old transaction and writes the replacement plus one entry.edit audit event, in one database transaction. Undefined when the entry is not the owner's live entry. */
  replace(userId: string, entryId: string, header: EntryHeader, lines: PostedLine[]): Promise<Entry | undefined>;
  /** Soft-deletes the entry (status voided, deleted_at set) and writes entry.void. False when not found. */
  void(userId: string, entryId: string): Promise<boolean>;
  /** Flips a draft to confirmed and writes entry.confirm. Undefined when it is not the owner's live draft. */
  confirm(userId: string, entryId: string): Promise<Entry | undefined>;
  /** One page of the owner's live entries, newest first by (date, id), starting after the cursor. Returns at most `limit` rows. */
  list(userId: string, filters: EntryListFilters, after: EntryCursor | undefined, limit: number): Promise<EntryListRow[]>;
}

export const ENTRY_LIST_MAX_PAGE = 50;

export interface EntryListFilters {
  from?: string;
  to?: string;
  kind: 'income' | 'expense' | 'both';
  categoryAccountId?: string;
  status?: 'draft' | 'confirmed';
  /** Inclusive bounds on the gross amount. */
  minAmountPence?: number;
  maxAmountPence?: number;
  search?: string;
}

export interface EntryListRow {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  kind: 'income' | 'expense';
  categoryAccountId: string;
  categoryName: string;
  grossPence: number;
  netPence: number;
  vatPence: number;
  status: 'draft' | 'confirmed' | 'reconciled';
  hasReceipt: boolean;
}

export interface EntryCursor {
  date: string;
  id: string;
}

export class EntryRuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Form field the message belongs beside. */
    readonly field?: string,
  ) {
    super(message);
  }
}

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'Not a calendar date');

export const newEntrySchema = z.object({
  date: isoDate,
  description: z.string().trim().min(1).max(200),
  reference: z.string().trim().min(1).max(60).optional(),
  kind: z.enum(['income', 'expense']),
  categoryAccountId: z.string().uuid(),
  amountPence: z.number().int().positive().max(MAX_AMOUNT_PENCE),
  amountIs: z.enum(['gross', 'net']),
  vatRatePercent: z.union([z.literal(0), z.literal(5), z.literal(20)]).default(0),
  status: z.enum(['draft', 'confirmed']).default('confirmed'),
});
export type NewEntry = z.infer<typeof newEntrySchema>;

const optionalNonNegativeInt = z.coerce.number().int().min(0).max(MAX_AMOUNT_PENCE * 2).optional();

// The query string is the only input; the owner comes from the session, never from here.
export const entryListQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    kind: z.enum(['income', 'expense', 'both']).default('both'),
    categoryAccountId: z.string().uuid().optional(),
    status: z.enum(['draft', 'confirmed']).optional(),
    minAmountPence: optionalNonNegativeInt,
    maxAmountPence: optionalNonNegativeInt,
    search: z.string().trim().max(100).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).transform((value) => Math.min(value, ENTRY_LIST_MAX_PAGE)).default(ENTRY_LIST_MAX_PAGE),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, 'from is after to')
  .refine((query) => query.minAmountPence === undefined || query.maxAmountPence === undefined || query.minAmountPence <= query.maxAmountPence, 'min is above max');

export const encodeCursor = (cursor: EntryCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export function decodeCursor(value: string): EntryCursor | undefined {
  try {
    const parsed = z.object({ date: isoDate, id: z.string().uuid() }).safeParse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Fetches one extra row to learn whether another page exists, then trims it. */
export async function listEntries(store: EntryStore, userId: string, filters: EntryListFilters, after: EntryCursor | undefined, limit: number) {
  const rows = await store.list(userId, filters, after, limit + 1);
  const entries = rows.slice(0, limit);
  const last = entries[entries.length - 1];
  return { entries, nextCursor: rows.length > limit && last ? encodeCursor({ date: last.date, id: last.id }) : null };
}

export function assertDateNotTooFarAhead(date: string, now: Date): void {
  const latest = new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
  if (date > latest) throw new EntryRuleError(400, 'BAD_REQUEST', `Date cannot be more than ${MAX_DAYS_AHEAD} days ahead`, 'date');
}

export const PERIOD_LOCKED_MESSAGE =
  'This date is inside a VAT period that is confirmed or filed. Reopen the return first, or record a correction in the current period.';

async function assertDateOpen(store: EntryStore, userId: string, date: string): Promise<void> {
  if (await store.isDateLocked(userId, date)) throw new EntryRuleError(409, 'PERIOD_LOCKED', PERIOD_LOCKED_MESSAGE);
}

/** The route does no arithmetic: lines come only from postEntry. */
async function buildEntry(store: EntryStore, userId: string, input: NewEntry, now: Date) {
  assertDateNotTooFarAhead(input.date, now);
  await assertDateOpen(store, userId, input.date);
  const context = await store.loadPostingContext(userId, input.categoryAccountId);
  if (!context.category || context.category.archivedAt !== null || context.category.accountType !== input.kind) {
    throw new EntryRuleError(422, 'INVALID_ACCOUNT', 'Category must be one of your active accounts matching the entry kind', 'categoryAccountId');
  }
  const lines = postEntry({
    kind: input.kind,
    categoryAccountId: input.categoryAccountId,
    amountPence: input.amountPence,
    amountIs: input.amountIs,
    vatRatePercent: input.vatRatePercent,
    hasVatNumber: context.hasVatNumber,
    bankAccountId: context.bankAccountId,
    vatControlAccountId: context.vatControlAccountId,
    debtorsAccountId: context.debtorsAccountId,
  });
  const header: EntryHeader = { date: input.date, description: input.description, reference: input.reference ?? null, status: input.status };
  return { header, lines };
}

export async function createEntry(store: EntryStore, userId: string, input: NewEntry, now: Date): Promise<Entry> {
  const { header, lines } = await buildEntry(store, userId, input, now);
  return store.create(userId, header, lines);
}

async function loadOpenEntry(store: EntryStore, userId: string, entryId: string): Promise<Entry> {
  const entry = await store.get(userId, entryId);
  if (!entry) throw new EntryRuleError(404, 'NOT_FOUND', 'Entry not found');
  await assertDateOpen(store, userId, entry.date);
  return entry;
}

export async function editEntry(store: EntryStore, userId: string, entryId: string, input: NewEntry, now: Date): Promise<Entry> {
  await loadOpenEntry(store, userId, entryId);
  const { header, lines } = await buildEntry(store, userId, input, now);
  const replacement = await store.replace(userId, entryId, header, lines);
  if (!replacement) throw new EntryRuleError(404, 'NOT_FOUND', 'Entry not found');
  return replacement;
}

export async function voidEntry(store: EntryStore, userId: string, entryId: string): Promise<void> {
  await loadOpenEntry(store, userId, entryId);
  if (!(await store.void(userId, entryId))) throw new EntryRuleError(404, 'NOT_FOUND', 'Entry not found');
}

export async function confirmEntry(store: EntryStore, userId: string, entryId: string): Promise<Entry> {
  const entry = await loadOpenEntry(store, userId, entryId);
  if (entry.status !== 'draft') throw new EntryRuleError(409, 'NOT_DRAFT', 'Only a draft entry can be confirmed');
  const confirmed = await store.confirm(userId, entryId);
  if (!confirmed) throw new EntryRuleError(409, 'NOT_DRAFT', 'Only a draft entry can be confirmed');
  return confirmed;
}

const lineColumns = {
  accountId: transactionLines.accountId,
  amountPence: transactionLines.amountPence,
  vatPence: transactionLines.vatPence,
  vatRatePercent: transactionLines.vatRatePercent,
};

const toPostedLines = (rows: Array<{ accountId: string; amountPence: number; vatPence: number; vatRatePercent: number }>) =>
  rows.map((row) => ({ ...row, vatRatePercent: row.vatRatePercent === 0 ? null : (row.vatRatePercent as PostedLine['vatRatePercent']) }));

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

// Each entry has exactly one income or expense line (the category); the join to accounts picks it out.
const LIVE_STATUSES = ['draft', 'confirmed', 'reconciled'] as const;
const grossPenceSql = sql<number>`abs(${transactionLines.amountPence}) + abs(${transactionLines.vatPence})`;

export function entryListConditions(userId: string, filters: EntryListFilters, after: EntryCursor | undefined): SQL[] {
  const search = filters.search ? `%${escapeLike(filters.search)}%` : undefined;
  const conditions: Array<SQL | undefined> = [
    eq(transactions.userId, userId),
    isNull(transactions.deletedAt),
    // voided is excluded by listing the live statuses rather than negating, so a new status is opt-in.
    inArray(transactions.status, filters.status === 'draft' ? ['draft'] : filters.status === 'confirmed' ? ['confirmed', 'reconciled'] : [...LIVE_STATUSES]),
    filters.kind === 'both' ? inArray(accounts.accountType, ['income', 'expense']) : eq(accounts.accountType, filters.kind),
    filters.from ? gte(transactions.date, filters.from) : undefined,
    filters.to ? lte(transactions.date, filters.to) : undefined,
    filters.categoryAccountId ? eq(accounts.id, filters.categoryAccountId) : undefined,
    filters.minAmountPence !== undefined ? sql`${grossPenceSql} >= ${filters.minAmountPence}` : undefined,
    filters.maxAmountPence !== undefined ? sql`${grossPenceSql} <= ${filters.maxAmountPence}` : undefined,
    search ? or(ilike(transactions.description, search), ilike(transactions.reference, search)) : undefined,
    after ? sql`(${transactions.date}, ${transactions.id}) < (${after.date}, ${after.id})` : undefined,
  ];
  return conditions.filter((condition): condition is SQL => condition !== undefined);
}

// Works on the pool or inside a transaction.
export type Executor = Pick<typeof db, 'select' | 'insert' | 'update'>;

async function insertEntry(executor: Executor, userId: string, header: EntryHeader, lines: PostedLine[]): Promise<Entry> {
  const [row] = await executor
    .insert(transactions)
    .values({ userId, ...header, source: 'manual' })
    .returning({ id: transactions.id });
  await executor.insert(transactionLines).values(
    lines.map((line) => ({
      transactionId: row.id,
      accountId: line.accountId,
      amountPence: line.amountPence,
      vatPence: line.vatPence,
      vatRatePercent: line.vatRatePercent ?? 0,
    })),
  );
  return { id: row.id, ...header, source: 'manual', lines };
}

async function loadEntry(executor: Executor, userId: string, entryId: string): Promise<Entry | undefined> {
  const [header] = await executor
    .select({
      id: transactions.id,
      date: transactions.date,
      description: transactions.description,
      reference: transactions.reference,
      status: transactions.status,
    })
    .from(transactions)
    .where(and(eq(transactions.id, entryId), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .limit(1);
  if (!header || (header.status !== 'draft' && header.status !== 'confirmed')) return undefined;
  const lines = await executor.select(lineColumns).from(transactionLines).where(eq(transactionLines.transactionId, entryId)).limit(ENTRY_LINE_LIMIT);
  return { ...header, status: header.status, source: 'manual', lines: toPostedLines(lines) };
}

/** Marks the owner's live entry voided and returns its prior state; undefined if there is none. */
export async function voidLiveEntry(executor: Executor, userId: string, entryId: string): Promise<Entry | undefined> {
  const before = await loadEntry(executor, userId, entryId);
  if (!before) return undefined;
  const now = new Date();
  const voided = await executor
    .update(transactions)
    .set({ status: 'voided', deletedAt: now, updatedAt: now })
    .where(and(eq(transactions.id, entryId), eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .returning({ id: transactions.id });
  return voided.length ? before : undefined;
}

// Query audit: transactions are read by primary key and user_id; lines by the transaction_id foreign key
// with a LIMIT; accounts by the unique (user_id, code) index. The lock check uses the (user_id, period_key) unique
// index on drafts and submissions, with a LIMIT of 1. The list is served by transactions_user_date_idx (user_id, date)
// with lines found by transaction_lines_transaction_id_idx and receipts by their transaction_id; it always has a LIMIT. The category lookup is by primary key and user_id.
export const databaseEntryStore: EntryStore = {
  async loadPostingContext(userId, categoryAccountId) {
    await databaseAccountStore.seedDefaults(userId);
    const [[user], systemAccounts, [category]] = await Promise.all([
      db.select({ vatNumber: users.vatNumber }).from(users).where(eq(users.id, userId)).limit(1),
      db
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(and(eq(accounts.userId, userId), inArray(accounts.code, [BANK_ACCOUNT_CODE, TRADE_DEBTORS_CODE, VAT_CONTROL_CODE])))
        .orderBy(asc(accounts.code))
        .limit(3),
      db
        .select({ accountType: accounts.accountType, archivedAt: accounts.archivedAt })
        .from(accounts)
        .where(and(eq(accounts.id, categoryAccountId), eq(accounts.userId, userId)))
        .limit(1),
    ]);
    const idOf = (code: string) => {
      const found = systemAccounts.find((account) => account.code === code);
      if (!found) throw new Error('System account missing');
      return found.id;
    };
    return {
      category,
      hasVatNumber: Boolean(user?.vatNumber),
      bankAccountId: idOf(BANK_ACCOUNT_CODE),
      vatControlAccountId: idOf(VAT_CONTROL_CODE),
      debtorsAccountId: idOf(TRADE_DEBTORS_CODE),
    };
  },

  async create(userId, header, lines) {
    return db.transaction(async (tx) => {
      const entry = await insertEntry(tx, userId, header, lines);
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'entry.create',
        resourceType: 'transaction',
        resourceId: entry.id,
        afterSnapshot: entry,
      });
      return entry;
    });
  },

  async get(userId, entryId) {
    return loadEntry(db, userId, entryId);
  },

  async list(userId, filters, after, limit) {
    return db
      .select({
        id: transactions.id,
        date: transactions.date,
        description: transactions.description,
        reference: transactions.reference,
        kind: sql<'income' | 'expense'>`${accounts.accountType}`,
        categoryAccountId: accounts.id,
        categoryName: accounts.name,
        grossPence: grossPenceSql.mapWith(Number),
        netPence: sql<number>`abs(${transactionLines.amountPence})`.mapWith(Number),
        vatPence: sql<number>`abs(${transactionLines.vatPence})`.mapWith(Number),
        status: sql<EntryListRow['status']>`${transactions.status}`,
        hasReceipt: sql<boolean>`${exists(
          db.select({ one: sql`1` }).from(receipts).where(and(eq(receipts.transactionId, transactions.id), isNull(receipts.deletedAt))),
        )}`,
      })
      .from(transactions)
      .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
      .innerJoin(accounts, eq(accounts.id, transactionLines.accountId))
      .where(and(...entryListConditions(userId, filters, after)))
      .orderBy(desc(transactions.date), desc(transactions.id))
      .limit(limit);
  },

  async isDateLocked(userId, date) {
    // Submissions carry only a period key, so the dates come from the draft with the same key.
    const [locked] = await db
      .select({ id: vatReturnDrafts.id })
      .from(vatReturnDrafts)
      .leftJoin(
        vatSubmissions,
        and(
          eq(vatSubmissions.userId, vatReturnDrafts.userId),
          eq(vatSubmissions.periodKey, vatReturnDrafts.periodKey),
          eq(vatSubmissions.status, 'submitted'),
        ),
      )
      .where(
        and(
          eq(vatReturnDrafts.userId, userId),
          lte(vatReturnDrafts.periodStart, date),
          gte(vatReturnDrafts.periodEnd, date),
          or(eq(vatReturnDrafts.status, 'confirmed'), isNotNull(vatSubmissions.id)),
        ),
      )
      .limit(1);
    return Boolean(locked);
  },

  async replace(userId, entryId, header, lines) {
    return db.transaction(async (tx) => {
      const before = await voidLiveEntry(tx, userId, entryId);
      if (!before) return undefined;
      const after = await insertEntry(tx, userId, header, lines);
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'entry.edit',
        resourceType: 'transaction',
        resourceId: after.id,
        beforeSnapshot: before,
        afterSnapshot: after,
        metadata: { voidedId: before.id, replacementId: after.id },
      });
      return after;
    });
  },

  async void(userId, entryId) {
    return db.transaction(async (tx) => {
      const before = await voidLiveEntry(tx, userId, entryId);
      if (!before) return false;
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'entry.void',
        resourceType: 'transaction',
        resourceId: entryId,
        beforeSnapshot: before,
        afterSnapshot: { ...before, status: 'voided' },
      });
      return true;
    });
  },

  async confirm(userId, entryId) {
    return db.transaction(async (tx) => {
      const before = await loadEntry(tx, userId, entryId);
      if (!before || before.status !== 'draft') return undefined;
      const [updated] = await tx
        .update(transactions)
        .set({ status: 'confirmed', updatedAt: new Date() })
        .where(and(eq(transactions.id, entryId), eq(transactions.userId, userId), eq(transactions.status, 'draft'), isNull(transactions.deletedAt)))
        .returning({ id: transactions.id });
      if (!updated) return undefined;
      const after: Entry = { ...before, status: 'confirmed' };
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'entry.confirm',
        resourceType: 'transaction',
        resourceId: entryId,
        beforeSnapshot: before,
        afterSnapshot: after,
      });
      return after;
    });
  },
};
