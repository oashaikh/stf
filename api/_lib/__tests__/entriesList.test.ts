import { PgDialect } from 'drizzle-orm/pg-core';
import { and } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createEntriesHandler } from '../../entries';
import type { AuthDeps } from '../auth';
import { decodeCursor, encodeCursor, entryListConditions, ENTRY_LIST_MAX_PAGE, type EntryListFilters, type EntryListRow, type EntryStore } from '../entries';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TRAVEL = id(2);

const row = (n: number, change: Partial<EntryListRow> = {}): EntryListRow => ({
  id: id(100 + n),
  date: '2026-02-01',
  description: `Entry ${n}`,
  reference: null,
  kind: 'expense',
  categoryAccountId: TRAVEL,
  categoryName: 'Travel',
  grossPence: 12000,
  netPence: 10000,
  vatPence: 2000,
  status: 'confirmed',
  hasReceipt: false,
  ...change,
});

// The fake mirrors the SQL contract: owner scope, newest first by (date, id), keyset after the cursor, limit honoured.
function fakeStore(rows: Array<EntryListRow & { userId: string }>) {
  const calls: Array<{ userId: string; filters: EntryListFilters; limit: number }> = [];
  const store: Pick<EntryStore, 'list'> = {
    async list(userId, filters, after, limit) {
      calls.push({ userId, filters, limit });
      return rows
        .filter((r) => r.userId === userId)
        .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
        .filter((r) => !after || r.date < after.date || (r.date === after.date && r.id < after.id))
        .slice(0, limit);
    },
  };
  return { store: store as EntryStore, calls };
}

const call = (store: EntryStore, query: string, userId = 'owner') =>
  createEntriesHandler(store, authDeps)(new Request(`https://app.test/api/entries${query}`, { method: 'GET', headers: { cookie: `stf_session=tok-${userId}` } }));

describe('entries list route', () => {
  it('serves the Expenses default view query and scopes it to the session owner', async () => {
    const { store, calls } = fakeStore([{ ...row(1), userId: 'owner' }, { ...row(2), userId: 'someone-else' }]);
    const response = await call(store, '?kind=expense&limit=50');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.entries.map((e: EntryListRow) => e.id)).toEqual([id(101)]);
    expect(body.nextCursor).toBeNull();
    expect(calls[0].userId).toBe('owner');
    expect(calls[0].filters.kind).toBe('expense');
  });

  it('ignores a client-supplied user id', async () => {
    const { store, calls } = fakeStore([]);
    await call(store, '?userId=victim&user_id=victim');
    expect(calls[0].userId).toBe('owner');
  });

  it('pages through every row exactly once, across a shared date', async () => {
    const rows = Array.from({ length: 7 }, (_, n) => ({ ...row(n, { date: n < 4 ? '2026-02-01' : '2026-01-15' }), userId: 'owner' }));
    const { store } = fakeStore(rows);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 10; pages += 1) {
      const body: { entries: EntryListRow[]; nextCursor: string | null } = await (await call(store, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`)).json();
      seen.push(...body.entries.map((e) => e.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('caps the page size and defaults it', async () => {
    const { store, calls } = fakeStore([]);
    await call(store, '?limit=5000');
    await call(store, '');
    // One extra row is requested to learn whether another page exists.
    expect(calls[0].limit).toBe(ENTRY_LIST_MAX_PAGE + 1);
    expect(calls[1].limit).toBe(ENTRY_LIST_MAX_PAGE + 1);
  });

  it('returns only the page size when more rows exist', async () => {
    const rows = Array.from({ length: ENTRY_LIST_MAX_PAGE + 5 }, (_, n) => ({ ...row(n), userId: 'owner' }));
    const { store } = fakeStore(rows);
    const body = await (await call(store, '?limit=5000')).json();
    expect(body.entries).toHaveLength(ENTRY_LIST_MAX_PAGE);
    expect(body.nextCursor).toEqual(expect.any(String));
  });

  it.each([
    ['bad date', '?from=2026-13-01'],
    ['reversed range', '?from=2026-03-01&to=2026-02-01'],
    ['bad kind', '?kind=asset'],
    ['bad status', '?status=voided'],
    ['non-uuid category', '?categoryAccountId=abc'],
    ['float amount', '?minAmountPence=10.5'],
    ['reversed amounts', '?minAmountPence=500&maxAmountPence=100'],
    ['zero limit', '?limit=0'],
    ['garbage cursor', '?cursor=not-a-cursor'],
    ['long search', `?search=${'x'.repeat(101)}`],
  ])('refuses a %s', async (_name, query) => {
    const { store, calls } = fakeStore([]);
    const response = await call(store, query);
    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('passes combined filters through', async () => {
    const { store, calls } = fakeStore([]);
    await call(store, `?from=2026-01-01&to=2026-03-31&kind=income&categoryAccountId=${TRAVEL}&status=draft&minAmountPence=100&maxAmountPence=9000&search=%20Train%20`);
    expect(calls[0].filters).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      kind: 'income',
      categoryAccountId: TRAVEL,
      status: 'draft',
      minAmountPence: 100,
      maxAmountPence: 9000,
      search: 'Train',
    });
  });

  it('requires sign-in', async () => {
    const { store } = fakeStore([]);
    const response = await createEntriesHandler(store, authDeps)(new Request('https://app.test/api/entries'));
    expect(response.status).toBe(401);
  });
});

describe('cursor', () => {
  it('round-trips and rejects tampering', () => {
    const cursor = { date: '2026-02-01', id: id(5) };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor('%%%')).toBeUndefined();
    expect(decodeCursor(Buffer.from('{"date":"x","id":"y"}').toString('base64url'))).toBeUndefined();
  });
});

describe('entryListConditions', () => {
  const render = (filters: EntryListFilters, after?: { date: string; id: string }) => {
    const query = new PgDialect().sqlToQuery(and(...entryListConditions('owner-id', filters, after))!);
    return { text: query.sql.toLowerCase(), params: query.params };
  };

  it('always scopes to the owner and excludes deleted and voided rows', () => {
    const { text, params } = render({ kind: 'both' });
    expect(params).toContain('owner-id');
    expect(text).toContain('"deleted_at" is null');
    expect(text).toContain('in (');
    expect(params).toEqual(expect.arrayContaining(['draft', 'confirmed', 'reconciled']));
    expect(params).not.toContain('voided');
  });

  it('binds search as an escaped, case-insensitive pattern', () => {
    const { text, params } = render({ kind: 'both', search: '50%_off\\' });
    expect(text).toContain('ilike');
    expect(params).toContain('%50\\%\\_off\\\\%');
  });

  it('adds a keyset condition after a cursor', () => {
    const { text, params } = render({ kind: 'both' }, { date: '2026-02-01', id: id(5) });
    expect(text).toMatch(/\("date", "id"\)|\(.*date.*,.*id.*\) </);
    expect(params).toEqual(expect.arrayContaining(['2026-02-01', id(5)]));
  });
});
