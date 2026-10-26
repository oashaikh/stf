import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import type { AuthDeps } from '../auth';
import { withAuth } from '../auth';
import { vatConfirmHandler } from '../../vat/return-confirm';
import { vatReturnHandler } from '../../vat/return';
import {
  requireConfirmedReturn,
  VatReturnError,
  type DrillLine,
  type Period,
  type SavedDraft,
  type VatReturnStore,
} from '../vatReturns';

const period: Period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };

const line = (lineId: string, accountType: 'income' | 'expense', amountPence: number, vatPence: number): DrillLine => ({
  lineId,
  date: '2026-02-01',
  accountType,
  amountPence,
  vatPence,
  status: 'confirmed',
  deletedAt: null,
  description: lineId,
});

function makeStore(ledger: Record<string, DrillLine[]>) {
  const drafts = new Map<string, SavedDraft>();
  const audit: string[] = [];
  const store: VatReturnStore = {
    loadLedgerLines: async (userId) => ledger[userId] ?? [],
    findDraft: async (userId, key) => drafts.get(`${userId}:${key}`),
    saveDraft: async (userId, p, boxes) => {
      drafts.set(`${userId}:${p.periodKey}`, { status: 'draft', boxes, confirmedAt: null });
    },
    confirm: async (userId, p, boxes, now) => {
      drafts.set(`${userId}:${p.periodKey}`, { status: 'confirmed', boxes, confirmedAt: now.toISOString() });
      audit.push(`${userId}:vat_return.confirmed`);
    },
  };
  return { store, drafts, audit, ledger };
}

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token === 'a' || token === 'b' ? `clerk_${token}` : null),
    getEmail: async () => 'x@example.com',
  },
  users: { findId: async (id) => id.replace('clerk_', 'user_'), createIfAbsent: async () => 'unused' },
};

const call = (handler: ReturnType<typeof vatConfirmHandler>, init: RequestInit & { token?: string }, path = '') =>
  withAuth(handler, authDeps)(
    new Request(`https://x.test/api/vat/return-confirm${path}`, {
      ...init,
      headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
    }),
  );

const confirmPost = (token: string | undefined, body: unknown) =>
  ({ method: 'POST', token, body: JSON.stringify(body) }) as const;

const sales = [line('s1', 'income', -10000, -2000), line('p1', 'expense', 4000, 800)];

describe('confirm', () => {
  it('refuses without declaration:true and persists nothing', async () => {
    const { store, drafts, audit } = makeStore({ user_a: sales });
    for (const body of [{ ...period }, { ...period, declaration: false }, { ...period, declaration: 'true' }]) {
      const res = await call(vatConfirmHandler(store), confirmPost('a', body));
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ ok: false, code: 'DECLARATION_REQUIRED' });
    }
    expect(drafts.size).toBe(0);
    expect(audit).toEqual([]);
  });

  it('stores server-recomputed boxes and ignores client-supplied ones', async () => {
    const { store, drafts, audit } = makeStore({ user_a: sales });
    const res = await call(
      vatConfirmHandler(store),
      confirmPost('a', { ...period, declaration: true, boxes: { box1: 1, box5: -999999 }, box1: 1 }),
    );
    expect(res.status).toBe(200);
    const saved = drafts.get('user_a:26A1');
    expect(saved?.status).toBe('confirmed');
    expect(saved?.boxes).toMatchObject({ box1: 2000, box4: 800, box5: 1200, box6: 10000, box7: 4000 });
    expect(audit).toEqual(['user_a:vat_return.confirmed']);
  });

  it('confirms a nil return', async () => {
    const { store, drafts } = makeStore({});
    const res = await call(vatConfirmHandler(store), confirmPost('a', { ...period, declaration: true }));
    expect(res.status).toBe(200);
    expect(drafts.get('user_a:26A1')?.boxes).toMatchObject({ box1: 0, box5: 0, box6: 0 });
  });

  it('rejects unauthenticated and invalid-period requests without touching the store', async () => {
    const { store, drafts } = makeStore({ user_a: sales });
    const anonymous = await call(vatConfirmHandler(store), confirmPost(undefined, { ...period, declaration: true }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    const badPeriod = await call(vatConfirmHandler(store), confirmPost('a', { ...period, start: 'x', declaration: true }));
    expect(badPeriod.status).toBe(400);
    expect(drafts.size).toBe(0);
  });
});

describe('draft routes', () => {
  const put = (token: string, body: unknown) => call(vatReturnHandler(store0()), { method: 'PUT', token, body: JSON.stringify(body) });
  function store0() {
    return shared.store;
  }
  const shared = makeStore({ user_a: sales });

  it('saves a draft, refuses edits once confirmed unless reopened', async () => {
    expect((await put('a', period)).status).toBe(200);
    expect(shared.drafts.get('user_a:26A1')?.status).toBe('draft');
    await call(vatConfirmHandler(shared.store), confirmPost('a', { ...period, declaration: true }));
    const refused = await put('a', period);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ ok: false, code: 'ALREADY_CONFIRMED' });
    expect(shared.drafts.get('user_a:26A1')?.status).toBe('confirmed');
    expect((await put('a', { ...period, reopen: true })).status).toBe(200);
    expect(shared.drafts.get('user_a:26A1')?.status).toBe('draft');
  });

  it('GET returns bounded drill-down and gives a second user nothing of the first user', async () => {
    const url = `?periodKey=26A1&start=2026-01-01&end=2026-03-31`;
    const get = (token: string) =>
      withAuth(vatReturnHandler(shared.store), authDeps)(
        new Request(`https://x.test/api/vat/return${url}`, { headers: { authorization: `Bearer ${token}` } }),
      );
    const mine = await (await get('a')).json();
    expect(mine.data.boxes.box1).toBe(2000);
    expect(mine.data.drillDown.box1).toEqual([
      { lineId: 's1', date: '2026-02-01', amountPence: -10000, vatPence: -2000, description: 's1' },
    ]);
    const theirs = await (await get('b')).json();
    expect(theirs.data.boxes.box1).toBe(0);
    expect(theirs.data.status).toBeNull();
    expect(theirs.data.drillDown.box1).toEqual([]);
  });
});

describe('requireConfirmedReturn', () => {
  it('rejects a missing return', async () => {
    const { store } = makeStore({ user_a: sales });
    await expect(requireConfirmedReturn('user_a', period, store)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
  });

  it('rejects a draft', async () => {
    const { store } = makeStore({ user_a: sales });
    await store.saveDraft('user_a', period, { box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, box7: 0, box8: 0, box9: 0 });
    await expect(requireConfirmedReturn('user_a', period, store)).rejects.toBeInstanceOf(VatReturnError);
  });

  it('passes a fresh confirmed return and rejects it once the ledger changes', async () => {
    const { store, ledger } = makeStore({ user_a: sales });
    await call(vatConfirmHandler(store), confirmPost('a', { ...period, declaration: true }));
    await expect(requireConfirmedReturn('user_a', period, store)).resolves.toMatchObject({ box1: 2000 });
    ledger.user_a.push(line('s2', 'income', -500, -100));
    await expect(requireConfirmedReturn('user_a', period, store)).rejects.toMatchObject({ code: 'STALE_CONFIRMATION' });
  });

  it("does not let a second user pass on the first user's confirmation", async () => {
    const { store } = makeStore({ user_a: sales });
    await call(vatConfirmHandler(store), confirmPost('a', { ...period, declaration: true }));
    await expect(requireConfirmedReturn('user_b', period, store)).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
  });
});
