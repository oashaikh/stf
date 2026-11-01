import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import type { TaxYearLine } from '../../../src/lib/taxYearSummary';
import { createItsCumulativeConfirmHandler } from '../../hmrc/its-cumulative-confirm';
import { createItsCumulativeSubmitHandler } from '../../hmrc/its-cumulative-submit';
import type { AuthDeps } from '../auth';
import type { HmrcStore } from '../hmrcStore';
import type { ItsSubmissionStore, ItsSubmitDeps } from '../itsSubmit';
import type { TaxIdentifiersStore } from '../taxIdentifiers';
import type { TaxYearSummaryStore } from '../taxYearSummary';

const NINO = 'QQ123456C';
const BUSINESS_ID = 'XAIS12345678901';
const target = { taxYear: '2026-27', quarter: 2 };

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const incomeLine: TaxYearLine = {
  date: '2026-07-10',
  accountId: 'sales',
  accountName: 'Sales',
  accountType: 'income',
  taxCategory: 'turnover',
  amountPence: -100000,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
};

function fakeDeps() {
  const rows = new Map<string, { id: string; status: 'confirmed' | 'pending' | 'submitted' | 'rejected'; payload: unknown }>();
  const key = (userId: string, period: { taxYear: string; quarter: number; sandbox: boolean }) =>
    `${userId}:${period.taxYear}:${period.quarter}:${period.sandbox}`;
  const submissions: ItsSubmissionStore = {
    find: async (userId, period) => {
      const row = rows.get(key(userId, period));
      return row && { id: row.id, status: row.status, confirmedPayload: row.payload };
    },
    saveConfirmed: async (userId, period, payload) => {
      rows.set(key(userId, period), { id: key(userId, period), status: 'confirmed', payload });
      return true;
    },
    claim: async () => true,
    markRejected: async () => undefined,
    recordReceipt: async () => undefined,
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
    status: async () => ({ connected: true, expiresAt: null, itsBusinessId: BUSINESS_ID, needsItsReconnect: false }),
    saveRefreshedTokens: async () => true,
  } as unknown as HmrcStore;
  const summaryStore: TaxYearSummaryStore = {
    loadLines: async () => [incomeLine],
    loadTrips: async () => [],
    loadChoice: async () => undefined,
  };
  const fetchFn = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(null, { status: 204 }));
  const deps: ItsSubmitDeps = {
    submissions,
    hmrcStore,
    identifiers: { get: async () => ({ ninoEncrypted: encryptToken(NINO) }) } as unknown as TaxIdentifiersStore,
    summaryStore,
    fetchFn,
  };
  return { deps, fetchFn };
}

const post = (handler: (request: Request) => Promise<Response>, body: unknown, token: string | null = 'tok-u1', method = 'POST') =>
  handler(
    new Request('https://app.test/api/hmrc/its', {
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
  ['confirm', createItsCumulativeConfirmHandler, 'declaration'],
  ['submit', createItsCumulativeSubmitHandler, 'confirm'],
] as const)('POST /api/hmrc/its-cumulative-%s', (_name, create, flag) => {
  const setup = () => {
    const { deps, fetchFn } = fakeDeps();
    return { handler: (request: Request) => create(deps, authDeps)(request), fetchFn };
  };

  it('returns 401 without a session', async () => {
    const { handler, fetchFn } = setup();
    expect((await post(handler, { ...target, [flag]: true }, null)).status).toBe(401);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects other methods with 405', async () => {
    expect((await post(setup().handler, undefined, 'tok-u1', 'GET')).status).toBe(405);
  });

  it.each([
    ['missing flag', target],
    ['flag false', { ...target, [flag]: false }],
    ['extra key', { ...target, [flag]: true, userId: 'u2' }],
    ['unknown year', { taxYear: '2019-20', quarter: 1, [flag]: true }],
    ['not an object', 'yes'],
  ])('answers 400 for %s', async (_label, body) => {
    const { handler, fetchFn } = setup();
    const res = await post(handler, body);
    expect(res.status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('Income Tax confirm then submit over HTTP', () => {
  it('lets the owner confirm and submit', async () => {
    const { deps, fetchFn } = fakeDeps();
    expect((await post((r) => createItsCumulativeConfirmHandler(deps, authDeps)(r), { ...target, declaration: true })).status).toBe(200);
    const res = await post((r) => createItsCumulativeSubmitHandler(deps, authDeps)(r), { ...target, confirm: true });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('refuses a second user the first user\'s confirmation and sends nothing to HMRC', async () => {
    const { deps, fetchFn } = fakeDeps();
    await post((r) => createItsCumulativeConfirmHandler(deps, authDeps)(r), { ...target, declaration: true }, 'tok-u1');
    const res = await post((r) => createItsCumulativeSubmitHandler(deps, authDeps)(r), { ...target, confirm: true }, 'tok-u2');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('NOT_CONFIRMED');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
