import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import type { HmrcStore } from '../hmrcStore';
import type { AuthDeps } from '../auth';
import type { DrillLine, Period, SavedDraft, VatReturnStore } from '../vatReturns';
import { createPreviewHandler } from '../../vat/preview';
import { buildVatReturnFromLedger } from '../../../src/lib/vat';

const period: Period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };
const NOW = new Date('2026-10-26T10:00:00Z');
const ACCESS = 'access-secret';
const REFRESH = 'refresh-secret';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token === 'a' || token === 'b' ? `owner_${token}` : null),
    getEmail: async () => 'x@example.com',
  },
  users: { findId: async (id) => id.replace('owner_', 'user_'), createIfAbsent: async () => 'unused' },
};

const salesLine: DrillLine = {
  lineId: 's1',
  date: '2026-02-01',
  accountType: 'income',
  amountPence: -10000,
  vatPence: -2000,
  status: 'confirmed',
  deletedAt: null,
  description: 's1',
};

// Only user_a has a confirmed return; the store records which user ids it was asked about.
function makeVatStore() {
  const touched: string[] = [];
  const draft: SavedDraft = {
    status: 'confirmed',
    periodStart: period.start,
    periodEnd: period.end,
    boxes: buildVatReturnFromLedger([salesLine], period),
    confirmedAt: NOW.toISOString(),
  };
  const claimSubmission = vi.fn();
  const store = {
    loadLedgerLines: async (userId: string) => (touched.push(userId), [salesLine]),
    findDraft: async (userId: string) => (touched.push(userId), userId === 'user_a' ? draft : undefined),
    claimSubmission,
  } as unknown as VatReturnStore;
  return { store, touched, claimSubmission };
}

const hmrcStore = {
  sandboxMode: async () => true,
  credentials: async () => ({
    vatNumber: '123456789',
    accessToken: ACCESS,
    refreshToken: REFRESH,
    storedRefreshToken: 'cipher',
    expiresAt: new Date(NOW.getTime() + 3_600_000),
  }),
  saveRefreshedTokens: async () => true,
} as unknown as HmrcStore;

afterEach(() => {
  vi.restoreAllMocks();
});

function post(vat = makeVatStore(), token: string | null = 'a', body: unknown = period, method = 'POST') {
  const recordPreview = vi.fn(async () => undefined);
  const handler = createPreviewHandler({ vatStore: vat.store, hmrcStore, now: () => NOW, recordPreview }, authDeps);
  return handler(
    new Request('https://app.test/api/vat/preview', {
      method,
      headers: token ? { cookie: `stf_session=${token}` } : {},
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  );
}

describe('POST /api/vat/preview', () => {
  it('refuses an unauthenticated request before touching the stores', async () => {
    const vat = makeVatStore();
    const res = await post(vat, null);
    expect(res.status).toBe(401);
    expect(vat.touched).toEqual([]);
  });

  it('rejects other methods with 405', async () => {
    expect((await post(makeVatStore(), 'a', undefined, 'GET')).status).toBe(405);
  });

  it('rejects an invalid body with 400', async () => {
    const res = await post(makeVatStore(), 'a', { periodKey: '26A1' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });

  it('returns the preview without tokens, the full VRN or a submission claim', async () => {
    const vat = makeVatStore();
    const res = await post(vat);
    expect(res.status).toBe(200);
    const text = await res.text();
    const { ok, data } = JSON.parse(text);
    expect(ok).toBe(true);
    expect(data).toMatchObject({ endpoint: { method: 'POST', sandbox: true }, headers: { Authorization: 'Bearer (hidden)' } });
    expect(data.body.periodKey).toBe('26A1');
    for (const secret of [ACCESS, REFRESH, '123456789']) expect(text).not.toContain(secret);
    expect(vat.claimSubmission).not.toHaveBeenCalled();
  });

  it("refuses a second user's period with 409 NOT_CONFIRMED", async () => {
    const vat = makeVatStore();
    const res = await post(vat, 'b');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'NOT_CONFIRMED' });
    expect(vat.touched.every((userId) => userId === 'user_b')).toBe(true);
  });
});
