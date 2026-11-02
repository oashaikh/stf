import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import type { TaxYearLine } from '../../../src/lib/taxYearSummary';
import { createItsCumulativePreviewHandler } from '../../hmrc/its-cumulative-preview';
import type { AuthDeps } from '../auth';
import type { HmrcStatus, HmrcStore } from '../hmrcStore';
import type { TaxIdentifiersStore } from '../taxIdentifiers';
import type { TaxYearSummaryStore } from '../taxYearSummary';

const NINO = 'QQ123456C';
const BUSINESS_ID = 'XAIS12345678901';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const line = (over: Partial<TaxYearLine>): TaxYearLine => ({
  date: '2026-07-10',
  accountId: 'sales',
  accountName: 'Sales',
  accountType: 'income',
  taxCategory: 'turnover',
  amountPence: -200050,
  vatPence: 0,
  status: 'confirmed',
  deletedAt: null,
  ...over,
});

let status: HmrcStatus;
let sandboxMode: boolean | undefined;
let connected: boolean;
let storedNino: string | null;
let loadedFor: { userId: string; start: string; end: string }[];
let recordPreview: Mock<[string, object], Promise<undefined>>;
let hmrcFetch: Mock;

const summaryStore: TaxYearSummaryStore = {
  async loadLines(userId, period) {
    loadedFor.push({ userId, ...period });
    return [line({})];
  },
  loadTrips: async () => [],
  loadChoice: async () => undefined,
};

const call = (body: unknown = { taxYear: '2026-27', quarter: 2 }, token: string | null = 'tok-u1', method = 'POST') => {
  const handler = createItsCumulativePreviewHandler(
    {
      hmrcStore: {
        sandboxMode: async () => sandboxMode,
        credentials: async () => (connected ? {} : undefined),
        status: async () => status,
      } as unknown as HmrcStore,
      identifiers: { get: async () => ({ ninoEncrypted: storedNino === null ? null : encryptToken(storedNino), utrEncrypted: null }) } as unknown as TaxIdentifiersStore,
      summaryStore,
      recordPreview,
    },
    authDeps,
  );
  return handler(
    new Request('https://app.test/api/hmrc/its-cumulative-preview', {
      method,
      headers: token ? { cookie: `stf_session=${token}` } : {},
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
  );
};

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
  sandboxMode = true;
  connected = true;
  storedNino = NINO;
  status = { connected: true, expiresAt: null, itsBusinessId: BUSINESS_ID, itsPropertyBusinessId: null, needsItsReconnect: false };
  loadedFor = [];
  recordPreview = vi.fn(async (..._args: [string, object]) => undefined);
  hmrcFetch = vi.fn();
  vi.stubGlobal('fetch', hmrcFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('POST /api/hmrc/its-cumulative-preview', () => {
  it('returns 401 without a session and reads nothing', async () => {
    const res = await call(undefined, null);
    expect(res.status).toBe(401);
    expect(loadedFor).toEqual([]);
    expect(recordPreview).not.toHaveBeenCalled();
  });

  it('rejects other methods with 405', async () => {
    expect((await call(undefined, 'tok-u1', 'GET')).status).toBe(405);
  });

  it.each([
    ['unknown year', { taxYear: '2019-20', quarter: 1 }],
    ['malformed year', { taxYear: '2026', quarter: 1 }],
    ['quarter zero', { taxYear: '2026-27', quarter: 0 }],
    ['quarter five', { taxYear: '2026-27', quarter: 5 }],
    ['fractional quarter', { taxYear: '2026-27', quarter: 1.5 }],
    ['extra nino field', { taxYear: '2026-27', quarter: 1, nino: 'AA000000A' }],
    ['no body', null],
  ])('rejects %s with 400', async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: 'BAD_REQUEST' });
  });

  it('returns 404 when Income Tax is disabled, before any read', async () => {
    vi.stubEnv('HMRC_ITSA_ENABLED', 'false');
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'ITSA_DISABLED' });
    expect(loadedFor).toEqual([]);
  });

  it.each([
    ['user is live while deployment is sandbox', false, 'true'],
    ['user is sandbox while deployment is live', true, 'false'],
    ['user has no mode', undefined, 'true'],
  ])('returns 403 when %s', async (_name, userMode, envMode) => {
    sandboxMode = userMode;
    vi.stubEnv('HMRC_SANDBOX_MODE', envMode);
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'LIVE_MODE_REFUSED' });
  });

  it.each([
    ['HMRC_NOT_CONNECTED', () => { connected = false; }],
    ['ITS_SCOPE_MISSING', () => { status = { ...status, needsItsReconnect: true }; }],
    ['NO_BUSINESS_SELECTED', () => { status = { ...status, itsBusinessId: null }; }],
    ['NO_NINO', () => { storedNino = null; }],
  ])('returns 409 %s', async (code, arrange) => {
    arrange();
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code });
    expect(recordPreview).not.toHaveBeenCalled();
  });

  it('returns the exact payload, masked identifiers and hidden token, and calls no HMRC', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const text = await res.text();
    const { ok, data } = JSON.parse(text);
    expect(ok).toBe(true);
    expect(data.endpoint).toEqual({
      method: 'PUT',
      url: 'https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/••••••56C/••••••••••••901/cumulative/2026-27',
      sandbox: true,
    });
    expect(data.body).toEqual({
      periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-10-05' },
      periodIncome: { turnover: '2000.50', other: '0.00' },
      periodExpenses: {},
    });
    expect(data.headers.Authorization).toBe('Bearer (hidden)');
    expect(text).not.toContain(NINO);
    expect(text).not.toContain(BUSINESS_ID);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('summarises from 6 April to the quarter end for the session user only', async () => {
    await call({ taxYear: '2026-27', quarter: 4 });
    expect(loadedFor).toEqual([{ userId: 'u1', start: '2026-04-06', end: '2027-04-05' }]);
  });

  it('writes one audit event with tax year, quarter and mode only', async () => {
    await call();
    expect(recordPreview).toHaveBeenCalledTimes(1);
    expect(recordPreview).toHaveBeenCalledWith('u1', { taxYear: '2026-27', quarter: 2, sandbox: true });
  });
});
