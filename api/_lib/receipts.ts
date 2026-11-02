import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { receiptExtractions, receipts } from '../../server/src/db/schema.js';
import { db } from './db.js';
import { plainText } from './inputRules.js';

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const UPLOAD_URL_SECONDS = 5 * 60;
export const READ_URL_SECONDS = 5 * 60;
export const RECEIPT_LIST_MAX_PAGE = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newReceiptSchema = z.object({
  fileName: plainText(200, { required: true }),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  sizeBytes: z.number().int().min(1).max(MAX_RECEIPT_BYTES),
});

// The query string is the only input; the owner comes from the session, never from here.
export const receiptListQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).transform((value) => Math.min(value, RECEIPT_LIST_MAX_PAGE)).default(RECEIPT_LIST_MAX_PAGE),
});

export type ReceiptCursor = { createdAt: string; id: string };

export type NewReceipt = z.infer<typeof newReceiptSchema>;
export type UploadStatus = 'pending' | 'ready' | 'failed';

/** Explicit columns only (SEC-12): no user_id and no file_key in responses. */
export interface StoredReceipt extends NewReceipt {
  id: string;
  uploadStatus: UploadStatus;
  createdAt: string;
  deletedAt: string | null;
}

export type ReceiptAiStatus = 'pending' | 'extracted' | 'failed' | 'skipped';

/** What was read from a receipt, by field name. A value stays a draft until the owner confirms it. */
export type ReceiptDetails = Record<string, { value: string; confirmed: boolean; confidence: number | null }>;

/** A list row keeps fileKey so the route can presign a read URL; the route never serialises it. */
export type ReceiptListRow = StoredReceipt & { fileKey: string; aiStatus: ReceiptAiStatus; details: ReceiptDetails };

/** The storage key is needed server-side to stat the object, so lookups return it; the route never serialises it. */
export type ReceiptRecord = StoredReceipt & { fileKey: string };

// Injected so tests never touch a database. Every call is scoped by userId from the session.
export interface ReceiptStore {
  insert(userId: string, receipt: NewReceipt & { fileKey: string }): Promise<StoredReceipt>;
  /** The live row for (id, userId), or undefined. */
  find(userId: string, id: string): Promise<ReceiptRecord | undefined>;
  setUploadStatus(userId: string, id: string, uploadStatus: UploadStatus): Promise<StoredReceipt | undefined>;
  /** One page of the owner's live receipts, newest first by (createdAt, id), starting after the cursor. Returns at most `limit` rows. */
  list(userId: string, after: ReceiptCursor | undefined, limit: number): Promise<ReceiptListRow[]>;
  /** Marks every read detail of the owner's receipt as confirmed. Undefined when the receipt is not theirs. */
  confirmDetails(userId: string, id: string): Promise<StoredReceipt | undefined>;
  /** Soft-delete only; the stored object is kept. */
  softDelete(userId: string, id: string): Promise<StoredReceipt | undefined>;
}

/** Returns the clean upload request, or null. Unknown keys such as userId are dropped. */
export const validateNewReceipt = (body: unknown): NewReceipt | null => {
  const parsed = newReceiptSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
};

export const validateReceiptId = (body: unknown): string | null => {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
};

export const encodeReceiptCursor = (cursor: ReceiptCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export function decodeReceiptCursor(value: string): ReceiptCursor | undefined {
  try {
    const parsed = z.object({ createdAt: z.string().datetime(), id: z.string().uuid() }).safeParse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const receiptColumns = {
  id: receipts.id,
  fileName: receipts.fileName,
  mimeType: receipts.mimeType,
  sizeBytes: receipts.sizeBytes,
  uploadStatus: receipts.uploadStatus,
  createdAt: receipts.createdAt,
  deletedAt: receipts.deletedAt,
};

const toStoredReceipt = <Row extends { mimeType: string; createdAt: Date; deletedAt: Date | null }>(row: Row) => ({
  ...row,
  mimeType: row.mimeType as NewReceipt['mimeType'],
  createdAt: row.createdAt.toISOString(),
  deletedAt: row.deletedAt?.toISOString() ?? null,
});

const liveRow = (userId: string, id: string) => and(eq(receipts.id, id), eq(receipts.userId, userId), isNull(receipts.deletedAt));

// Every statement is a single-row insert or filters on the primary key plus user_id, so none can return more than one row.
export const databaseReceiptStore: ReceiptStore = {
  async insert(userId, receipt) {
    const [row] = await db.insert(receipts).values({ userId, ...receipt }).returning(receiptColumns);
    return toStoredReceipt(row);
  },
  async find(userId, id) {
    const [row] = await db
      .select({ ...receiptColumns, fileKey: receipts.fileKey })
      .from(receipts)
      .where(liveRow(userId, id))
      .limit(1);
    return row ? toStoredReceipt(row) : undefined;
  },
  // Backed by receipts_user_created_idx (user_id, created_at, id); the limit bounds the page and one query serves the whole request.
  async list(userId, after, limit) {
    const rows = await db
      .select({ ...receiptColumns, fileKey: receipts.fileKey, aiStatus: receipts.aiStatus })
      .from(receipts)
      .where(
        and(
          eq(receipts.userId, userId),
          isNull(receipts.deletedAt),
          after ? or(lt(receipts.createdAt, new Date(after.createdAt)), and(eq(receipts.createdAt, new Date(after.createdAt)), lt(receipts.id, after.id))) : undefined,
        ),
      )
      .orderBy(desc(receipts.createdAt), desc(receipts.id))
      .limit(limit);
    // One query for the whole page, backed by receipt_extractions_receipt_idx; at most one row per read field per receipt.
    const extractions = rows.length
      ? await db
          .select({
            receiptId: receiptExtractions.receiptId,
            field: receiptExtractions.field,
            suggestedValue: receiptExtractions.suggestedValue,
            confidence: receiptExtractions.confidence,
            confirmedValue: receiptExtractions.confirmedValue,
            confirmedAt: receiptExtractions.confirmedAt,
          })
          .from(receiptExtractions)
          .where(inArray(receiptExtractions.receiptId, rows.map((row) => row.id)))
      : [];
    return rows.map((row) => ({
      ...toStoredReceipt(row),
      details: Object.fromEntries(
        extractions
          .filter((extraction) => extraction.receiptId === row.id)
          .map((extraction) => [extraction.field, { value: extraction.confirmedValue ?? extraction.suggestedValue, confirmed: extraction.confirmedAt !== null, confidence: extraction.confidence }]),
      ),
    }));
  },
  async confirmDetails(userId, id) {
    const [row] = await db.select(receiptColumns).from(receipts).where(liveRow(userId, id)).limit(1);
    if (!row) return undefined;
    await db
      .update(receiptExtractions)
      .set({ confirmedValue: sql`${receiptExtractions.suggestedValue}`, confirmedAt: new Date(), confirmedByUserId: userId })
      .where(and(eq(receiptExtractions.receiptId, id), isNull(receiptExtractions.confirmedAt)));
    return toStoredReceipt(row);
  },
  async setUploadStatus(userId, id, uploadStatus) {
    const [row] = await db.update(receipts).set({ uploadStatus }).where(liveRow(userId, id)).returning(receiptColumns);
    return row ? toStoredReceipt(row) : undefined;
  },
  async softDelete(userId, id) {
    const [row] = await db.update(receipts).set({ deletedAt: new Date() }).where(liveRow(userId, id)).returning(receiptColumns);
    return row ? toStoredReceipt(row) : undefined;
  },
};
