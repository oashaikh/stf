import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { HmrcTokenSet } from '../../../src/lib/hmrc/client';
import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import { createItsAdjustmentsHandler } from '../../hmrc/its-adjustments';
import type { AuthDeps } from '../auth';
import type { HmrcCredentials, HmrcStatus, HmrcStore } from '../hmrcStore';
import type { TaxIdentifiersStore } from '../taxIdentifiers';

const NINO = 'QQ123456C';
const TODAY = new Date('2026-10-26T10:00:00Z');
const BUSINESS = 'XAIS12345678901';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const asUser = (userId?: string, query = '?taxYear=2026-27', method = 'GET') =>
  new Request(`https://app.test/api/hmrc/its-adjustments${query}`, {
    method,
    headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
  });

const credentials = (): HmrcCredentials => ({
  vatNumber: null,
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  storedRefreshToken: 'stored-refresh',
  expiresAt: new Date(TODAY.getTime() + 3_600_000),
});

let hmrcFetch: Mock<[string], Promise<Response>>;
let status: HmrcStatus;
let sandboxMode: boolean | undefined;

const handler = () =>
  createItsAdjustmentsHandler(
    {
      sandboxMode: async () => sandboxMode,
      credentials: async (userId: string) => (userId === 'u1' ? credentials() : undefined),
      status: async () => status,
      saveRefreshedTokens: async () => true,
    } as unknown as HmrcStore,
    { get: async () => ({ ninoEncrypted: encryptToken(NINO), utrEncrypted: null }) } as unknown as TaxIdentifiersStore,
    authDeps,
    {
      fetchFn: hmrcFetch as unknown as typeof fetch,
      refresh: async (): Promise<HmrcTokenSet> => ({ accessToken: 'new', refreshToken: 'new', expiresAt: TODAY.getTime() + 3_600_000 }),
      now: () => TODAY,
    },
  );

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  sandboxMode = true;
  status = { connected: true, expiresAt: null, itsBusinessId: BUSINESS, itsPropertyBusinessId: null, needsItsReconnect: false };
  hmrcFetch = vi.fn(async (url: string) => {
    if (url.endsWith('/trigger')) return new Response(JSON.stringify({ calculationId: 'bsas-1' }));
    if (url.includes('/adjustable-summary/')) {
      return new Response(JSON.stringify({ adjustableSummaryCalculation: { totalIncome: 100.5, totalExpenses: 40, netProfit: 60.5 } }));
    }
    return new Response(JSON.stringify({ adjustments: [{ type: 'Gift Aid', amount: 20 }] }));
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('GET /api/hmrc/its-adjustments', () => {
  it('refuses a request without sign-in and makes no HMRC call', async () => {
    expect((await handler()(asUser())).status).toBe(401);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns the summary and adjustments in pence, without the NINO', async () => {
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      ok: true,
      summary: { totalIncomePence: 10050, totalExpensesPence: 4000, netProfitPence: 6050, netLossPence: 0 },
      adjustments: [{ type: 'Gift Aid', amountPence: 2000 }],
    });
    expect(text).not.toContain(NINO);
  });

  it('asks HMRC about the chosen business and the whole tax year', async () => {
    await handler()(asUser('u1'));
    const [, init] = hmrcFetch.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      accountingPeriod: { startDate: '2026-04-06', endDate: '2027-04-05' },
      typeOfBusiness: 'self-employment',
      businessId: BUSINESS,
    });
  });

  it.each(['', '?taxYear=2099-00', '?taxYear=../x'])('rejects a bad tax year (%s) before any HMRC call', async (query) => {
    expect((await handler()(asUser('u1', query))).status).toBe(400);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('refuses a live-mode mismatch', async () => {
    sandboxMode = false;
    expect((await handler()(asUser('u1'))).status).toBe(403);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('asks the owner to choose a business first', async () => {
    status = { ...status, itsBusinessId: null };
    expect((await handler()(asUser('u1'))).status).toBe(409);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('reports an HMRC failure as a 502 with only the HMRC code', async () => {
    hmrcFetch = vi.fn(async (_url: string) => new Response(JSON.stringify({ code: 'RULE_X', message: 'secret-ish' }), { status: 400 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: 'RULE_X', hmrcStatus: 400 });
  });

  it('rejects other methods', async () => {
    expect((await handler()(asUser('u1', '?taxYear=2026-27', 'POST'))).status).toBe(405);
  });
});
