import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createMileageHandler } from '../../mileage';
import type { AuthDeps } from '../auth';
import { MILEAGE_TRIP_LIMIT, type MileageStore, type StoredTrip } from '../mileage';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const OTHER_ID = '2f0a6f0e-3b0c-4a63-9d53-6a1b5b6a7c10';

function makeStore() {
  const rows: Array<StoredTrip & { userId: string }> = [];
  const calls: Array<{ method: string; userId: string; limit?: number }> = [];
  let counter = 0;
  const store: MileageStore = {
    async list(userId, period, limit) {
      calls.push({ method: 'list', userId, limit });
      return rows.filter((row) => row.userId === userId && row.date >= period.start && row.date <= period.end).slice(0, limit);
    },
    async insert(userId, trip) {
      calls.push({ method: 'insert', userId });
      counter += 1;
      const row = {
        ...trip,
        userId,
        id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
        createdAt: `2026-10-01T10:00:0${counter}.000Z`,
        deletedAt: null,
      };
      rows.push(row);
      return { ...row, userId: undefined } as StoredTrip;
    },
    async void(userId, id) {
      calls.push({ method: 'void', userId });
      const row = rows.find((candidate) => candidate.userId === userId && candidate.id === id && !candidate.deletedAt);
      if (!row) return undefined;
      row.deletedAt = '2026-10-02T09:00:00.000Z';
      return row;
    },
  };
  return { store, rows, calls };
}

const trip = { date: '2026-07-10', from: 'Office', to: 'Client', purpose: 'Site visit', distanceTenths: 124, vehicleType: 'car' };

const call = (store: MileageStore, method: string, user?: string, body?: unknown, query = '?taxYear=2026-27') =>
  createMileageHandler(store, authDeps)(
    new Request(`https://app.test/api/mileage${query}`, {
      method,
      headers: user ? { cookie: `stf_session=tok-${user}`, 'content-type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );

describe('mileage route', () => {
  it('refuses every method when signed out', async () => {
    const { store, calls } = makeStore();
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      expect((await call(store, method, undefined, method === 'GET' ? undefined : trip)).status).toBe(401);
    }
    expect(calls).toEqual([]);
  });

  it('adds with the owner id from the session and ignores a client userId', async () => {
    const { store, rows } = makeStore();
    const response = await call(store, 'POST', 'owner_a', { ...trip, userId: 'owner_b' });
    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('owner_a');
    expect(Object.keys((await response.json()).trip)).not.toContain('userId');
  });

  it.each([
    ['bad date', { date: '2026-02-30' }],
    ['non-date', { date: 'yesterday' }],
    ['blank from', { from: '   ' }],
    ['long purpose', { purpose: 'x'.repeat(201) }],
    ['zero distance', { distanceTenths: 0 }],
    ['fractional distance', { distanceTenths: 12.4 }],
    ['huge distance', { distanceTenths: 10_000_000 }],
    ['bad vehicle', { vehicleType: 'tank' }],
  ])('rejects %s without touching the store', async (_name, override) => {
    const { store, calls } = makeStore();
    expect((await call(store, 'POST', 'owner_a', { ...trip, ...override })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('rejects a missing or non-uuid id on void', async () => {
    const { store } = makeStore();
    expect((await call(store, 'PATCH', 'owner_a', {})).status).toBe(400);
    expect((await call(store, 'DELETE', 'owner_a', { id: 'nope' })).status).toBe(400);
  });

  it('rejects a bad tax year on list', async () => {
    const { store, calls } = makeStore();
    for (const query of ['', '?taxYear=2026', '?taxYear=1999-00']) {
      expect((await call(store, 'GET', 'owner_a', undefined, query)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it('refuses a second user voiding the first user\'s trip and leaves it in place', async () => {
    const { store, rows } = makeStore();
    const added = (await (await call(store, 'POST', 'owner_a', trip)).json()).trip;
    expect((await call(store, 'PATCH', 'owner_b', { id: added.id })).status).toBe(404);
    expect(rows[0].deletedAt).toBeNull();
    expect((await call(store, 'PATCH', 'owner_b', { id: OTHER_ID })).status).toBe(404);
  });

  it('keeps voided trips in the list, flagged, and drops them from the claim', async () => {
    const { store } = makeStore();
    const first = (await (await call(store, 'POST', 'owner_a', trip)).json()).trip;
    await call(store, 'POST', 'owner_a', { ...trip, distanceTenths: 100 });
    const before = await (await call(store, 'GET', 'owner_a')).json();
    expect(before.trips).toHaveLength(2);
    expect(before.claim.totalPence).toBe(Math.round(224 * 4.5));

    expect((await call(store, 'DELETE', 'owner_a', { id: first.id })).status).toBe(200);
    const after = await (await call(store, 'GET', 'owner_a')).json();
    expect(after.trips).toHaveLength(2);
    expect(after.trips.find((t: { id: string }) => t.id === first.id).deletedAt).not.toBeNull();
    expect(after.claim.totalPence).toBe(450);
    expect((await call(store, 'GET', 'owner_b')).status).toBe(200);
    expect((await (await call(store, 'GET', 'owner_b')).json()).trips).toEqual([]);
  });

  it('lists within an explicit limit scoped to the session user', async () => {
    const { store, calls } = makeStore();
    await call(store, 'GET', 'owner_a', undefined, '?taxYear=2026-27&userId=owner_b');
    expect(calls).toEqual([{ method: 'list', userId: 'owner_a', limit: MILEAGE_TRIP_LIMIT + 1 }]);
  });

  it('refuses other methods', async () => {
    const { store } = makeStore();
    expect((await call(store, 'PUT', 'owner_a')).status).toBe(405);
  });
});
