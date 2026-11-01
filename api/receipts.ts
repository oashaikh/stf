import { withAuth, type AuthDeps } from './_lib/auth.js';
import { createReceiptStorage, type ReceiptStorage } from './_lib/receiptStorage.js';
import { databaseReceiptStore, UPLOAD_URL_SECONDS, validateNewReceipt, validateReceiptId, type ReceiptStore, type StoredReceipt } from './_lib/receipts.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

// The record key from the store carries fileKey; only these columns reach the client.
const toResponse = ({ id, fileName, mimeType, sizeBytes, uploadStatus, createdAt, deletedAt }: StoredReceipt) => ({
  id,
  fileName,
  mimeType,
  sizeBytes,
  uploadStatus,
  createdAt,
  deletedAt,
});

// Storage is built per request so a deployment without storage settings answers 503 instead of failing to load.
export function createReceiptsHandler(store: ReceiptStore = databaseReceiptStore, storage?: ReceiptStorage, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') return refuse(405, 'Method not allowed', 'METHOD');

    let receiptStorage: ReceiptStorage;
    try {
      receiptStorage = storage ?? createReceiptStorage();
    } catch {
      return refuse(503, 'Receipt storage is not configured', 'STORAGE_UNAVAILABLE');
    }

    const body = await request.json().catch(() => null);

    if (request.method === 'POST') {
      const upload = validateNewReceipt(body);
      if (!upload) return refuse(400, 'Receipt needs a file name, a JPEG, PNG, WEBP or PDF type and a size of 1 byte to 10 MB', 'BAD_REQUEST');
      const fileKey = `${auth.userId}/${crypto.randomUUID()}`;
      const receipt = await store.insert(auth.userId, { ...upload, fileKey });
      const uploadUrl = await receiptStorage.presignUpload(fileKey, upload.mimeType, upload.sizeBytes, UPLOAD_URL_SECONDS);
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
      const receipt = await store.setUploadStatus(auth.userId, id, matches ? 'ready' : 'failed');
      if (!receipt) return refuse(404, 'Receipt not found', 'NOT_FOUND');
      return Response.json({ ok: true, receipt: toResponse(receipt) });
    }

    const receipt = await store.softDelete(auth.userId, id);
    if (!receipt) return refuse(404, 'Receipt not found', 'NOT_FOUND');
    return Response.json({ ok: true, receipt: toResponse(receipt) });
  }, authDeps);
}

export default { fetch: createReceiptsHandler() };
