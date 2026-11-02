import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { auditEvents, receiptExtractions, receipts } from '../../server/src/db/schema.js';
import { MAX_AMOUNT_PENCE } from '../../src/lib/entryForm.js';
import type { PostedLine } from '../../src/lib/postingRules.js';
import { db } from './db.js';
import { buildEntry, EntryRuleError, insertEntry, isoDate, type Entry, type EntryHeader, type EntryStore } from './entries.js';
import { plainText } from './inputRules.js';

// The owner's final values. The model's suggestions are never read here, and the owner comes from the session.
export const confirmReceiptSchema = z.object({
  id: z.string().uuid(),
  date: isoDate,
  supplier: plainText(60, { required: true }),
  grossPence: z.number().int().positive().max(MAX_AMOUNT_PENCE),
  vatRatePercent: z.union([z.literal(0), z.literal(5), z.literal(20)]),
  categoryAccountId: z.string().uuid(),
  description: plainText(200, { required: true }),
});
export type ConfirmReceiptInput = z.infer<typeof confirmReceiptSchema>;

export interface ReceiptConfirmState {
  aiStatus: 'pending' | 'extracted' | 'failed' | 'skipped';
  transactionId: string | null;
}

// Injected so route tests never touch a database. Every call is scoped by userId from the session.
export interface ReceiptConfirmStore {
  /** The owner's live, uploaded receipt, or undefined. */
  find(userId: string, id: string): Promise<ReceiptConfirmState | undefined>;
  /** Writes the expense, links the receipt, stamps each extraction row and writes receipt.confirm in one database transaction. Throws 409 when the receipt is already linked. */
  confirm(userId: string, id: string, header: EntryHeader, lines: PostedLine[], confirmedByField: Record<string, string>): Promise<Entry>;
  /** Marks the receipt skipped and writes receipt.discard. False when it is not the owner's unlinked receipt. */
  skip(userId: string, id: string): Promise<boolean>;
}

const notFound = () => new EntryRuleError(404, 'NOT_FOUND', 'Receipt not found');
const alreadyConfirmed = () => new EntryRuleError(409, 'ALREADY_CONFIRMED', 'This receipt is already an expense');

export async function confirmReceipt(store: ReceiptConfirmStore, entryStore: EntryStore, userId: string, input: ConfirmReceiptInput, now: Date): Promise<Entry> {
  const receipt = await store.find(userId, input.id);
  if (!receipt) throw notFound();
  if (receipt.transactionId) throw alreadyConfirmed();
  if (receipt.aiStatus !== 'extracted') throw new EntryRuleError(409, 'NOT_READ', 'This receipt has not been read yet');
  // Same date and category rules, and the same period lock, as a hand-entered expense.
  const { header, lines } = await buildEntry(
    entryStore,
    userId,
    { date: input.date, description: input.description, reference: input.supplier, kind: 'expense', categoryAccountId: input.categoryAccountId, amountPence: input.grossPence, amountIs: 'gross', vatRatePercent: input.vatRatePercent, status: 'confirmed' },
    now,
  );
  const vatPence = Math.abs(lines.find((line) => line.accountId === input.categoryAccountId)?.vatPence ?? 0);
  return store.confirm(userId, input.id, header, lines, {
    date: input.date,
    vendor: input.supplier,
    totalPence: String(input.grossPence),
    vatPence: String(vatPence),
    category: input.categoryAccountId,
  });
}

export async function discardReceipt(store: ReceiptConfirmStore, userId: string, id: string): Promise<void> {
  const receipt = await store.find(userId, id);
  if (!receipt) throw notFound();
  if (receipt.transactionId) throw alreadyConfirmed();
  if (!(await store.skip(userId, id))) throw notFound();
}

const EXTRACTION_ROW_LIMIT = 20;

// Query audit: receipts are read by primary key and user_id with LIMIT 1; extraction rows by receipt_extractions_receipt_idx with a LIMIT.
export const databaseReceiptConfirmStore: ReceiptConfirmStore = {
  async find(userId, id) {
    const [row] = await db
      .select({ aiStatus: receipts.aiStatus, transactionId: receipts.transactionId })
      .from(receipts)
      .where(and(eq(receipts.id, id), eq(receipts.userId, userId), eq(receipts.uploadStatus, 'ready'), isNull(receipts.deletedAt)))
      .limit(1);
    return row;
  },

  async confirm(userId, id, header, lines, confirmedByField) {
    return db.transaction(async (tx) => {
      const entry = await insertEntry(tx, userId, header, lines, 'receipt_ai');
      // The unlinked guard makes the second of two racing confirms fail and roll back its expense.
      const linked = await tx
        .update(receipts)
        .set({ transactionId: entry.id })
        .where(and(eq(receipts.id, id), eq(receipts.userId, userId), isNull(receipts.deletedAt), isNull(receipts.transactionId)))
        .returning({ id: receipts.id });
      if (linked.length === 0) throw alreadyConfirmed();
      const confirmedAt = new Date();
      const extractions = await tx.select({ id: receiptExtractions.id, field: receiptExtractions.field }).from(receiptExtractions).where(eq(receiptExtractions.receiptId, id)).limit(EXTRACTION_ROW_LIMIT);
      for (const extraction of extractions) {
        const confirmedValue = confirmedByField[extraction.field];
        if (confirmedValue === undefined) continue;
        await tx.update(receiptExtractions).set({ confirmedValue, confirmedAt, confirmedByUserId: userId }).where(eq(receiptExtractions.id, extraction.id));
      }
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'receipt.confirm',
        resourceType: 'receipt',
        resourceId: id,
        afterSnapshot: { transactionId: entry.id },
      });
      return entry;
    });
  },

  async skip(userId, id) {
    return db.transaction(async (tx) => {
      const skipped = await tx
        .update(receipts)
        .set({ aiStatus: 'skipped' })
        .where(and(eq(receipts.id, id), eq(receipts.userId, userId), isNull(receipts.deletedAt), isNull(receipts.transactionId)))
        .returning({ id: receipts.id });
      if (skipped.length === 0) return false;
      await tx.insert(auditEvents).values({ userId, actorType: 'user', action: 'receipt.discard', resourceType: 'receipt', resourceId: id });
      return true;
    });
  },
};
