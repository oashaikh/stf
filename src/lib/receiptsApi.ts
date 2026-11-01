export type ReceiptUploadStatus = 'pending' | 'ready' | 'failed';

export interface ApiReceipt {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: ReceiptUploadStatus;
  createdAt: string;
}

export interface ListedReceipt extends ApiReceipt {
  aiStatus: string | null;
  readUrl: string | null;
}

// Mirrors the server schema in api/_lib/receipts.ts; the server stays the authority.
export const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export const receiptsQueryKey = ['receipts'];

/** Returns a message for a file the server would refuse, or null when it is acceptable. */
export function validateReceiptFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!RECEIPT_MIME_TYPES.includes(file.type)) return 'Receipts must be a JPEG, PNG, WEBP or PDF file.';
  if (file.size < 1) return 'That file is empty.';
  if (file.size > MAX_RECEIPT_BYTES) return 'Receipts must be 10 MB or smaller.';
  return null;
}

async function refusalMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === 'string' ? body.error : fallback;
}

async function sendReceiptId(method: 'PATCH' | 'DELETE', id: string, fallback: string): Promise<ApiReceipt> {
  const response = await fetch('/api/receipts', {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  if (!response.ok) throw new Error(await refusalMessage(response, fallback));
  return (await response.json()).receipt;
}

export async function fetchReceipts(cursor?: string): Promise<{ receipts: ListedReceipt[]; nextCursor: string | null }> {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : '';
  const response = await fetch(`/api/receipts${query}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load receipts');
  const body = await response.json();
  return { receipts: body.receipts, nextCursor: body.nextCursor ?? null };
}

/** Checks the file locally, then asks the server for a pending receipt and a signed upload URL. */
export async function startReceiptUpload(file: File): Promise<{ receipt: ApiReceipt; uploadUrl: string }> {
  const problem = validateReceiptFile(file);
  if (problem) throw new Error(problem);
  const response = await fetch('/api/receipts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
  });
  if (!response.ok) throw new Error(await refusalMessage(response, 'Could not start the upload. Please try again.'));
  const body = await response.json();
  return { receipt: body.receipt, uploadUrl: body.uploadUrl };
}

// XMLHttpRequest because fetch cannot report upload progress.
export function uploadToSignedUrl(uploadUrl: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('Content-Type', file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new Error('The upload was refused. Please try again.')));
    request.onerror = () => reject(new Error('The upload failed. Check your connection and try again.'));
    request.send(file);
  });
}

export const confirmReceiptUpload = (id: string) => sendReceiptId('PATCH', id, 'Could not confirm the upload. Please try again.');

export const removeReceipt = (id: string) => sendReceiptId('DELETE', id, 'Could not remove the receipt. Please try again.');
