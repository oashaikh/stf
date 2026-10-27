import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { HmrcTokenSet } from '../../../src/lib/hmrc/client';
import fixtures from '../../../src/lib/hmrc/fixtures/itsObligations.json';
import { encryptToken } from '../../../server/src/lib/hmrcCrypto';
import { createItsObligationsHandler } from '../../hmrc/its-obligations';
import type { AuthDeps } from '../auth';
import type { HmrcCredentials, HmrcStatus, HmrcStore, ItsObligationsCacheEntry } from '../hmrcStore';
import type { ItsObligation } from '../itsObligations';
import type { TaxIdentifiersStore } from '../taxIdentifiers';

const ACCESS = 'access-secret-AAA';
const REFRESH = 'refresh-secret-BBB';
const NINO = 'QQ123456C';
const TODAY = new Date('2026-10-26T10:00:00Z');

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const asUser = (userId?: string, method = 'GET') =>
  new Request('https://app.test/api/hmrc/its-obligations', {
    method,
    headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
  });

const credentials = (): HmrcCredentials => ({
  vatNumber: null,
  accessToken: ACCESS,
  refreshToken: REFRESH,
  storedRefreshToken: 'stored-refresh',
  expiresAt: new Date(TODAY.getTime() + 3_600_000),
});

type FetchArgs = [url: string, init: { headers: Record<string, string> }];

let hmrcFetch: Mock<FetchArgs, Promise<Response>>;
let status: HmrcStatus;
let sandboxMode: boolean | undefined;
let storedNino: string | null;
let saved: { userId: string; taxYear: string; payload: unknown }[];
let cacheByUser: Record<string, ItsObligationsCacheEntry[]>;
let consoleOutput: string;

// The recorded sandbox responses stand in for 2026-27; the previous year has nothing open.
const respondFromFixtures = () => {
  hmrcFetch = vi.fn(async (...[url]: FetchArgs) => {
    const current = url.includes('fromDate=2026-04-06');
    if (url.includes('/crystallisation')) return new Response(JSON.stringify(current ? fixtures.finalDeclaration : { obligations: [] }));
    return new Response(JSON.stringify(current ? fixtures.incomeAndExpenditure : { obligations: [] }));
  });
};

const handler = () =>
  createItsObligationsHandler(
    {
      sandboxMode: async () => sandboxMode,
      credentials: async (userId: string) => (userId === 'u1' || userId === 'u2' ? credentials() : undefined),
      status: async () => status,
      saveRefreshedTokens: async () => true,
      saveItsObligations: async (userId: string, taxYear: string, payload: unknown) => {
        saved.push({ userId, taxYear, payload });
      },
      lastItsObligations: async (userId: string) => cacheByUser[userId] ?? [],
    } as unknown as HmrcStore,
    { get: async () => ({ ninoEncrypted: storedNino === null ? null : encryptToken(storedNino), utrEncrypted: null }) } as unknown as TaxIdentifiersStore,
    authDeps,
    { fetchFn: hmrcFetch as unknown as typeof fetch, refresh: vi.fn(async () => ({}) as HmrcTokenSet), now: () => TODAY },
  );

const storedItem: ItsObligation = {
  kind: 'quarterly',
  taxYear: '2026-27',
  periodStart: '2026-07-06',
  periodEnd: '2026-10-05',
  dueDate: '2026-11-07',
  status: 'open',
  receivedDate: null,
};

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('HMRC_ITSA_ENABLED', 'true');
  sandboxMode = true;
  storedNino = NINO;
  status = { connected: true, expiresAt: null, itsBusinessId: 'XAIS12345678901', needsItsReconnect: false };
  saved = [];
  cacheByUser = {};
  respondFromFixtures();
  consoleOutput = '';
  for (const method of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
      consoleOutput += parts.map(String).join(' ');
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/hmrc/its-obligations', () => {
  it('rejects a request with no session', async () => {
    expect((await handler()(asUser())).status).toBe(401);
  });

  it('rejects other methods', async () => {
    expect((await handler()(asUser('u1', 'POST'))).status).toBe(405);
  });

  it('says Income Tax is off, and calls HMRC not at all, when the flag is unset', async () => {
    vi.stubEnv('HMRC_ITSA_ENABLED', '');
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: 'ITSA_DISABLED', error: 'Income Tax is off' });
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('refuses live mode unless the env flag and the owner opt-in agree', async () => {
    sandboxMode = false;
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('LIVE_MODE_REFUSED');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('allows live mode only when both switches are off sandbox', async () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    sandboxMode = false;
    expect((await handler()(asUser('u1'))).status).toBe(200);
  });

  it('returns 409 when HMRC is not connected', async () => {
    const response = await handler()(asUser('u3'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('HMRC_NOT_CONNECTED');
  });

  it('returns 409 when the granted scope lacks Income Tax', async () => {
    status = { ...status, needsItsReconnect: true };
    const response = await handler()(asUser('u1'));
    expect((await response.json()).code).toBe('ITS_SCOPE_MISSING');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns 409 when no business has been chosen', async () => {
    status = { ...status, itsBusinessId: null };
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('NO_BUSINESS_SELECTED');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns 409 when no NINO is stored', async () => {
    storedNino = null;
    const response = await handler()(asUser('u1'));
    expect((await response.json()).code).toBe('NO_NINO');
    expect(hmrcFetch).not.toHaveBeenCalled();
  });

  it('returns both tax years, flags one next due and saves each year', async () => {
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.stale).toBe(false);
    expect(body.obligations).toHaveLength(3);
    expect(body.obligations.filter((o: { nextDue: boolean }) => o.nextDue)).toHaveLength(1);
    expect(body.nextDue).toMatchObject({ kind: 'quarterly', dueDate: '2026-11-07', periodStart: '2026-07-06', overdue: false });
    expect(body.obligations.map((o: { status: string }) => o.status)).toEqual(['fulfilled', 'open', 'open']);
    expect(saved.map((s) => [s.userId, s.taxYear])).toEqual([
      ['u1', '2025-26'],
      ['u1', '2026-27'],
    ]);
    // Four calls: quarterly and final declaration for each of the two years, all with fraud headers.
    expect(hmrcFetch).toHaveBeenCalledTimes(4);
    expect(hmrcFetch.mock.calls.map(([url]) => url).join(' ')).toContain('fromDate=2025-04-06');
    expect(hmrcFetch.mock.calls[0][1].headers['Gov-Client-User-IDs']).toBeDefined();
  });

  it('returns the stored state as stale with a plain error when HMRC fails', async () => {
    cacheByUser.u1 = [{ taxYear: '2026-27', payload: [storedItem], fetchedAt: new Date('2026-10-20T08:00:00Z') }];
    hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response(JSON.stringify({ code: 'SERVER_ERROR', message: `raw ${NINO}` }), { status: 500 }));
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, stale: true, fetchedAt: '2026-10-20T08:00:00.000Z' });
    expect(body.error).toMatch(/HMRC could not be reached/);
    expect(body.nextDue).toMatchObject({ dueDate: '2026-11-07' });
    expect(saved).toHaveLength(0);
    for (const text of [JSON.stringify(body), consoleOutput]) {
      for (const secret of [NINO, ACCESS, REFRESH]) expect(text).not.toContain(secret);
    }
  });

  it('returns the stored state as stale when the HMRC request itself fails', async () => {
    cacheByUser.u1 = [{ taxYear: '2026-27', payload: [storedItem], fetchedAt: new Date('2026-10-20T08:00:00Z') }];
    hmrcFetch = vi.fn(async (..._args: FetchArgs): Promise<Response> => {
      throw new TypeError(`fetch failed for ${NINO}`);
    });
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, stale: true });
    expect(saved).toHaveLength(0);
    for (const secret of [NINO, ACCESS, REFRESH]) expect(consoleOutput).not.toContain(secret);
  });

  it('returns the stored state as stale when HMRC sends a body we cannot read', async () => {
    cacheByUser.u1 = [{ taxYear: '2026-27', payload: [storedItem], fetchedAt: new Date('2026-10-20T08:00:00Z') }];
    hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response('{"obligations":"nope"}', { status: 200 }));
    const body = await (await handler()(asUser('u1'))).json();
    expect(body).toMatchObject({ ok: true, stale: true });
    expect(saved).toHaveLength(0);
  });

  it('recomputes overdue from today when serving stored state', async () => {
    cacheByUser.u1 = [{ taxYear: '2026-27', payload: [{ ...storedItem, dueDate: '2026-08-07' }], fetchedAt: new Date('2026-08-01T08:00:00Z') }];
    hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response('{}', { status: 500 }));
    const body = await (await handler()(asUser('u1'))).json();
    expect(body.obligations[0].overdue).toBe(true);
  });

  it('returns the error alone when HMRC fails and nothing is stored', async () => {
    hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response('{}', { status: 500 }));
    const response = await handler()(asUser('u1'));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: 'HMRC_FAILED' });
    expect(body.obligations).toBeUndefined();
  });

  it("never shows another user's stored state", async () => {
    cacheByUser.u1 = [{ taxYear: '2026-27', payload: [storedItem], fetchedAt: new Date('2026-10-20T08:00:00Z') }];
    hmrcFetch = vi.fn(async (..._args: FetchArgs) => new Response('{}', { status: 500 }));
    const response = await handler()(asUser('u2'));
    expect(response.status).toBe(502);
    expect((await response.json()).obligations).toBeUndefined();
  });
});
