import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createReceiptsHandler } from '../../receipts';
import type { AuthDeps } from '../auth';
import type { ReceiptStorage } from '../receiptStorage';
import { MAX_RECEIPT_BYTES, type ReceiptDetails, type ReceiptListRow, type ReceiptStore, type StoredReceipt } from '../receipts';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

type Row = StoredReceipt & { userId: string; fileKey: string; details?: ReceiptDetails };

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
    async confirmDetails(userId, id) {
      calls.push('confirmDetails');
      const row = rows.find((candidate) => candidate.userId === userId && candidate.id === id && !candidate.deletedAt);
      if (row?.details) for (const detail of Object.values(row.details)) detail.confirmed = true;
      return row;
    },
    async list(userId, after, limit) {
      calls.push('list');
      return rows
        .filter((row) => row.userId === userId && !row.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .filter((row) => !after || row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row.id < after.id))
        .slice(0, limit)
        .map((row): ReceiptListRow => ({ ...row, aiStatus: 'pending', details: row.details ?? {} }));
    },
  };
  return { store, rows, calls };
}

function makeStorage(stored: { sizeBytes: number; mimeType: string } | null = null) {
  const readSigned: Array<{ key: string; expiresInSeconds: number }> = [];
  const presigned: Array<{ key: string; mimeType: string; sizeBytes: number; expiresInSeconds: number }> = [];
  const storage: ReceiptStorage = {
    async getObject() {
      throw new Error('The receipts route never reads file bytes');
    },
    async presignUpload(key, mimeType, sizeBytes, expiresInSeconds) {
      presigned.push({ key, mimeType, sizeBytes, expiresInSeconds });
      return `https://bucket.test/${key}?X-Amz-Signature=secretsig`;
    },
    async statObject() {
      return stored;
    },
    async presignRead(key, expiresInSeconds) {
      readSigned.push({ key, expiresInSeconds });
      return `https://bucket.test/${key}?X-Amz-Signature=readsig`;
    },
  };
  return { storage, presigned, readSigned };
}

const seed = (rows: Row[], userId: string, count: number, status: Row['uploadStatus'] = 'ready') => {
  for (let index = 0; index < count; index += 1) {
    const n = rows.length + 1;
    rows.push({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      userId,
      fileKey: `${userId}/key-${n}`,
      fileName: `receipt-${n}.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 100 + n,
      uploadStatus: status,
      createdAt: `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`,
      deletedAt: null,
    });
  }
};

const upload = { fileName: 'till-roll.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 };

const call = (store: ReceiptStore, storage: ReceiptStorage, method: string, user?: string, body?: unknown, query = '') =>
  createReceiptsHandler(store, storage, authDeps)(
    new Request(`https://app.test/api/receipts${query}`, {
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
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) expect((await call(store, storage, method, undefined, upload)).status).toBe(401);
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

  describe('GET', () => {
    it('refuses a signed-out list', async () => {
      const { store, calls } = makeStore();
      expect((await call(store, makeStorage().storage, 'GET')).status).toBe(401);
      expect(calls).toEqual([]);
    });

    it('lists the owner receipts newest first without keys or user ids', async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 3);
      const response = await call(store, makeStorage().storage, 'GET', 'owner_a');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.receipts.map((item: { fileName: string }) => item.fileName)).toEqual(['receipt-3.jpg', 'receipt-2.jpg', 'receipt-1.jpg']);
      expect(body.receipts[0]).toMatchObject({ uploadStatus: 'ready', aiStatus: 'pending', mimeType: 'image/jpeg' });
      expect(body.nextCursor).toBeNull();
      expect(Object.keys(body.receipts[0]).sort()).toEqual(['aiStatus', 'createdAt', 'details', 'fileName', 'id', 'mimeType', 'readUrl', 'sizeBytes', 'uploadStatus']);
    });

    it('never shows a second owner the first owner receipts, deleted ones included', async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 2);
      seed(rows, 'owner_b', 1);
      rows[2].deletedAt = '2026-10-09T00:00:00.000Z';
      const asB = await (await call(store, makeStorage().storage, 'GET', 'owner_b')).json();
      expect(asB.receipts).toEqual([]);
      const asA = await (await call(store, makeStorage().storage, 'GET', 'owner_a')).json();
      expect(asA.receipts).toHaveLength(2);
    });

    it('pages with a cursor and never returns more than the limit', async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 5);
      const { storage } = makeStorage();
      const first = await (await call(store, storage, 'GET', 'owner_a', undefined, '?limit=2')).json();
      expect(first.receipts.map((item: { fileName: string }) => item.fileName)).toEqual(['receipt-5.jpg', 'receipt-4.jpg']);
      expect(first.nextCursor).toEqual(expect.any(String));
      const second = await (await call(store, storage, 'GET', 'owner_a', undefined, `?limit=2&cursor=${first.nextCursor}`)).json();
      expect(second.receipts.map((item: { fileName: string }) => item.fileName)).toEqual(['receipt-3.jpg', 'receipt-2.jpg']);
      const third = await (await call(store, storage, 'GET', 'owner_a', undefined, `?limit=2&cursor=${second.nextCursor}`)).json();
      expect(third.receipts.map((item: { fileName: string }) => item.fileName)).toEqual(['receipt-1.jpg']);
      expect(third.nextCursor).toBeNull();
    });

    it('caps an oversize limit at the page maximum', async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 30);
      const body = await (await call(store, makeStorage().storage, 'GET', 'owner_a', undefined, '?limit=500')).json();
      expect(body.receipts).toHaveLength(25);
      expect(body.nextCursor).not.toBeNull();
    });

    it.each(['?limit=0', '?limit=abc', '?limit=1.5', '?cursor=not-a-cursor', `?cursor=${Buffer.from('{"id":"x"}').toString('base64url')}`])('refuses %s with 400', async (query) => {
      const { store, calls } = makeStore();
      expect((await call(store, makeStorage().storage, 'GET', 'owner_a', undefined, query)).status).toBe(400);
      expect(calls).not.toContain('list');
    });

    it('signs a 5 minute read URL for ready uploads only', async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 1, 'pending');
      seed(rows, 'owner_a', 1, 'failed');
      seed(rows, 'owner_a', 1, 'ready');
      const { storage, readSigned } = makeStorage();
      const body = await (await call(store, storage, 'GET', 'owner_a')).json();
      expect(body.receipts.map((item: { readUrl: string | null }) => item.readUrl !== null)).toEqual([true, false, false]);
      expect(readSigned).toEqual([{ key: 'owner_a/key-3', expiresInSeconds: 300 }]);
    });

    it('answers 503 when storage is not configured', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { store } = makeStore();
      const response = await createReceiptsHandler(store, undefined, authDeps)(new Request('https://app.test/api/receipts', { headers: { cookie: 'stf_session=tok-owner_a' } }));
      expect(response.status).toBe(503);
    });
  });

  describe('read details', () => {
    const draft = (): ReceiptDetails => ({ vendor: { value: 'Corner Cafe', confirmed: false }, totalPence: { value: '1250', confirmed: false } });

    it('returns the read details as unconfirmed drafts in the list', async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 1);
      rows[0].details = draft();
      const body = await (await call(store, makeStorage().storage, 'GET', 'owner_a')).json();
      expect(body.receipts[0].details).toEqual(draft());
    });

    it('confirms the details for their owner', async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 1);
      rows[0].details = draft();
      const response = await call(store, makeStorage().storage, 'PUT', 'owner_a', { id: rows[0].id });
      expect(response.status).toBe(200);
      expect(rows[0].details?.vendor.confirmed).toBe(true);
    });

    it("refuses another user's receipt id and confirms nothing", async () => {
      const { store, rows } = makeStore();
      seed(rows, 'owner_a', 1);
      rows[0].details = draft();
      const response = await call(store, makeStorage().storage, 'PUT', 'owner_b', { id: rows[0].id });
      expect(response.status).toBe(404);
      expect(rows[0].details?.vendor.confirmed).toBe(false);
    });
  });
});
