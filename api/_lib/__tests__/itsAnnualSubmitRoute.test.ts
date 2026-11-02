import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import { createItsAnnualConfirmHandler } from '../../hmrc/its-annual-confirm';
import { createItsAnnualPreviewHandler } from '../../hmrc/its-annual-preview';
import { createItsAnnualSubmitHandler } from '../../hmrc/its-annual-submit';
import type { AuthDeps } from '../auth';
import type { HmrcStore } from '../hmrcStore';
import type { ItsAnnualDeps, ItsAnnualStore } from '../itsAnnualSubmit';
import type { TaxIdentifiersStore } from '../taxIdentifiers';
import type { TaxYearSummaryStore } from '../taxYearSummary';

const target = { taxYear: '2026-27' };

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

function fakeDeps() {
  const rows = new Map<string, { id: string; userId: string; status: 'confirmed' | 'pending' | 'submitted' | 'rejected'; payload: unknown }>();
  const key = (userId: string, period: { taxYear: string; sandbox: boolean }) => `${userId}:${period.taxYear}:${period.sandbox}`;
  const submissions: ItsAnnualStore = {
    find: async (userId, period) => {
      const row = rows.get(key(userId, period));
      return row && { id: row.id, status: row.status, confirmedPayload: row.payload };
    },
    saveConfirmed: async (userId, period, payload) => {
      rows.set(key(userId, period), { id: key(userId, period), userId, status: 'confirmed', payload });
      return true;
    },
    claim: async (userId, id) => {
      const row = rows.get(id);
      if (!row || row.userId !== userId || row.status !== 'confirmed') return false;
      row.status = 'pending';
      return true;
    },
    markRejected: async () => undefined,
    recordReceipt: async (_userId, id) => {
      rows.get(id)!.status = 'submitted';
    },
  };
  const hmrcStore = {
    sandboxMode: async () => true,
    credentials: async () => ({
      vatNumber: null,
      accessToken: 'access-secret-token',
      refreshToken: 'refresh-secret',
      storedRefreshToken: 'stored',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    }),
    status: async () => ({ connected: true, expiresAt: null, itsBusinessId: 'XAIS12345678901', needsItsReconnect: false }),
    saveRefreshedTokens: async () => true,
  } as unknown as HmrcStore;
  const summaryStore: TaxYearSummaryStore = { loadLines: async () => [], loadTrips: async () => [], loadChoice: async () => 'allowance' };
  const fetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(null, { status: 204 }));
  const deps: ItsAnnualDeps = {
    submissions,
    hmrcStore,
    identifiers: { get: async () => ({ ninoEncrypted: encryptToken('QQ123456C') }) } as unknown as TaxIdentifiersStore,
    summaryStore,
    fetchFn,
    recordPreview: async () => undefined,
  };
  return { deps, fetchFn };
}

const post = (handler: (request: Request) => Promise<Response>, body: unknown, token: string | null = 'tok-u1', method = 'POST') =>
  handler(
    new Request('https://app.test/api/hmrc/its-annual', {
      method,
      headers: token ? { cookie: `stf_session=${token}` } : {},
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  );

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ['preview', createItsAnnualPreviewHandler, undefined],
  ['confirm', createItsAnnualConfirmHandler, 'declaration'],
  ['submit', createItsAnnualSubmitHandler, 'confirm'],
] as const)('POST /api/hmrc/its-annual-%s', (_name, create, flag) => {
  const setup = () => {
    const { deps, fetchFn } = fakeDeps();
    return { handler: (request: Request) => create(deps, authDeps)(request), fetchFn };
  };
  const valid = { ...target, ...(flag ? { [flag]: true } : {}) };

  it('returns 401 without a session', async () => {
    const { handler, fetchFn } = setup();
    expect((await post(handler, valid, null)).status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects other methods with 405', async () => {
    expect((await post(setup().handler, undefined, 'tok-u1', 'GET')).status).toBe(405);
  });

  it.each([
    ['extra key', { ...valid, userId: 'u2' }],
    ['a body supplied by the caller', { ...valid, body: { allowances: { tradingIncomeAllowance: '9999.00' } } }],
    ['unknown year', { ...valid, taxYear: '2019-20' }],
    ['not an object', 'yes'],
  ])('answers 400 for %s', async (_label, body) => {
    const { handler, fetchFn } = setup();
    expect((await post(handler, body)).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('answers 404 when Income Tax is off', async () => {
    vi.stubEnv('HMRC_ITSA_ENABLED', 'false');
    const { handler, fetchFn } = setup();
    const res = await post(handler, valid);
    expect(res.status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe.each([
  ['confirm', createItsAnnualConfirmHandler, 'declaration'],
  ['submit', createItsAnnualSubmitHandler, 'confirm'],
] as const)('flag on its-annual-%s', (_name, create, flag) => {
  it.each([['missing', target], ['false', { ...target, [flag]: false }]])('answers 400 when the flag is %s', async (_label, body) => {
    const { deps, fetchFn } = fakeDeps();
    expect((await post((r) => create(deps, authDeps)(r), body)).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('annual submission confirm then submit over HTTP', () => {
  it('shows the preview body without calling HMRC', async () => {
    const { deps, fetchFn } = fakeDeps();
    const res = await post((r) => createItsAnnualPreviewHandler(deps, authDeps)(r), target);
    expect(res.status).toBe(200);
    expect((await res.json()).data.body).toEqual({ allowances: { tradingIncomeAllowance: '1000.00' } });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('lets the owner confirm and submit', async () => {
    const { deps, fetchFn } = fakeDeps();
    expect((await post((r) => createItsAnnualConfirmHandler(deps, authDeps)(r), { ...target, declaration: true })).status).toBe(200);
    expect((await post((r) => createItsAnnualSubmitHandler(deps, authDeps)(r), { ...target, confirm: true })).status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a submit with no confirmation', async () => {
    const { deps, fetchFn } = fakeDeps();
    const res = await post((r) => createItsAnnualSubmitHandler(deps, authDeps)(r), { ...target, confirm: true });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_CONFIRMED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a second user the first user's confirmation and sends nothing to HMRC", async () => {
    const { deps, fetchFn } = fakeDeps();
    await post((r) => createItsAnnualConfirmHandler(deps, authDeps)(r), { ...target, declaration: true }, 'tok-u1');
    const res = await post((r) => createItsAnnualSubmitHandler(deps, authDeps)(r), { ...target, confirm: true }, 'tok-u2');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_CONFIRMED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
