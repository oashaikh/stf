import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { HmrcTokenSet } from '../../../src/lib/hmrc/client';
import { createFiledReturnHandler } from '../../vat/filed';
import type { AuthDeps } from '../auth';
import type { HmrcCredentials, HmrcStore } from '../hmrcStore';

const ACCESS = 'access-secret-AAA';
const REFRESH = 'refresh-secret-BBB';
const NEW_ACCESS = 'access-secret-NEW';
const NEW_REFRESH = 'refresh-secret-NEW';
const VRN = '123456789';
const TODAY = new Date('2026-10-26T10:00:00Z');

const FILED = {
  periodKey: '26A1',
  vatDueSales: 100.5,
  vatDueAcquisitions: 0,
  totalVatDue: 100.5,
  vatReclaimedCurrPeriod: 20.25,
  netVatDue: 80.25,
  totalValueSalesExVAT: 500,
  totalValuePurchasesExVAT: 100,
  totalValueGoodsSuppliedExVAT: 0,
  totalAcquisitionsExVAT: 0,
};

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const asUser = (path: string, userId?: string, method = 'GET') =>
  new Request(`https://app.test${path}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} });

const credentials = (overrides: Partial<HmrcCredentials> = {}): HmrcCredentials => ({
  vatNumber: VRN,
  accessToken: ACCESS,
  refreshToken: REFRESH,
  storedRefreshToken: 'stored-refresh',
  expiresAt: new Date(TODAY.getTime() + 3_600_000),
  ...overrides,
});

type FetchArgs = [url: string, init: { headers: Record<string, string> }];
let stored: Record<string, HmrcCredentials | undefined>;
let saveRefreshedTokens: Mock<unknown[], Promise<boolean>>;
let hmrcFetch: Mock<FetchArgs, Promise<Response>>;
let refresh: Mock<unknown[], Promise<HmrcTokenSet>>;

const handler = () =>
  createFiledReturnHandler(
    { credentials: async (userId: string) => stored[userId], saveRefreshedTokens } as unknown as HmrcStore,
    authDeps,
    { fetchFn: hmrcFetch as unknown as typeof fetch, refresh, now: () => TODAY },
  );

beforeEach(() => {
  stored = { u1: credentials(), u2: credentials({ vatNumber: '999999999', accessToken: 'u2-access' }) };
  saveRefreshedTokens = vi.fn(async (): Promise<boolean> => true);
  hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response(JSON.stringify(FILED)));
  refresh = vi.fn(async () => ({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, expiresAt: TODAY.getTime() + 3_600_000 }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GET /api/vat/filed', () => {
  it('refuses a request without sign-in and makes no HMRC call', async () => {
    expect((await handler()(asUser('/api/vat/filed?periodKey=26A1'))).status).toBe(401);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('rejects methods other than GET', async () => {
    expect((await handler()(asUser('/api/vat/filed?periodKey=26A1', 'u1', 'POST'))).status).toBe(405);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it.each(['', '?periodKey=', `?periodKey=${'x'.repeat(21)}`])('rejects bad query %s with 400', async (query) => {
    expect((await handler()(asUser(`/api/vat/filed${query}`, 'u1'))).status).toBe(400);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('fetches the period from HMRC with the bearer token and fraud headers, and returns the nine fields', async () => {
    const response = await handler()(asUser('/api/vat/filed?periodKey=%2326A1', 'u1'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: FILED });
    const [url, init] = hmrcFetch.mock.calls[0];
    expect(url).toContain(`/organisations/vat/${VRN}/returns/%2326A1`);
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(init.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
    expect(init.headers['Gov-Client-User-IDs']).toBe('stf=u1');
  });

  it("uses each user's own VAT number and token", async () => {
    await handler()(asUser('/api/vat/filed?periodKey=26A1', 'u2'));
    const [url, init] = hmrcFetch.mock.calls[0];
    expect(url).toContain('/vat/999999999/returns/');
    expect(init.headers.Authorization).toBe('Bearer u2-access');
  });

  it('refreshes an expired token, saves the new one and retries with it', async () => {
    stored.u1 = credentials({ expiresAt: new Date(TODAY.getTime() - 1000) });
    const response = await handler()(asUser('/api/vat/filed?periodKey=26A1', 'u1'));
    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith(REFRESH);
    expect(saveRefreshedTokens).toHaveBeenCalledTimes(1);
    expect(hmrcFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
  });

  it.each([
    [undefined, 'HMRC_NOT_CONNECTED'],
    [credentials({ vatNumber: null }), 'VAT_NUMBER_MISSING'],
  ])('answers 409 when HMRC is not set up', async (creds, code) => {
    stored.u1 = creds;
    const response = await handler()(asUser('/api/vat/filed?periodKey=26A1', 'u1'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe(code);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('turns an HMRC error into a 502 without echoing its message or the VAT number', async () => {
    hmrcFetch.mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_FOUND', message: `no return for ${VRN}` }), { status: 404 }));
    const response = await handler()(asUser('/api/vat/filed?periodKey=26A1', 'u1'));
    expect(response.status).toBe(502);
    const text = JSON.stringify(await response.json());
    expect(text).toContain('NOT_FOUND');
    expect(text).not.toContain(VRN);
  });
});
