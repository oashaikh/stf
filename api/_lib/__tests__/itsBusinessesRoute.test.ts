import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { HmrcTokenSet } from '../../../src/lib/hmrc/client';
import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import { createItsBusinessesHandler } from '../../hmrc/its-businesses';
import type { AuthDeps } from '../auth';
import type { HmrcCredentials, HmrcStatus, HmrcStore } from '../hmrcStore';
import type { TaxIdentifiersStore } from '../taxIdentifiers';

const ACCESS = 'access-secret-AAA';
const REFRESH = 'refresh-secret-BBB';
const NEW_ACCESS = 'access-secret-NEW';
const NINO = 'QQ123456C';
const TODAY = new Date('2026-10-26T10:00:00Z');

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const asUser = (userId?: string, method = 'GET', body?: unknown) =>
  new Request('https://app.test/api/hmrc/its-businesses', {
    method,
    headers: { ...(userId ? { cookie: `stf_session=tok-${userId}` } : {}), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const credentials = (): HmrcCredentials => ({
  vatNumber: null,
  accessToken: ACCESS,
  refreshToken: REFRESH,
  storedRefreshToken: 'stored-refresh',
  expiresAt: new Date(TODAY.getTime() + 3_600_000),
});

const SE_ONE = { businessId: 'XAIS12345678901', typeOfBusiness: 'self-employment', tradingName: 'Test Trading' };
const SE_TWO = { businessId: 'XAIS99999999999', typeOfBusiness: 'self-employment', tradingName: 'Second Trade' };
const PROPERTY = { businessId: 'XPIS00000000001', typeOfBusiness: 'uk-property' };

type FetchArgs = [url: string, init: { headers: Record<string, string> }];
let hmrcFetch: Mock<FetchArgs, Promise<Response>>;
let refresh: Mock<unknown[], Promise<HmrcTokenSet>>;
let setItsBusinessId: Mock<unknown[], Promise<void>>;
let saveRefreshedTokens: Mock<unknown[], Promise<boolean>>;
let status: HmrcStatus;
let sandboxMode: boolean | undefined;
let storedNino: string | null;
let consoleOutput: string;

const respondWith = (businesses: unknown[]) => {
  hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response(JSON.stringify({ businessDetails: businesses })));
};

const handler = () =>
  createItsBusinessesHandler(
    {
      sandboxMode: async () => sandboxMode,
      credentials: async (userId: string) => (userId === 'u1' ? credentials() : undefined),
      status: async () => status,
      setItsBusinessId,
      saveRefreshedTokens,
    } as unknown as HmrcStore,
    {
      get: async () => ({ ninoEncrypted: storedNino === null ? null : encryptToken(storedNino), utrEncrypted: null }),
    } as unknown as TaxIdentifiersStore,
    authDeps,
    { fetchFn: hmrcFetch as unknown as typeof fetch, refresh, now: () => TODAY },
  );

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  sandboxMode = true;
  storedNino = NINO;
  status = { connected: true, expiresAt: null, itsBusinessId: null, needsItsReconnect: false };
  setItsBusinessId = vi.fn(async () => {});
  saveRefreshedTokens = vi.fn(async (): Promise<boolean> => true);
  respondWith([SE_ONE, PROPERTY]);
  refresh = vi.fn(async () => ({ accessToken: NEW_ACCESS, refreshToken: 'refresh-NEW', expiresAt: TODAY.getTime() + 3_600_000 }));
  consoleOutput = '';
  for (const method of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      consoleOutput += parts.map(String).join(' ');
    });
  }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/hmrc/its-businesses', () => {
  it('refuses a request without sign-in and makes no HMRC call', async () => {
    expect((await handler()(asUser())).status).toBe(401);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('stores the only self-employment business and never returns the NINO', async () => {
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      ok: true,
      businesses: [{ businessId: SE_ONE.businessId, tradingName: 'Test Trading' }],
      selectedBusinessId: SE_ONE.businessId,
    });
    expect(text).not.toContain(NINO);
    expect(setItsBusinessId).toHaveBeenCalledWith('u1', SE_ONE.businessId);
  });

  it('sends the NINO in the path and fraud headers on the HMRC call', async () => {
    await handler()(asUser('u1'));
    const [url, init] = hmrcFetch.mock.calls[0];
    expect(url).toContain(`/individuals/business/details/${NINO}/list`);
    expect(init.headers['Gov-Client-User-IDs']).toBeDefined();
  });

  it('leaves the choice to the owner when there are several businesses', async () => {
    respondWith([SE_ONE, SE_TWO]);
    const body = await (await handler()(asUser('u1'))).json();
    expect(body.businesses).toHaveLength(2);
    expect(body.selectedBusinessId).toBeNull();
    expect(setItsBusinessId).not.toHaveBeenCalled();
  });

  it('returns 409 NO_NINO when no NINO is stored', async () => {
    storedNino = null;
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('NO_NINO');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns 409 when HMRC is not connected', async () => {
    const response = await handler()(asUser('u2'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('HMRC_NOT_CONNECTED');
  });

  it('returns 409 when the granted scope lacks Income Tax', async () => {
    status = { ...status, needsItsReconnect: true };
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ITS_SCOPE_MISSING');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('refuses live mode unless the env flag and the owner opt-in agree', async () => {
    sandboxMode = false;
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('LIVE_MODE_REFUSED');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('refreshes on a 401, saves the rotated tokens and retries with the new token', async () => {
    let calls = 0;
    hmrcFetch = vi.fn(async (..._args: FetchArgs) =>
      ++calls === 1
        ? new Response(JSON.stringify({ code: 'INVALID_CREDENTIALS' }), { status: 401 })
        : new Response(JSON.stringify({ businessDetails: [SE_ONE] })),
    );
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(200);
    expect(hmrcFetch).toHaveBeenCalledTimes(2);
    expect(hmrcFetch.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect(saveRefreshedTokens).toHaveBeenCalled();
  });

  it('keeps the NINO and tokens out of the console when HMRC fails', async () => {
    hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response(JSON.stringify({ code: 'MATCHING_RESOURCE_NOT_FOUND' }), { status: 404 }));
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(502);
    const text = await response.text();
    for (const secret of [NINO, ACCESS, REFRESH, NEW_ACCESS]) {
      expect(consoleOutput).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    expect(consoleOutput).not.toContain('/individuals/');
  });
});

describe('POST /api/hmrc/its-businesses', () => {
  it('stores a business id that is in HMRC list', async () => {
    respondWith([SE_ONE, SE_TWO]);
    const response = await handler()(asUser('u1', 'POST', { businessId: SE_TWO.businessId }));
    expect(response.status).toBe(200);
    expect(setItsBusinessId).toHaveBeenCalledWith('u1', SE_TWO.businessId);
  });

  it('rejects an id HMRC did not list with 400 and stores nothing', async () => {
    const response = await handler()(asUser('u1', 'POST', { businessId: 'XAIS00000000000' }));
    expect(response.status).toBe(400);
    expect(setItsBusinessId).not.toHaveBeenCalled();
  });

  it('rejects a non-self-employment id', async () => {
    const response = await handler()(asUser('u1', 'POST', { businessId: PROPERTY.businessId }));
    expect(response.status).toBe(400);
    expect(setItsBusinessId).not.toHaveBeenCalled();
  });

  it('rejects a malformed body without calling HMRC', async () => {
    const response = await handler()(asUser('u1', 'POST', { businessId: 42 }));
    expect(response.status).toBe(400);
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('refuses a request without sign-in', async () => {
    expect((await handler()(asUser(undefined, 'POST', { businessId: SE_ONE.businessId }))).status).toBe(401);
    expect(setItsBusinessId).not.toHaveBeenCalled();
  });
});
