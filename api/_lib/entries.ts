import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  accounts,
  auditEvents,
  transactionLines,
  transactions,
  users,
  type AccountRow,
} from '../../server/src/db/schema.js';
import { BANK_ACCOUNT_CODE, TRADE_DEBTORS_CODE, VAT_CONTROL_CODE } from '../../src/lib/chartOfAccounts.js';
import { postEntry, type PostedLine } from '../../src/lib/postingRules.js';
import { databaseAccountStore } from './accounts.js';
import { db } from './db.js';

export const MAX_AMOUNT_PENCE = 1_000_000_000; // £10m; also keeps sums inside the integer column
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
}

export class EntryRuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Not a calendar date');

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

export function assertDateNotTooFarAhead(date: string, now: Date): void {
  const latest = new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
  if (date > latest) throw new EntryRuleError(400, 'BAD_REQUEST', `Date cannot be more than ${MAX_DAYS_AHEAD} days ahead`);
}

/** The route does no arithmetic: lines come only from postEntry. */
export async function createEntry(store: EntryStore, userId: string, input: NewEntry, now: Date): Promise<Entry> {
  assertDateNotTooFarAhead(input.date, now);
  const context = await store.loadPostingContext(userId, input.categoryAccountId);
  if (!context.category || context.category.archivedAt !== null || context.category.accountType !== input.kind) {
    throw new EntryRuleError(422, 'INVALID_ACCOUNT', 'Category must be one of your active accounts matching the entry kind');
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
  return store.create(userId, { date: input.date, description: input.description, reference: input.reference ?? null, status: input.status }, lines);
}

const lineColumns = {
  accountId: transactionLines.accountId,
  amountPence: transactionLines.amountPence,
  vatPence: transactionLines.vatPence,
  vatRatePercent: transactionLines.vatRatePercent,
};

const toPostedLines = (rows: Array<{ accountId: string; amountPence: number; vatPence: number; vatRatePercent: number }>) =>
  rows.map((row) => ({ ...row, vatRatePercent: row.vatRatePercent === 0 ? null : (row.vatRatePercent as PostedLine['vatRatePercent']) }));

// Query audit: transactions are read by primary key and user_id; lines by the transaction_id foreign key
// with a LIMIT; accounts by the unique (user_id, code) index. The category lookup is by primary key and user_id.
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
      const [row] = await tx
        .insert(transactions)
        .values({ userId, ...header, source: 'manual' })
        .returning({ id: transactions.id });
      await tx.insert(transactionLines).values(
        lines.map((line) => ({
          transactionId: row.id,
          accountId: line.accountId,
          amountPence: line.amountPence,
          vatPence: line.vatPence,
          vatRatePercent: line.vatRatePercent ?? 0,
        })),
      );
      const entry: Entry = { id: row.id, ...header, source: 'manual', lines };
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'entry.create',
        resourceType: 'transaction',
        resourceId: row.id,
        afterSnapshot: entry,
      });
      return entry;
    });
  },

  async get(userId, entryId) {
    const [header] = await db
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
    const lines = await db.select(lineColumns).from(transactionLines).where(eq(transactionLines.transactionId, entryId)).limit(ENTRY_LINE_LIMIT);
    return { ...header, status: header.status, source: 'manual', lines: toPostedLines(lines) };
  },
};
