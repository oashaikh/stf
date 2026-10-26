import { describe, expect, it, vi } from 'vitest';

const fakeDb = vi.hoisted(() => ({ calls: [] as string[], results: [] as unknown[][], db: {} as Record<string, unknown> }));
vi.mock('../db', () => ({ db: fakeDb.db }));

import type { AuthDeps } from '../auth';
import { withAuth } from '../auth';
import { vatHistoryHandler } from '../../vat/history';
import { databaseStore, HISTORY_LIMIT, type HistoryItem, type VatReturnStore } from '../vatReturns';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token === 'a' || token === 'b' ? `owner_${token}` : null),
    getEmail: async () => 'x@example.com',
  },
  users: { findId: async (id) => id.replace('owner_', 'user_'), createIfAbsent: async () => 'unused' },
};

const boxes = { box1: 1, box2: 2, box3: 3, box4: 4, box5: 5, box6: 6, box7: 7, box8: 8, box9: 9 };
const item = (periodKey: string): HistoryItem => ({
  periodKey,
  start: '2026-01-01',
  end: '2026-03-31',
  status: 'accepted',
  boxes,
  receipt: { formBundleNumber: `bundle-${periodKey}`, processingDate: '2026-04-05T10:00:00.000Z', sandbox: false },
});

const request = (method: string, token?: string) =>
  new Request('https://x.test/api/vat/history', { method, headers: token ? { cookie: `stf_session=${token}` } : {} });

describe('GET /api/vat/history', () => {
  const store = {
    listReturnHistory: async (userId: string) => (userId === 'user_a' ? [item('26A1')] : []),
  } as unknown as VatReturnStore;
  const handler = withAuth(vatHistoryHandler(store), authDeps);

  it('refuses a request without a valid token', async () => {
    expect((await handler(request('GET'))).status).toBe(401);
    expect((await handler(request('GET', 'bad'))).status).toBe(401);
  });

  it('refuses methods other than GET', async () => {
    expect((await handler(request('POST', 'a'))).status).toBe(405);
  });

  it("never shows user B user A's periods or receipts", async () => {
    const own = await (await handler(request('GET', 'a'))).json();
    expect(own.data.map((row: HistoryItem) => row.periodKey)).toEqual(['26A1']);
    const other = await (await handler(request('GET', 'b'))).json();
    expect(other).toEqual({ ok: true, data: [] });
  });
});

describe('databaseStore.listReturnHistory', () => {
  const draftRow = (periodKey: string, status: 'draft' | 'confirmed' = 'confirmed') => ({
    periodKey,
    periodStart: '2026-01-01',
    periodEnd: '2026-03-31',
    status,
    box1Pence: 1,
    box2Pence: 2,
    box3Pence: 3,
    box4Pence: 4,
    box5Pence: 5,
    box6Pence: 6,
    box7Pence: 7,
    box8Pence: 8,
    box9Pence: 9,
  });
  const date = new Date('2026-04-05T10:00:00.000Z');
  const submission = (periodKey: string, sandbox: boolean, status: 'pending' | 'submitted' | 'failed') => ({
    periodKey,
    sandbox,
    status,
    formBundleNumber: status === 'submitted' ? `bundle-${sandbox ? 'sandbox' : 'live'}` : null,
    processingDate: status === 'submitted' ? date : null,
  });

  const run = async (drafts: unknown[], submissions: unknown[]) => {
    fakeDb.calls.length = 0;
    fakeDb.results = [drafts, submissions];
    const chain = (): unknown =>
      new Proxy(() => undefined, {
        get: (_, method) => {
          if (method === 'then') return (resolve: (rows: unknown[]) => void) => resolve(fakeDb.results.shift() ?? []);
          fakeDb.calls.push(String(method));
          return (...args: unknown[]) => (method === 'limit' && fakeDb.calls.push(`limit=${args[0]}`), chain());
        },
      });
    fakeDb.db.select = () => (fakeDb.calls.push('select'), chain());
    return databaseStore.listReturnHistory('user_a');
  };

  it('maps each status', async () => {
    const result = await run(
      [draftRow('d', 'draft'), draftRow('c'), draftRow('p'), draftRow('a'), draftRow('f'), draftRow('fd', 'draft')],
      [
        submission('p', false, 'pending'),
        submission('a', false, 'submitted'),
        submission('f', false, 'failed'),
        submission('fd', true, 'failed'),
      ],
    );
    expect(result.map((row) => [row.periodKey, row.status])).toEqual([
      ['d', 'draft'],
      ['c', 'confirmed'],
      ['p', 'submitted'],
      ['a', 'accepted'],
      ['f', 'confirmed'],
      ['fd', 'draft'],
    ]);
  });

  it('prefers the live receipt and surfaces sandbox', async () => {
    const [both, rehearsal] = await run(
      [draftRow('both'), draftRow('rehearsal')],
      [submission('both', true, 'submitted'), submission('both', false, 'submitted'), submission('rehearsal', true, 'submitted')],
    );
    expect(both.receipt).toEqual({ formBundleNumber: 'bundle-live', processingDate: date.toISOString(), sandbox: false });
    expect(rehearsal.receipt).toEqual({ formBundleNumber: 'bundle-sandbox', processingDate: date.toISOString(), sandbox: true });
  });

  it('returns the stored draft boxes as integer pence with no ledger read', async () => {
    const [row] = await run([draftRow('c')], []);
    expect(row.boxes).toEqual(boxes);
    expect(Object.values(row.boxes).every(Number.isInteger)).toBe(true);
    expect(row.receipt).toBeNull();
  });

  it('runs two bounded queries and none for an empty history', async () => {
    await run([draftRow('a'), draftRow('b')], []);
    expect(fakeDb.calls.filter((call) => call === 'select')).toHaveLength(2);
    expect(fakeDb.calls).toContain(`limit=${HISTORY_LIMIT}`);
    expect(fakeDb.calls).toContain('limit=4');
    await run([], []);
    expect(fakeDb.calls.filter((call) => call === 'select')).toHaveLength(1);
  });
});
