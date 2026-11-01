import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { receipts } from '../../server/src/db/schema.js';
import { db } from './db.js';
import { plainText } from './inputRules.js';

export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
export const UPLOAD_URL_SECONDS = 5 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newReceiptSchema = z.object({
  fileName: plainText(200, { required: true }),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  sizeBytes: z.number().int().min(1).max(MAX_RECEIPT_BYTES),
});

export type NewReceipt = z.infer<typeof newReceiptSchema>;
export type UploadStatus = 'pending' | 'ready' | 'failed';

/** Explicit columns only (SEC-12): no user_id and no file_key in responses. */
export interface StoredReceipt extends NewReceipt {
  id: string;
  uploadStatus: UploadStatus;
  createdAt: string;
  deletedAt: string | null;
}

/** The storage key is needed server-side to stat the object, so lookups return it; the route never serialises it. */
export type ReceiptRecord = StoredReceipt & { fileKey: string };

// Injected so tests never touch a database. Every call is scoped by userId from the session.
export interface ReceiptStore {
  insert(userId: string, receipt: NewReceipt & { fileKey: string }): Promise<StoredReceipt>;
  /** The live row for (id, userId), or undefined. */
  find(userId: string, id: string): Promise<ReceiptRecord | undefined>;
  setUploadStatus(userId: string, id: string, uploadStatus: UploadStatus): Promise<StoredReceipt | undefined>;
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
  async setUploadStatus(userId, id, uploadStatus) {
    const [row] = await db.update(receipts).set({ uploadStatus }).where(liveRow(userId, id)).returning(receiptColumns);
    return row ? toStoredReceipt(row) : undefined;
  },
  async softDelete(userId, id) {
    const [row] = await db.update(receipts).set({ deletedAt: new Date() }).where(liveRow(userId, id)).returning(receiptColumns);
    return row ? toStoredReceipt(row) : undefined;
  },
};
