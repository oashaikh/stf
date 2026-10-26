import { describe, expect, it, vi } from 'vitest';

const fakeDb = vi.hoisted(() => ({ calls: [] as string[], results: [] as unknown[][], db: {} as Record<string, unknown> }));
vi.mock('../db', () => ({ db: fakeDb.db }));

import type { AuthDeps } from '../auth';
import { withAuth } from '../auth';
import { vatConfirmHandler } from '../../vat/return-confirm';
import { vatReturnHandler } from '../../vat/return';
import {
  confirmReturn,
  databaseStore,
  saveReturnDraft,
  submissionSnapshot,
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
  const submissions = new Map<string, 'pending' | 'submitted' | 'failed'>();
  const store: VatReturnStore = {
    loadLedgerLines: async (userId) => ledger[userId] ?? [],
    findDraft: async (userId, key) => drafts.get(`${userId}:${key}`),
    saveDraft: async (userId, p, boxes, reopen) => {
      if (drafts.get(`${userId}:${p.periodKey}`)?.status === 'confirmed' && !reopen) return;
      drafts.set(`${userId}:${p.periodKey}`, { status: 'draft', periodStart: p.start, periodEnd: p.end, boxes, confirmedAt: null });
    },
    confirm: async (userId, p, boxes, now) => {
      drafts.set(`${userId}:${p.periodKey}`, { status: 'confirmed', periodStart: p.start, periodEnd: p.end, boxes, confirmedAt: now.toISOString() });
      audit.push(`${userId}:vat_return.confirmed`);
    },
    findSubmission: async (userId, key, sandbox) => {
      const status = submissions.get(`${userId}:${key}:${sandbox}`);
      return status && { status };
    },
    claimSubmission: async () => undefined,
    recordReceipt: async () => undefined,
    listReturnHistory: async () => [],
    markFailed: async () => undefined,
  };
  return { store, drafts, audit, ledger, submissions };
}

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token === 'a' || token === 'b' ? `owner_${token}` : null),
    getEmail: async () => 'x@example.com',
  },
  users: { findId: async (id) => id.replace('owner_', 'user_'), createIfAbsent: async () => 'unused' },
};

const call = (handler: ReturnType<typeof vatConfirmHandler>, init: RequestInit & { token?: string }, path = '') =>
  withAuth(handler, authDeps)(
    new Request(`https://x.test/api/vat/return-confirm${path}`, {
      ...init,
      headers: init.token ? { cookie: `stf_session=${init.token}` } : {},
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
        new Request(`https://x.test/api/vat/return${url}`, { headers: { cookie: `stf_session=${token}` } }),
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
    await store.saveDraft('user_a', period, { box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0, box7: 0, box8: 0, box9: 0 }, false);
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

  it('rejects a confirmation made for different period dates under the same key', async () => {
    const { store } = makeStore({ user_a: sales });
    await call(vatConfirmHandler(store), confirmPost('a', { ...period, declaration: true }));
    await expect(
      requireConfirmedReturn('user_a', { ...period, end: '2026-04-30' }, store),
    ).rejects.toMatchObject({ code: 'STALE_CONFIRMATION' });
  });
});

describe('review of a confirmed return', () => {
  const review = async (shared: ReturnType<typeof makeStore>) => {
    const res = await withAuth(vatReturnHandler(shared.store), authDeps)(
      new Request(`https://x.test/api/vat/return?${new URLSearchParams({ periodKey: period.periodKey, start: period.start, end: period.end })}`, {
        headers: { cookie: 'stf_session=a' },
      }),
    );
    return (await res.json()).data;
  };

  it('flags a confirmation as stale once the ledger changes', async () => {
    const shared = makeStore({ user_a: [...sales] });
    await call(vatConfirmHandler(shared.store), confirmPost('a', { ...period, declaration: true }));
    expect((await review(shared)).stale).toBe(false);
    shared.ledger.user_a.push(line('s2', 'income', -500, -100));
    expect((await review(shared)).stale).toBe(true);
  });

  it('reports the full line count when the drill-down is cut short', async () => {
    const many = Array.from({ length: 60 }, (_, index) => line(`s${index}`, 'income', -100, -20));
    const data = await review(makeStore({ user_a: many }));
    expect(data.drillDown.box1).toHaveLength(50);
    expect(data.drillDownTotals.box1).toBe(60);
  });

  it('returns the HMRC receipt of a submitted period, preferring live over sandbox', async () => {
    const shared = makeStore({ user_a: sales });
    expect((await review(shared)).submission).toBeNull();
    const processingDate = new Date('2026-04-02T10:00:00Z');
    shared.store.findSubmission = async (_userId, _key, sandbox) => ({
      status: 'submitted',
      formBundleNumber: sandbox ? 'SANDBOX-1' : 'LIVE-1',
      processingDate,
    });
    expect((await review(shared)).submission).toEqual({
      formBundleNumber: 'LIVE-1',
      processingDate: processingDate.toISOString(),
      sandbox: false,
    });
  });
});


describe('a period filed with HMRC', () => {
  const confirmed = async (shared: ReturnType<typeof makeStore>) => {
    await confirmReturn(shared.store, 'user_a', period, new Date());
  };

  it.each(['pending', 'submitted'] as const)('cannot be reopened or re-confirmed once live and %s', async (status) => {
    const shared = makeStore({ user_a: sales });
    await confirmed(shared);
    shared.submissions.set('user_a:26A1:false', status);
    await expect(saveReturnDraft(shared.store, 'user_a', period, true)).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
    await expect(confirmReturn(shared.store, 'user_a', period, new Date())).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
    expect(shared.drafts.get('user_a:26A1')?.status).toBe('confirmed');
  });

  it('can be edited after a sandbox submission or a failed live attempt', async () => {
    const shared = makeStore({ user_a: sales });
    await confirmed(shared);
    shared.submissions.set('user_a:26A1:true', 'submitted');
    shared.submissions.set('user_a:26A1:false', 'failed');
    await expect(saveReturnDraft(shared.store, 'user_a', period, true)).resolves.toMatchObject({ status: 'draft' });
    await expect(confirmReturn(shared.store, 'user_a', period, new Date())).resolves.toMatchObject({ status: 'confirmed' });
  });
});

describe('submission audit snapshot', () => {
  it('keeps request, response and fraud headers but drops any Authorization value', () => {
    const snapshot = submissionSnapshot({
      periodKey: '26A1',
      sandbox: true,
      request: { periodKey: '26A1', vatDueSales: 10 },
      response: { formBundleNumber: '123' },
      fraudHeaders: { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER', Authorization: 'Bearer secret-token' },
    });
    expect(snapshot.request).toEqual({ periodKey: '26A1', vatDueSales: 10 });
    expect(snapshot.response).toEqual({ formBundleNumber: '123' });
    expect(snapshot.fraudHeaders).toEqual({ 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' });
    expect(JSON.stringify(snapshot)).not.toContain('secret-token');
  });
});

describe('databaseStore submission statements', () => {
  // Every builder method returns the chain; awaiting it yields the next queued result.
  const chain = (name: string): unknown =>
    new Proxy(() => undefined, {
      get: (_, method) => {
        if (method === 'then') return (resolve: (rows: unknown[]) => void) => resolve(fakeDb.results.shift() ?? []);
        fakeDb.calls.push(`${name}.${String(method)}`);
        return () => chain(name);
      },
    });
  const begin = (results: unknown[][]) => {
    fakeDb.calls.length = 0;
    fakeDb.results = results;
    Object.assign(fakeDb.db, {
      insert: () => (fakeDb.calls.push('insert'), chain('insert')),
      update: () => (fakeDb.calls.push('update'), chain('update')),
      transaction: async (run: (tx: unknown) => Promise<void>) => {
        fakeDb.calls.push('begin');
        await run({ insert: fakeDb.db.insert, update: fakeDb.db.update });
        fakeDb.calls.push('commit');
      },
    });
  };
  const audit = { periodKey: '26A1', sandbox: true, request: {}, response: {}, fraudHeaders: {} };

  it('claims with one conditional upsert and no transaction', async () => {
    begin([[{ id: 'sub1' }]]);
    await expect(databaseStore.claimSubmission('user_a', '26A1', false)).resolves.toBe('sub1');
    expect(fakeDb.calls.filter((call) => call === 'insert')).toHaveLength(1);
    expect(fakeDb.calls).toContain('insert.onConflictDoUpdate');
    expect(fakeDb.calls).not.toContain('begin');
  });

  it('returns undefined when a pending or submitted row holds the period', async () => {
    begin([[]]);
    await expect(databaseStore.claimSubmission('user_a', '26A1', false)).resolves.toBeUndefined();
  });

  it('writes the receipt and the audit event inside one transaction', async () => {
    begin([[{ id: 'sub1' }], []]);
    await databaseStore.recordReceipt('user_a', 'sub1', { formBundleNumber: '1', processingDate: new Date() }, audit, new Date());
    const order = fakeDb.calls.filter((call) => ['begin', 'update', 'insert', 'commit'].includes(call));
    expect(order).toEqual(['begin', 'update', 'insert', 'commit']);
  });

  it('writes no audit event when the claim is not pending', async () => {
    begin([[]]);
    await expect(
      databaseStore.recordReceipt('user_a', 'sub1', { formBundleNumber: '1', processingDate: new Date() }, audit, new Date()),
    ).rejects.toThrow();
    expect(fakeDb.calls).not.toContain('insert');
    expect(fakeDb.calls).not.toContain('commit');
  });

  it('releases the claim and audits a rejection in one transaction', async () => {
    begin([[{ id: 'sub1' }], []]);
    await databaseStore.markFailed('user_a', 'sub1', audit);
    expect(fakeDb.calls.filter((call) => ['begin', 'update', 'insert', 'commit'].includes(call))).toEqual([
      'begin',
      'update',
      'insert',
      'commit',
    ]);
  });
});
