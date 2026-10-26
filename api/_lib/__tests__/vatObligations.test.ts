import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { HmrcTokenSet } from '../../../src/lib/hmrc/client';
import { createObligationsHandler } from '../../vat/obligations';
import type { AuthDeps } from '../auth';
import type { HmrcCredentials, HmrcStore } from '../hmrcStore';

const ACCESS = 'access-secret-AAA';
const REFRESH = 'refresh-secret-BBB';
const NEW_ACCESS = 'access-secret-NEW';
const NEW_REFRESH = 'refresh-secret-NEW';
const VRN = '123456789';
const TODAY = new Date('2026-10-26T10:00:00Z');

const sandboxObligations = [
  { start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'F', periodKey: '26A1', received: '2026-05-01' },
  { start: '2026-04-01', end: '2026-06-30', due: '2026-08-07', status: 'O', periodKey: '26A2' },
  { start: '2026-07-01', end: '2026-09-30', due: '2026-11-07', status: 'O', periodKey: '26A3' },
];

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const asUser = (path: string, userId?: string, method = 'GET') =>
  new Request(`https://app.test${path}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} });

function credentials(overrides: Partial<HmrcCredentials> = {}): HmrcCredentials {
  return {
    vatNumber: VRN,
    accessToken: ACCESS,
    refreshToken: REFRESH,
    storedRefreshToken: 'ciphertext-refresh',
    expiresAt: new Date(TODAY.getTime() + 3_600_000),
    ...overrides,
  };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let stored: Record<string, HmrcCredentials | undefined>;
let saveRefreshedTokens: Mock<unknown[], Promise<boolean>>;
type FetchArgs = [url: string, init: { headers: Record<string, string> }];
let hmrcFetch: Mock<FetchArgs, Promise<Response>>;
let refresh: Mock<unknown[], Promise<HmrcTokenSet>>;
let logged: string;

function handler() {
  const store = {
    credentials: async (userId: string) => stored[userId],
    saveRefreshedTokens,
  } as unknown as HmrcStore;
  return createObligationsHandler(store, authDeps, { fetchFn: hmrcFetch as unknown as typeof fetch, refresh, now: () => TODAY });
}

beforeEach(() => {
  stored = { u1: credentials(), u2: credentials({ vatNumber: '999999999', accessToken: 'u2-access' }) };
  saveRefreshedTokens = vi.fn(async (): Promise<boolean> => true);
  hmrcFetch = vi.fn(async (..._args: FetchArgs) => jsonResponse({ obligations: sandboxObligations }));
  refresh = vi.fn(
    async (): Promise<HmrcTokenSet> => ({ accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, expiresAt: TODAY.getTime() + 3_600_000 }),
  );
  logged = '';
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => {
      logged += args.join(' ');
    });
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GET /api/vat/obligations', () => {
  it('refuses a request without sign-in and makes no HMRC call', async () => {
    const response = await handler()(asUser('/api/vat/obligations'));
    expect(response.status).toBe(401);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('rejects methods other than GET', async () => {
    const response = await handler()(asUser('/api/vat/obligations', 'u1', 'POST'));
    expect(response.status).toBe(405);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns only the obligation fields plus a server-computed overdue flag', async () => {
    const response = await handler()(asUser('/api/vat/obligations', 'u1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.obligations).toEqual([
      { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31', due: '2026-05-07', status: 'F', received: '2026-05-01', overdue: false },
      { periodKey: '26A2', start: '2026-04-01', end: '2026-06-30', due: '2026-08-07', status: 'O', overdue: true },
      { periodKey: '26A3', start: '2026-07-01', end: '2026-09-30', due: '2026-11-07', status: 'O', overdue: false },
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(VRN);
  });

  it('defaults to the last 12 months and sends mandatory fraud headers and the bearer token', async () => {
    await handler()(asUser('/api/vat/obligations', 'u1'));
    const [url, init] = hmrcFetch.mock.calls[0];
    expect(url).toContain(`/organisations/vat/${VRN}/obligations?from=2025-10-26&to=2026-10-26`);
    expect(init.headers.Authorization).toBe(`Bearer ${ACCESS}`);
    expect(init.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
    expect(init.headers['Gov-Client-User-IDs']).toBe('stf=u1');
  });

  it('passes through a valid from, to and status filter', async () => {
    await handler()(asUser('/api/vat/obligations?from=2026-01-01&to=2026-06-30&status=O', 'u1'));
    expect(hmrcFetch.mock.calls[0][0]).toContain('obligations?from=2026-01-01&to=2026-06-30&status=O');
  });

  it.each([
    ['from=2026-1-1'],
    ['from=not-a-date'],
    ['to=2026-02-30'],
    ['status=X'],
    ['from=2025-01-01&to=2026-10-26'],
    ['from=2026-06-30&to=2026-01-01'],
  ])('rejects bad query %s with 400 and no HMRC call', async (query) => {
    const response = await handler()(asUser(`/api/vat/obligations?${query}`, 'u1'));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('BAD_REQUEST');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns 409 when HMRC is not connected', async () => {
    stored.u1 = undefined;
    const response = await handler()(asUser('/api/vat/obligations', 'u1'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('HMRC_NOT_CONNECTED');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns 409 when no VAT number is set', async () => {
    stored.u1 = credentials({ vatNumber: null });
    const response = await handler()(asUser('/api/vat/obligations', 'u1'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('VAT_NUMBER_MISSING');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it("uses the caller's own credentials and ignores a userId query parameter", async () => {
    await handler()(asUser('/api/vat/obligations?userId=u1', 'u2'));
    const [url, init] = hmrcFetch.mock.calls[0];
    expect(url).toContain('/organisations/vat/999999999/');
    expect(init.headers.Authorization).toBe('Bearer u2-access');
  });

  it('refreshes an expired token, retries once and saves the rotated tokens through the CAS method', async () => {
    stored.u1 = credentials({ expiresAt: new Date(TODAY.getTime() - 1000) });
    const response = await handler()(asUser('/api/vat/obligations', 'u1'));
    expect(response.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith(REFRESH);
    expect(hmrcFetch).toHaveBeenCalledTimes(1);
    expect(hmrcFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect(saveRefreshedTokens).toHaveBeenCalledWith('u1', 'ciphertext-refresh', {
      accessToken: NEW_ACCESS,
      refreshToken: NEW_REFRESH,
      expiresAt: new Date(TODAY.getTime() + 3_600_000),
    });
  });

  it('refreshes and retries once when HMRC answers 401', async () => {
    hmrcFetch.mockResolvedValueOnce(jsonResponse({ code: 'INVALID_CREDENTIALS', message: 'bad' }, 401));
    const response = await handler()(asUser('/api/vat/obligations', 'u1'));
    expect(response.status).toBe(200);
    expect(hmrcFetch).toHaveBeenCalledTimes(2);
    expect(saveRefreshedTokens).toHaveBeenCalledTimes(1);
  });

  it('still serves the request when saving the rotated tokens fails, logging the failure without secrets', async () => {
    stored.u1 = credentials({ expiresAt: new Date(TODAY.getTime() - 1000) });
    saveRefreshedTokens.mockRejectedValue(new Error(`db down ${NEW_REFRESH}`));
    const response = await handler()(asUser('/api/vat/obligations', 'u1'));
    expect(response.status).toBe(200);
    expect(hmrcFetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect(logged).not.toContain(NEW_REFRESH);
  });

  it('maps an HMRC error to a sanitised response with no token or VRN in the logs', async () => {
    hmrcFetch.mockResolvedValue(jsonResponse({ code: 'VRN_NOT_FOUND', message: `no ${VRN} for ${ACCESS}` }, 404));
    const response = await handler()(asUser('/api/vat/obligations', 'u1'));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: 'HMRC request failed', code: 'VRN_NOT_FOUND', hmrcStatus: 404 });
    expect(logged).not.toContain(ACCESS);
    expect(logged).not.toContain(REFRESH);
    expect(logged).not.toContain(VRN);
  });
});
