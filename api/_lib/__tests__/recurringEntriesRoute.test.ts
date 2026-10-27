import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createRecurringEntriesHandler } from '../../recurring-entries';
import type { AuthDeps } from '../auth';
import { RECURRING_LIST_LIMIT, type RecurringStore, type Template } from '../recurringEntries';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CATEGORY = '33333333-3333-4333-8333-333333333333';

function makeStore() {
  const rows: Array<Template & { userId: string; deleted?: boolean }> = [];
  const limits: number[] = [];
  const live = (userId: string, id: string) => rows.find((row) => row.userId === userId && row.id === id && !row.deleted);
  const strip = ({ userId: _userId, deleted: _deleted, ...template }: Template & { userId: string; deleted?: boolean }): Template => template;
  const store: RecurringStore = {
    async list(userId, limit) {
      limits.push(limit);
      return rows.filter((row) => row.userId === userId && !row.deleted).slice(0, limit).map(strip);
    },
    async create(userId, input, anchorDay) {
      const row = { ...input, userId, anchorDay, paused: false, id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}` };
      rows.push(row);
      return strip(row);
    },
    async update(userId, id, patch) {
      const row = live(userId, id);
      if (!row) return undefined;
      Object.assign(row, patch);
      return strip(row);
    },
    async find(userId, id) {
      const row = live(userId, id);
      return row ? strip(row) : undefined;
    },
    async softDelete(userId, id) {
      const row = live(userId, id);
      if (row) row.deleted = true;
      return Boolean(row);
    },
    async ownsCategory(userId) {
      return userId === ALICE || userId === BOB;
    },
    async due() {
      return [];
    },
    async hasRun() {
      return false;
    },
    async recordRun() {
      return true;
    },
  };
  return { store, rows, limits };
}

const body = { kind: 'expense', categoryAccountId: CATEGORY, amountPence: 50000, amountIs: 'gross', vatRatePercent: 0, description: 'Rent', schedule: 'monthly', nextDate: '2026-11-30' };

const call = (store: RecurringStore, method: string, user?: string, payload?: unknown, query = '') =>
  createRecurringEntriesHandler(store, authDeps)(
    new Request(`https://app.test/api/recurring-entries${query}`, {
      method,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      headers: user ? { cookie: `stf_session=tok-${user}` } : {},
    }),
  );

describe('recurring entries route', () => {
  it('refuses a caller with no session', async () => {
    expect((await call(makeStore().store, 'GET')).status).toBe(401);
  });

  it('creates a template for the session user and ignores a client-supplied user id', async () => {
    const { store, rows } = makeStore();
    const response = await call(store, 'POST', ALICE, { ...body, userId: BOB });
    expect(response.status).toBe(200);
    expect(rows[0].userId).toBe(ALICE);
    expect(rows[0].anchorDay).toBe(30);
    expect(JSON.stringify(await response.json())).not.toContain('userId');
  });

  it('lists only the caller\'s templates with an explicit limit', async () => {
    const { store, limits } = makeStore();
    await call(store, 'POST', ALICE, body);
    await call(store, 'POST', BOB, body);
    const json = await (await call(store, 'GET', ALICE)).json();
    expect(json.templates).toHaveLength(1);
    expect(limits).toEqual([RECURRING_LIST_LIMIT]);
  });

  it.each(['PATCH', 'DELETE'])('refuses a second user %s on the first user\'s template id', async (method) => {
    const { store, rows } = makeStore();
    await call(store, 'POST', ALICE, body);
    const response = await call(store, method, BOB, method === 'PATCH' ? { paused: true } : undefined, `?id=${rows[0].id}`);
    expect(response.status).toBe(404);
    expect(rows[0].paused).toBe(false);
    expect(rows[0].deleted).toBeUndefined();
  });

  it('pauses and soft-deletes the owner\'s template', async () => {
    const { store, rows } = makeStore();
    await call(store, 'POST', ALICE, body);
    const id = rows[0].id;
    expect((await call(store, 'PATCH', ALICE, { paused: true }, `?id=${id}`)).status).toBe(200);
    expect(rows[0].paused).toBe(true);
    expect((await call(store, 'DELETE', ALICE, undefined, `?id=${id}`)).status).toBe(200);
    expect(rows[0].deleted).toBe(true);
    expect((await call(store, 'GET', ALICE).then((r) => r.json())).templates).toHaveLength(0);
  });

  it('rejects a bad body and a non-uuid id', async () => {
    const { store } = makeStore();
    expect((await call(store, 'POST', ALICE, { ...body, amountPence: 1.5 })).status).toBe(400);
    expect((await call(store, 'PATCH', ALICE, { paused: true }, '?id=nope')).status).toBe(400);
  });
});
