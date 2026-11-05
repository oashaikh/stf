import { withAuth, type AuthDeps } from './_lib/auth.js';
import { createReceiptStorage, type ReceiptStorage } from './_lib/receiptStorage.js';
import { databaseReceiptStore, decodeReceiptCursor, encodeReceiptCursor, READ_URL_SECONDS, receiptListQuerySchema, UPLOAD_URL_SECONDS, validateNewReceipt, validateReceiptId, type ReceiptStore, type StoredReceipt } from './_lib/receipts.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

// The record key from the store carries fileKey; only these columns reach the client.
const toResponse = ({ id, duplicateOfId, fileName, mimeType, sizeBytes, uploadStatus, createdAt, deletedAt }: StoredReceipt) => ({
  id,
  duplicateOfId,
  fileName,
  mimeType,
  sizeBytes,
  uploadStatus,
  createdAt,
  deletedAt,
});

// Storage is built per request so a deployment without storage settings answers 409 instead of failing to load.
export function createReceiptsHandler(store: ReceiptStore = databaseReceiptStore, storage?: ReceiptStorage, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'PUT' && request.method !== 'DELETE') return refuse(405, 'Method not allowed', 'METHOD');

    let receiptStorage: ReceiptStorage;
    try {
      receiptStorage = storage ?? createReceiptStorage();
    } catch (error) {
      // The message names only the missing variable, never a value.
      console.error('Receipt storage config error:', error instanceof Error ? error.message : 'unknown');
      return refuse(409, 'Receipt storage is not configured', 'STORAGE_UNAVAILABLE');
    }

    if (request.method === 'GET') {
      const query = receiptListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      const after = query.success && query.data.cursor !== undefined ? decodeReceiptCursor(query.data.cursor) : undefined;
      if (!query.success || (query.data.cursor !== undefined && !after)) return refuse(400, 'Limit must be a whole number from 1 and the cursor must come from a previous page', 'BAD_REQUEST');
      const { limit } = query.data;
      try {
        return await listPage(auth.userId, after, limit, receiptStorage);
      } catch (error) {
        // A read must not answer 5xx. Log the error name only: a database or signing message can echo keys or SQL.
        console.error('Receipt list error:', error instanceof Error ? error.name : 'unknown');
        return refuse(424, 'Receipts could not be loaded just now', 'RECEIPTS_UNAVAILABLE');
      }
    }

    const body = await request.json().catch(() => null);

    if (request.method === 'POST') {
      const upload = validateNewReceipt(body);
      if (!upload) return refuse(400, 'Receipt needs a file name, a JPEG, PNG, WEBP or PDF type and a size of 1 byte to 10 MB', 'BAD_REQUEST');
      const fileKey = `${auth.userId}/${crypto.randomUUID()}`;
      // Presign first so a signing failure leaves no pending row behind.
      const uploadUrl = await receiptStorage.presignUpload(fileKey, upload.mimeType, upload.sizeBytes, UPLOAD_URL_SECONDS);
      // A separate indexed lookup, outside any transaction; a repeat is only flagged, never refused.
      const duplicateOfId = upload.fileHash ? (await store.findDuplicateOf(auth.userId, upload.fileHash)) ?? null : null;
      const receipt = await store.insert(auth.userId, { ...upload, fileKey, duplicateOfId });
      return Response.json({ ok: true, receipt: toResponse(receipt), uploadUrl, expiresInSeconds: UPLOAD_URL_SECONDS });
    }

    const id = validateReceiptId(body);
    if (!id) return refuse(400, 'Receipt id must be a uuid', 'BAD_REQUEST');

    if (request.method === 'PATCH') {
      const record = await store.find(auth.userId, id);
      if (!record) return refuse(404, 'Receipt not found', 'NOT_FOUND');
      // The storage call runs outside any transaction (COD-4); each store call is its own statement.
      const stored = await receiptStorage.statObject(record.fileKey);
      const matches = stored !== null && stored.sizeBytes === record.sizeBytes && stored.mimeType === record.mimeType;
      if (!matches) console.error('Receipt upload failed check:', record.id, stored === null ? 'missing' : stored.sizeBytes !== record.sizeBytes ? 'size' : 'type');
      const receipt = await store.setUploadStatus(auth.userId, id, matches ? 'ready' : 'failed');
      if (!receipt) return refuse(404, 'Receipt not found', 'NOT_FOUND');
      return Response.json({ ok: true, receipt: toResponse(receipt) });
    }

    if (request.method === 'PUT') {
      const receipt = await store.confirmDetails(auth.userId, id);
      if (!receipt) return refuse(404, 'Receipt not found', 'NOT_FOUND');
      return Response.json({ ok: true, receipt: toResponse(receipt) });
    }

    const receipt = await store.softDelete(auth.userId, id);
    if (!receipt) return refuse(404, 'Receipt not found', 'NOT_FOUND');
    return Response.json({ ok: true, receipt: toResponse(receipt) });
  }, authDeps);

  async function listPage(userId: string, after: ReturnType<typeof decodeReceiptCursor>, limit: number, receiptStorage: ReceiptStorage): Promise<Response> {
    // One extra row tells us whether another page exists.
    const rows = await store.list(userId, after, limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    // Signing is local to the process and runs after the query has finished, outside any transaction (COD-4).
    const receipts = await Promise.all(
      page.map(async ({ id, duplicateOfId, fileName, mimeType, sizeBytes, uploadStatus, aiStatus, details, createdAt, fileKey }) => ({
        id,
        duplicateOfId,
        fileName,
        mimeType,
        sizeBytes,
        uploadStatus,
        aiStatus,
        details,
        createdAt,
        readUrl: uploadStatus === 'ready' ? await receiptStorage.presignRead(fileKey, READ_URL_SECONDS) : null,
      })),
    );
    return Response.json({ ok: true, receipts, nextCursor: rows.length > limit && last ? encodeReceiptCursor({ createdAt: last.createdAt, id: last.id }) : null });
  }
}

export default { fetch: createReceiptsHandler() };
