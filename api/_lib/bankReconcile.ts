import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { accounts, auditEvents, bankConnections, bankTransactions, transactionLines, transactions } from '../../server/src/db/schema.js';
import { proposeMatches, type BankLine, type MatchableEntry, type MatchProposal } from '../../src/lib/bankMatching.js';
import { BANK_ACCOUNT_CODE } from '../../src/lib/chartOfAccounts.js';
import { db } from './db.js';
import { createEntry, EntryRuleError, type EntryStore } from './entries.js';
import { plainText } from './inputRules.js';

export const OPEN_LINE_LIMIT = 100;
export const WINDOW_ENTRY_LIMIT = 500;
const MATCH_WINDOW_DAYS = 3;
const MS_PER_DAY = 86_400_000;

export type BankLineView = BankLine;

export type ReconcileOutcome = 'ok' | 'LINE_NOT_FOUND' | 'ENTRY_NOT_FOUND' | 'LINE_NOT_OPEN' | 'ENTRY_NOT_AVAILABLE' | 'NOT_MATCHED' | 'NOT_DISMISSED';

// Injected like EntryStore so route tests never touch a database. Every method is scoped by userId;
// a line belongs to the owner of its bank connection, an entry to transactions.user_id.
export interface ReconcileStore {
  /** The owner's unmatched lines, oldest first, at most `limit`. */
  listOpenLines(userId: string, limit: number): Promise<BankLineView[]>;
  /** The owner's confirmed (not yet reconciled) entries dated from..to with their signed bank-account amount, at most `limit`. */
  listConfirmedEntries(userId: string, from: string, to: string, limit: number): Promise<MatchableEntry[]>;
  /** The owner's line in any state; undefined when it is not theirs. */
  getLine(userId: string, lineId: string): Promise<(BankLineView & { status: string }) | undefined>;
  /** Line unmatched to matched and entry confirmed to reconciled, plus one bank.match audit event, in one transaction. */
  match(userId: string, lineId: string, entryId: string): Promise<ReconcileOutcome>;
  /** Line back to unmatched and its reconciled entry back to confirmed (a linked draft stays a draft). Audited. */
  unmatch(userId: string, lineId: string): Promise<ReconcileOutcome>;
  dismiss(userId: string, lineId: string, reason: string): Promise<ReconcileOutcome>;
  undismiss(userId: string, lineId: string): Promise<ReconcileOutcome>;
  /** Links an unmatched line to a draft entry already created for it. Audited as bank.create_entry. */
  linkDraft(userId: string, lineId: string, entryId: string): Promise<ReconcileOutcome>;
}

const lineId = z.string().uuid();

export const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('match'), lineId, entryId: z.string().uuid() }),
  z.object({ action: z.literal('unmatch'), lineId }),
  z.object({ action: z.literal('dismiss'), lineId, reason: plainText(200, { required: true }) }),
  z.object({ action: z.literal('undismiss'), lineId }),
  z.object({
    action: z.literal('createEntry'),
    lineId,
    categoryAccountId: z.string().uuid(),
    vatRatePercent: z.union([z.literal(0), z.literal(5), z.literal(20)]).default(0),
  }),
]);
export type ReconcileBody = z.infer<typeof bodySchema>;

/** The dates entries must fall in to be candidates for these lines: the lines' own range, widened by the close-match window. */
export function entryWindow(lines: BankLineView[]): { from: string; to: string } | undefined {
  if (!lines.length) return undefined;
  const dates = lines.map((line) => line.date).sort();
  const shift = (date: string, days: number) => new Date(Date.parse(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
  return { from: shift(dates[0], -MATCH_WINDOW_DAYS), to: shift(dates[dates.length - 1], MATCH_WINDOW_DAYS) };
}

export async function getProposals(store: ReconcileStore, userId: string): Promise<{ lines: BankLineView[]; proposals: MatchProposal[] }> {
  const lines = await store.listOpenLines(userId, OPEN_LINE_LIMIT);
  const window = entryWindow(lines);
  const entries = window ? await store.listConfirmedEntries(userId, window.from, window.to, WINDOW_ENTRY_LIMIT) : [];
  return { lines, proposals: proposeMatches(lines, entries).proposals };
}

const REFUSALS: Record<Exclude<ReconcileOutcome, 'ok'>, [number, string, string]> = {
  LINE_NOT_FOUND: [404, 'NOT_FOUND', 'Bank line not found'],
  ENTRY_NOT_FOUND: [404, 'NOT_FOUND', 'Entry not found'],
  LINE_NOT_OPEN: [409, 'LINE_NOT_OPEN', 'This bank line has already been sorted'],
  ENTRY_NOT_AVAILABLE: [409, 'ENTRY_NOT_AVAILABLE', 'This entry is already matched, or is not confirmed'],
  NOT_MATCHED: [409, 'NOT_MATCHED', 'This bank line is not matched'],
  NOT_DISMISSED: [409, 'NOT_DISMISSED', 'This bank line is not dismissed'],
};

export function assertOk(outcome: ReconcileOutcome): void {
  if (outcome !== 'ok') throw new EntryRuleError(...REFUSALS[outcome]);
}

/** Creates a DRAFT entry from the line (never confirmed: the owner reviews it) and links the line to it. */
export async function createDraftFromLine(
  store: ReconcileStore,
  entryStore: EntryStore,
  userId: string,
  body: Extract<ReconcileBody, { action: 'createEntry' }>,
  now: Date,
): Promise<{ id: string }> {
  const line = await store.getLine(userId, body.lineId);
  if (!line) throw new EntryRuleError(...REFUSALS.LINE_NOT_FOUND);
  if (line.status !== 'unmatched') throw new EntryRuleError(...REFUSALS.LINE_NOT_OPEN);
  const entry = await createEntry(
    entryStore,
    userId,
    {
      date: line.date,
      // Imported text is the bank's, not validated for us, so cap it to what an entry accepts.
      description: line.description.replace(/\p{Cc}/gu, ' ').trim().slice(0, 200) || 'Bank payment',
      kind: line.amountPence < 0 ? 'expense' : 'income',
      categoryAccountId: body.categoryAccountId,
      amountPence: Math.abs(line.amountPence),
      amountIs: 'gross',
      vatRatePercent: body.vatRatePercent,
      status: 'draft',
    },
    now,
  );
  const outcome = await store.linkDraft(userId, body.lineId, entry.id);
  if (outcome !== 'ok') {
    // The line was taken between the check and the link, so the draft would be an orphan.
    await entryStore.void(userId, entry.id);
    assertOk(outcome);
  }
  return entry;
}

type LineStatus = 'unmatched' | 'matched' | 'dismissed';
type LinePatch = { status: LineStatus; matchedTransactionId: string | null; dismissedReason: string | null };

// Thrown inside a database transaction to roll it back and report why.
class Refused extends Error {
  constructor(readonly outcome: ReconcileOutcome) {
    super(outcome);
  }
}

const ownedConnectionIds = (userId: string) =>
  db.select({ id: bankConnections.id }).from(bankConnections).where(and(eq(bankConnections.userId, userId), isNull(bankConnections.deletedAt)));

const lineColumns = {
  id: bankTransactions.id,
  date: bankTransactions.date,
  amountPence: bankTransactions.amountPence,
  description: bankTransactions.description,
  status: bankTransactions.status,
  matchedTransactionId: bankTransactions.matchedTransactionId,
  dismissedReason: bankTransactions.dismissedReason,
};

type Executor = Pick<typeof db, 'select' | 'insert' | 'update'>;

const snapshot = (line: LinePatch) => ({ status: line.status, matchedTransactionId: line.matchedTransactionId, dismissedReason: line.dismissedReason });

/**
 * Moves one owned line from `from` to `patch` and writes the audit event, inside the caller's transaction.
 * The update repeats the status check so two racing requests cannot both win.
 */
async function moveLine(executor: Executor, userId: string, id: string, from: LineStatus, patch: LinePatch, action: string, wrongState: ReconcileOutcome) {
  const [before] = await executor
    .select(lineColumns)
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, id), inArray(bankTransactions.connectionId, ownedConnectionIds(userId))))
    .limit(1);
  if (!before) throw new Refused('LINE_NOT_FOUND');
  if (before.status !== from) throw new Refused(wrongState);
  const moved = await executor
    .update(bankTransactions)
    .set(patch)
    .where(and(eq(bankTransactions.id, id), eq(bankTransactions.status, from)))
    .returning({ id: bankTransactions.id });
  if (!moved.length) throw new Refused(wrongState);
  await executor.insert(auditEvents).values({
    userId,
    actorType: 'user',
    action,
    resourceType: 'bank_transaction',
    resourceId: id,
    beforeSnapshot: snapshot(before),
    afterSnapshot: snapshot(patch),
  });
  return before;
}

async function setEntryStatus(executor: Executor, userId: string, entryId: string, from: 'confirmed' | 'reconciled', to: 'confirmed' | 'reconciled') {
  const changed = await executor
    .update(transactions)
    .set({ status: to, updatedAt: new Date() })
    .where(and(eq(transactions.id, entryId), eq(transactions.userId, userId), eq(transactions.status, from), isNull(transactions.deletedAt)))
    .returning({ id: transactions.id });
  return changed.length > 0;
}

async function run(work: (tx: Executor) => Promise<void>): Promise<ReconcileOutcome> {
  try {
    await db.transaction(async (tx) => work(tx));
    return 'ok';
  } catch (error) {
    if (error instanceof Refused) return error.outcome;
    throw error;
  }
}

// Query audit: lines are read by primary key, restricted to the owner's connections (bank_connections_user_id_idx) and
// listed through bank_transactions_connection_date_idx; entries through transactions_user_date_idx with lines found by
// transaction_lines_transaction_id_idx. Every list has a LIMIT; single-row reads use LIMIT 1. No network call runs in a transaction.
export const databaseReconcileStore: ReconcileStore = {
  async listOpenLines(userId, limit) {
    return db
      .select({ id: bankTransactions.id, date: bankTransactions.date, amountPence: bankTransactions.amountPence, description: bankTransactions.description })
      .from(bankTransactions)
      .where(and(inArray(bankTransactions.connectionId, ownedConnectionIds(userId)), eq(bankTransactions.status, 'unmatched')))
      .orderBy(asc(bankTransactions.date), asc(bankTransactions.id))
      .limit(limit);
  },

  async listConfirmedEntries(userId, from, to, limit) {
    const rows = await db
      .select({ id: transactions.id, date: transactions.date, grossPence: sql<string>`sum(${transactionLines.amountPence})` })
      .from(transactions)
      .innerJoin(transactionLines, eq(transactionLines.transactionId, transactions.id))
      .innerJoin(accounts, and(eq(accounts.id, transactionLines.accountId), eq(accounts.userId, userId), eq(accounts.code, BANK_ACCOUNT_CODE)))
      .where(and(eq(transactions.userId, userId), eq(transactions.status, 'confirmed'), isNull(transactions.deletedAt), gte(transactions.date, from), lte(transactions.date, to)))
      .groupBy(transactions.id, transactions.date)
      .orderBy(asc(transactions.date), asc(transactions.id))
      .limit(limit);
    return rows.map((row) => ({ id: row.id, date: row.date, grossPence: Number(row.grossPence) }));
  },

  async getLine(userId, id) {
    const [line] = await db
      .select({ id: bankTransactions.id, date: bankTransactions.date, amountPence: bankTransactions.amountPence, description: bankTransactions.description, status: bankTransactions.status })
      .from(bankTransactions)
      .where(and(eq(bankTransactions.id, id), inArray(bankTransactions.connectionId, ownedConnectionIds(userId))))
      .limit(1);
    return line;
  },

  match: (userId, id, entryId) =>
    run(async (tx) => {
      const [entry] = await tx
        .select({ status: transactions.status, deletedAt: transactions.deletedAt })
        .from(transactions)
        .where(and(eq(transactions.id, entryId), eq(transactions.userId, userId)))
        .limit(1);
      if (!entry) throw new Refused('ENTRY_NOT_FOUND');
      await moveLine(tx, userId, id, 'unmatched', { status: 'matched', matchedTransactionId: entryId, dismissedReason: null }, 'bank.match', 'LINE_NOT_OPEN');
      if (!(await setEntryStatus(tx, userId, entryId, 'confirmed', 'reconciled'))) throw new Refused('ENTRY_NOT_AVAILABLE');
    }),

  unmatch: (userId, id) =>
    run(async (tx) => {
      const before = await moveLine(tx, userId, id, 'matched', { status: 'unmatched', matchedTransactionId: null, dismissedReason: null }, 'bank.unmatch', 'NOT_MATCHED');
      if (before.matchedTransactionId) await setEntryStatus(tx, userId, before.matchedTransactionId, 'reconciled', 'confirmed');
    }),

  dismiss: (userId, id, reason) =>
    run(async (tx) => {
      await moveLine(tx, userId, id, 'unmatched', { status: 'dismissed', matchedTransactionId: null, dismissedReason: reason }, 'bank.dismiss', 'LINE_NOT_OPEN');
    }),

  undismiss: (userId, id) =>
    run(async (tx) => {
      await moveLine(tx, userId, id, 'dismissed', { status: 'unmatched', matchedTransactionId: null, dismissedReason: null }, 'bank.undismiss', 'NOT_DISMISSED');
    }),

  linkDraft: (userId, id, entryId) =>
    run(async (tx) => {
      await moveLine(tx, userId, id, 'unmatched', { status: 'matched', matchedTransactionId: entryId, dismissedReason: null }, 'bank.create_entry', 'LINE_NOT_OPEN');
    }),
};
