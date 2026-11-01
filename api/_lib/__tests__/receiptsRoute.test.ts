import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createReceiptsHandler } from '../../receipts';
import type { AuthDeps } from '../auth';
import type { ReceiptStorage } from '../receiptStorage';
import { MAX_RECEIPT_BYTES, type ReceiptStore, type StoredReceipt } from '../receipts';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

type Row = StoredReceipt & { userId: string; fileKey: string };

function makeStore() {
  const rows: Row[] = [];
  const calls: string[] = [];
  const store: ReceiptStore = {
    async insert(userId, receipt) {
      calls.push('insert');
      const row: Row = { ...receipt, userId, id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`, uploadStatus: 'pending', createdAt: '2026-10-01T10:00:00.000Z', deletedAt: null };
      rows.push(row);
      return row;
    },
    async find(userId, id) {
      calls.push('find');
      return rows.find((row) => row.userId === userId && row.id === id && !row.deletedAt);
    },
    async setUploadStatus(userId, id, uploadStatus) {
      calls.push('setUploadStatus');
      const row = rows.find((candidate) => candidate.userId === userId && candidate.id === id && !candidate.deletedAt);
      if (row) row.uploadStatus = uploadStatus;
      return row;
    },
    async softDelete(userId, id) {
      calls.push('softDelete');
      const row = rows.find((candidate) => candidate.userId === userId && candidate.id === id && !candidate.deletedAt);
      if (row) row.deletedAt = '2026-10-02T09:00:00.000Z';
      return row;
    },
  };
  return { store, rows, calls };
}

function makeStorage(stored: { sizeBytes: number; mimeType: string } | null = null) {
  const presigned: Array<{ key: string; mimeType: string; sizeBytes: number; expiresInSeconds: number }> = [];
  const storage: ReceiptStorage = {
    async presignUpload(key, mimeType, sizeBytes, expiresInSeconds) {
      presigned.push({ key, mimeType, sizeBytes, expiresInSeconds });
      return `https://bucket.test/${key}?X-Amz-Signature=secretsig`;
    },
    async statObject() {
      return stored;
    },
  };
  return { storage, presigned };
}

const upload = { fileName: 'till-roll.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };

const call = (store: ReceiptStore, storage: ReceiptStorage, method: string, user?: string, body?: unknown) =>
  createReceiptsHandler(store, storage, authDeps)(
    new Request('https://app.test/api/receipts', {
      method,
      headers: user ? { cookie: `stf_session=tok-${user}`, 'content-type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe('receipts route', () => {
  it('refuses every method when signed out', async () => {
    const { store, calls } = makeStore();
    const { storage } = makeStorage();
    for (const method of ['POST', 'PATCH', 'DELETE']) expect((await call(store, storage, method, undefined, upload)).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it.each([
    ['unsupported type', { ...upload, mimeType: 'image/gif' }],
    ['oversize', { ...upload, sizeBytes: MAX_RECEIPT_BYTES + 1 }],
    ['zero size', { ...upload, sizeBytes: 0 }],
    ['fractional size', { ...upload, sizeBytes: 10.5 }],
    ['control characters in name', { ...upload, fileName: 'a\u0000.jpg' }],
    ['missing name', { mimeType: 'image/png', sizeBytes: 5 }],
  ])('refuses a POST with %s and inserts nothing', async (_name, body) => {
    const { store, rows } = makeStore();
    const { storage, presigned } = makeStorage();
    expect((await call(store, storage, 'POST', 'owner_a', body)).status).toBe(400);
    expect(rows).toEqual([]);
    expect(presigned).toEqual([]);
  });

  it('creates a pending row under the session owner prefix and returns a 5 minute URL', async () => {
    const { store, rows } = makeStore();
    const { storage, presigned } = makeStorage();
    const response = await call(store, storage, 'POST', 'owner_a', { ...upload, userId: 'owner_b', fileKey: 'owner_b/x' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('owner_a');
    expect(rows[0].uploadStatus).toBe('pending');
    expect(rows[0].fileKey).toMatch(/^owner_a\/[0-9a-f-]{36}$/);
    expect(presigned[0]).toMatchObject({ key: rows[0].fileKey, mimeType: 'image/jpeg', sizeBytes: 2048, expiresInSeconds: 300 });
    expect(body.receipt.id).toBe(rows[0].id);
    expect(body.uploadUrl).toContain('X-Amz-Signature');
    expect(JSON.stringify(body.receipt)).not.toMatch(/userId|fileKey|owner_a/);
  });

  it('marks the receipt ready when size and type match', async () => {
    const { store, rows } = makeStore();
    await call(store, makeStorage().storage, 'POST', 'owner_a', upload);
    const { storage } = makeStorage({ sizeBytes: 2048, mimeType: 'image/jpeg' });
    const response = await call(store, storage, 'PATCH', 'owner_a', { id: rows[0].id });
    expect(response.status).toBe(200);
    expect((await response.json()).receipt.uploadStatus).toBe('ready');
    expect(rows[0].uploadStatus).toBe('ready');
  });

  it.each([
    ['size', { sizeBytes: 9999, mimeType: 'image/jpeg' }],
    ['type', { sizeBytes: 2048, mimeType: 'image/png' }],
    ['missing object', null],
  ])('marks the receipt failed on a %s mismatch', async (_name, stored) => {
    const { store, rows } = makeStore();
    await call(store, makeStorage().storage, 'POST', 'owner_a', upload);
    const response = await call(store, makeStorage(stored).storage, 'PATCH', 'owner_a', { id: rows[0].id });
    expect(response.status).toBe(200);
    expect((await response.json()).receipt.uploadStatus).toBe('failed');
    expect(rows[0].uploadStatus).toBe('failed');
  });

  it('soft-deletes on DELETE and keeps the row', async () => {
    const { store, rows } = makeStore();
    await call(store, makeStorage().storage, 'POST', 'owner_a', upload);
    const response = await call(store, makeStorage().storage, 'DELETE', 'owner_a', { id: rows[0].id });
    expect(response.status).toBe(200);
    expect(rows[0].deletedAt).not.toBeNull();
  });

  it('gives a second owner 404 on PATCH and DELETE and leaves the row unchanged', async () => {
    const { store, rows } = makeStore();
    await call(store, makeStorage().storage, 'POST', 'owner_a', upload);
    const snapshot = { ...rows[0] };
    const { storage } = makeStorage({ sizeBytes: 2048, mimeType: 'image/jpeg' });
    expect((await call(store, storage, 'PATCH', 'owner_b', { id: rows[0].id })).status).toBe(404);
    expect((await call(store, storage, 'DELETE', 'owner_b', { id: rows[0].id })).status).toBe(404);
    expect(rows[0]).toEqual(snapshot);
  });

  it('refuses a malformed id', async () => {
    const { store } = makeStore();
    expect((await call(store, makeStorage().storage, 'PATCH', 'owner_a', { id: 'nope' })).status).toBe(400);
  });

  it('writes no signed URL or key to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const { store, rows } = makeStore();
    await call(store, makeStorage().storage, 'POST', 'owner_a', upload);
    await call(store, makeStorage(null).storage, 'PATCH', 'owner_a', { id: rows[0].id });
    const output = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(output).not.toMatch(/secretsig|owner_a\//);
  });
});
