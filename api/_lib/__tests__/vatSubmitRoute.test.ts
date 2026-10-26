import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import type { HmrcStore } from '../hmrcStore';
import type { AuthDeps } from '../auth';
import type { DrillLine, Period, SavedDraft, VatReturnStore } from '../vatReturns';
import { createSubmitHandler } from '../../vat/submit';
import { buildVatReturnFromLedger } from '../../../src/lib/vat';

const period: Period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };
const NOW = new Date('2026-10-26T10:00:00Z');
const ACCESS = 'access-secret';
const REFRESH = 'refresh-secret';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token === 'a' || token === 'b' ? `clerk_${token}` : null),
    getEmail: async () => 'x@example.com',
  },
  users: { findId: async (id) => id.replace('clerk_', 'user_'), createIfAbsent: async () => 'unused' },
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
  const submissions = new Set<string>();
  const draft: SavedDraft = {
    status: 'confirmed',
    periodStart: period.start,
    periodEnd: period.end,
    boxes: buildVatReturnFromLedger([salesLine], period),
    confirmedAt: NOW.toISOString(),
  };
  const store = {
    loadLedgerLines: async (userId: string) => (touched.push(userId), [salesLine]),
    findDraft: async (userId: string) => (touched.push(userId), userId === 'user_a' ? draft : undefined),
    claimSubmission: async (userId: string, key: string, sandbox: boolean) => {
      touched.push(userId);
      const id = `${userId}:${key}:${sandbox}`;
      if (submissions.has(id)) return undefined;
      submissions.add(id);
      return id;
    },
    recordReceipt: async () => undefined,
    markFailed: async (_userId: string, id: string) => void submissions.delete(id),
  } as unknown as VatReturnStore;
  return { store, touched };
}

const hmrcStore = (sandbox: boolean | undefined = true): HmrcStore =>
  ({
    sandboxMode: async () => sandbox,
    setSandboxMode: vi.fn(),
    credentials: async () => ({
      vatNumber: '123456789',
      accessToken: ACCESS,
      refreshToken: REFRESH,
      storedRefreshToken: 'cipher',
      expiresAt: new Date(NOW.getTime() + 3_600_000),
    }),
    saveRefreshedTokens: async () => true,
  }) as unknown as HmrcStore;

const receiptBody = { formBundleNumber: '256616960283', processingDate: '2026-10-26T10:00:01.000Z' };

// Obligations GETs are answered here; `fetchFn` therefore only sees submit POSTs.
let openObligations: unknown[];
let fetchFn: Mock<[], Promise<Response>>;
const routedFetch = ((url: string) =>
  url.includes('/obligations?') ? Promise.resolve(Response.json({ obligations: openObligations })) : fetchFn()) as unknown as typeof fetch;
beforeEach(() => {
  // withHmrcToken compares token expiry with Date.now(); pin it to NOW so the fixed fixtures stay valid.
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  openObligations = [{ ...period, due: '2026-05-07', status: 'O' }];
  fetchFn = vi.fn(async () => new Response(JSON.stringify({ ...receiptBody, chargeRefNumber: 'raw-only' })));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function post(vat = makeVatStore(), token: string | null = 'a', body: unknown = { ...period, confirm: true }, method = 'POST', sandbox?: boolean) {
  const handler = createSubmitHandler(
    { vatStore: vat.store, hmrcStore: hmrcStore(sandbox), fetchFn: routedFetch, now: () => NOW },
    authDeps,
  );
  return handler(
    new Request('https://app.test/api/vat/submit', {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  );
}

describe('POST /api/vat/submit', () => {
  it('refuses an unauthenticated request before touching the stores or HMRC', async () => {
    const vat = makeVatStore();
    const res = await post(vat, null);
    expect(res.status).toBe(401);
    expect(vat.touched).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects non-POST with 405', async () => {
    expect((await post(makeVatStore(), 'a', null, 'GET')).status).toBe(405);
  });

  it.each([
    ['no confirm', { ...period }],
    ['confirm not literal true', { ...period, confirm: 'true' }],
    ['bad period', { periodKey: '', start: 'x', end: 'y', confirm: true }],
    ['not an object', 'nope'],
  ])('rejects a bad body with 400 (%s) without any access', async (_name, body) => {
    const vat = makeVatStore();
    const res = await post(vat, 'a', body);
    expect(res.status).toBe(400);
    expect(vat.touched).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns only the receipt and sandbox flag', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true, data: { ...receiptBody, sandbox: true } });
    for (const secret of [ACCESS, REFRESH, 'raw-only', '123456789']) expect(text).not.toContain(secret);
  });

  it('maps a second submit of the same period to 409', async () => {
    const vat = makeVatStore();
    expect((await post(vat)).status).toBe(200);
    const res = await post(vat);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'ALREADY_SUBMITTED' });
  });

  it('maps an unconfirmed return to 409 and a mode mismatch to 409', async () => {
    const unconfirmed = await post(makeVatStore(), 'b');
    expect(unconfirmed.status).toBe(409);
    const mismatch = await post(makeVatStore(), 'a', undefined, 'POST', false);
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ code: 'MODE_MISMATCH' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a period that is not an open obligation to 409 PERIOD_NOT_OPEN without filing', async () => {
    openObligations = [];
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'PERIOD_NOT_OPEN' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a second user's period and never claims it for the first user", async () => {
    const vat = makeVatStore();
    const res = await post(vat, 'b');
    expect(res.status).toBe(409);
    expect(vat.touched.every((userId) => userId === 'user_b')).toBe(true);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
