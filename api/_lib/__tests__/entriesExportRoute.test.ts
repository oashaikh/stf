import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createEntriesExportHandler } from '../../entries-export';
import type { AuthDeps } from '../auth';
import { EXPORT_ROW_LIMIT, TOO_LARGE_MESSAGE, TOO_MANY_ROWS_MESSAGE, type ExportLine, type ExportStore } from '../entriesExport';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const row = (description: string): ExportLine => ({
  date: '2026-05-01',
  description,
  reference: null,
  accountCode: '4000',
  accountName: 'Sales',
  amountPence: -10000,
  vatPence: -2000,
  status: 'confirmed',
  source: 'manual',
});

// Rows per owner; voided entries never reach the store's result, as the real query excludes them.
const ledgers: Record<string, ExportLine[]> = { owner_a: [row('A sale')], owner_b: [row('B sale')] };

function makeStore() {
  const asked: { userId: string; from: string; to: string; limit: number }[] = [];
  const store: ExportStore = {
    async loadExportLines(userId, from, to, limit) {
      asked.push({ userId, from, to, limit });
      return ledgers[userId] ?? [];
    },
  };
  return { store, asked };
}

const get = (store: ExportStore, query: string, userId?: string, method = 'GET') =>
  createEntriesExportHandler(store, authDeps)(
    new Request(`https://app.test/api/entries-export?${query}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} }),
  );

const RANGE = 'from=2026-05-01&to=2026-05-31';

describe('entries-export route', () => {
  it('returns the signed-in owner CSV as a no-store attachment', async () => {
    const { store } = makeStore();
    const response = await get(store, RANGE, 'owner_a');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="entries-2026-05-01-to-2026-05-31.csv"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(body).toContain('A sale');
    expect(body).not.toContain('B sale');
  });

  it('uses the session user and ignores a client-supplied userId', async () => {
    const { store, asked } = makeStore();
    const body = await (await get(store, `${RANGE}&userId=owner_b&user_id=owner_b`, 'owner_a')).text();
    expect(asked).toEqual([{ userId: 'owner_a', from: '2026-05-01', to: '2026-05-31', limit: EXPORT_ROW_LIMIT + 1 }]);
    expect(body).not.toContain('B sale');
  });

  it('refuses a request without a session and never touches the store', async () => {
    const { store, asked } = makeStore();
    expect((await get(store, RANGE)).status).toBe(401);
    expect(asked).toEqual([]);
  });

  it('answers 405 to anything but GET', async () => {
    const { store } = makeStore();
    expect((await get(store, RANGE, 'owner_a', 'POST')).status).toBe(405);
  });

  it('refuses a range that is too large, inverted or malformed with a plain message and no CSV', async () => {
    const { store, asked } = makeStore();
    const large = await get(store, 'from=2026-01-01&to=2027-06-01', 'owner_a');
    expect(large.status).toBe(400);
    expect(await large.json()).toEqual({ ok: false, error: TOO_LARGE_MESSAGE, code: 'RANGE_TOO_LARGE' });
    for (const query of ['from=2026-05-31&to=2026-05-01', 'from=bad&to=2026-05-01']) {
      const response = await get(store, query, 'owner_a');
      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('application/json');
    }
    expect(asked).toEqual([]);
  });

  it('refuses a result over the row limit with a plain message', async () => {
    const store: ExportStore = { loadExportLines: async () => Array.from({ length: EXPORT_ROW_LIMIT + 1 }, () => row('x')) };
    const response = await get(store, RANGE, 'owner_a');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: TOO_MANY_ROWS_MESSAGE, code: 'TOO_MANY_ROWS' });
  });
});
