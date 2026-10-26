import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { decryptToken, signState } from '../../../server/src/lib/hmrcCrypto';
import { createCallbackHandler } from '../../hmrc/callback';
import { createConnectHandler } from '../../hmrc/connect';
import { createModeHandler } from '../../hmrc/mode';
import { createStatusHandler } from '../../hmrc/status';
import type { AuthDeps } from '../auth';
import type { HmrcStore } from '../hmrcStore';

const ACCESS = 'access-secret-AAA';
const REFRESH = 'refresh-secret-BBB';
const CODE = 'auth-code-CCC';

interface Row {
  sandbox: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
}

function fakeStore(rows: Record<string, Row>): HmrcStore {
  return {
    sandboxMode: async (userId) => rows[userId]?.sandbox,
    setSandboxMode: async (userId, sandbox) => {
      if (rows[userId]) rows[userId].sandbox = sandbox;
    },
    saveTokens: vi.fn(async (userId, tokens) => {
      Object.assign(rows[userId], tokens);
    }),
    credentials: vi.fn(),
    saveRefreshedTokens: vi.fn(),
    status: async (userId) => ({
      connected: Boolean(rows[userId]?.refreshToken),
      expiresAt: rows[userId]?.expiresAt?.toISOString() ?? null,
    }),
  };
}

// Bearer token "tok-<user>" signs in as that user.
const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const asUser = (path: string, userId?: string) =>
  new Request(`https://app.test${path}`, { headers: userId ? { authorization: `Bearer tok-${userId}` } : {} });

let rows: Record<string, Row>;
let logged: string;

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_STATE_SECRET', 'test-state-secret');
  vi.stubEnv('HMRC_CLIENT_ID', 'client-id');
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.stubEnv('HMRC_REDIRECT_URI', 'https://app.test/api/hmrc/callback');
  vi.stubEnv('APP_ORIGIN', 'https://app.test');
  rows = { u1: { sandbox: true }, u2: { sandbox: true } };
  logged = '';
  for (const method of ['log', 'error', 'warn'] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => {
      logged += args.join(' ');
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('connect', () => {
  it('refuses a request without sign-in', async () => {
    const response = await createConnectHandler(fakeStore(rows), authDeps)(asUser('/api/hmrc/connect'));
    expect(response.status).toBe(401);
  });

  it('returns a sandbox authorize URL carrying a state signed for the caller', async () => {
    const response = await createConnectHandler(fakeStore(rows), authDeps)(asUser('/api/hmrc/connect', 'u1'));
    const { url } = await response.json();
    expect(url).toContain('https://test-www.tax.service.gov.uk/oauth/authorize');
    expect(new URL(url).searchParams.get('state')).toBeTruthy();
  });

  it.each([
    ['env live, user sandbox', 'false', true],
    ['env sandbox, user live', 'true', false],
  ])('refuses a live/sandbox mismatch (%s)', async (_label, envValue, userSandbox) => {
    vi.stubEnv('HMRC_SANDBOX_MODE', envValue);
    rows.u1.sandbox = userSandbox;
    const response = await createConnectHandler(fakeStore(rows), authDeps)(asUser('/api/hmrc/connect', 'u1'));
    expect(response.status).toBe(403);
  });

  it('allows live only when both env and user setting say live', async () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    rows.u1.sandbox = false;
    const response = await createConnectHandler(fakeStore(rows), authDeps)(asUser('/api/hmrc/connect', 'u1'));
    expect((await response.json()).url).toContain('https://www.tax.service.gov.uk/');
  });
});

describe('mode', () => {
  const post = (body: unknown, userId?: string) =>
    createModeHandler(fakeStore(rows), authDeps)(
      new Request('https://app.test/api/hmrc/mode', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: userId ? { authorization: `Bearer tok-${userId}` } : {},
      }),
    );

  it('defaults to not opted in to live and reports the env mode', async () => {
    const body = await (await createModeHandler(fakeStore(rows), authDeps)(asUser('/api/hmrc/mode', 'u1'))).json();
    expect(body).toMatchObject({ live: false, envLive: false });
  });

  it('requires sign-in', async () => {
    expect((await post({ live: true })).status).toBe(401);
  });

  it.each([[{ live: 'yes' }], [{}], [null]])('rejects a non-boolean body %j', async (body) => {
    expect((await post(body, 'u1')).status).toBe(400);
    expect(rows.u1.sandbox).toBe(true);
  });

  it('opts the caller in and out without touching another user', async () => {
    expect((await post({ live: true }, 'u1')).status).toBe(200);
    expect(rows.u1.sandbox).toBe(false);
    expect(rows.u2.sandbox).toBe(true);
    await post({ live: false }, 'u1');
    expect(rows.u1.sandbox).toBe(true);
  });
});

describe('callback', () => {
  const tokens = () => ({ accessToken: ACCESS, refreshToken: REFRESH, expiresAt: Date.now() + 14_400_000 });
  const callbackUrl = (state: string) => `/api/hmrc/callback?code=${CODE}&state=${encodeURIComponent(state)}`;

  it('stores only ciphertext, only on the state user, and redirects connected', async () => {
    const store = fakeStore(rows);
    const exchange = vi.fn(async () => tokens());
    const response = await createCallbackHandler({ store, exchange })(asUser(callbackUrl(signState('u1'))));

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://app.test/settings?hmrc=connected');
    expect(exchange).toHaveBeenCalledWith(CODE, 'https://app.test/api/hmrc/callback');
    expect(rows.u1.accessToken).not.toContain(ACCESS);
    expect(rows.u1.refreshToken).not.toContain(REFRESH);
    expect(decryptToken(rows.u1.accessToken as string)).toBe(ACCESS);
    expect(decryptToken(rows.u1.refreshToken as string)).toBe(REFRESH);
    expect(rows.u2.accessToken).toBeUndefined();
  });

  it.each([
    ['forged signature', () => `${signState('u1').split('.')[0]}.AAAA`],
    ['malformed', () => 'garbage'],
    ['empty', () => ''],
  ])('returns 400 with no token exchange for %s state', async (_label, makeState) => {
    const exchange = vi.fn(async () => tokens());
    const response = await createCallbackHandler({ store: fakeStore(rows), exchange })(asUser(callbackUrl(makeState())));
    expect(response.status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it('returns 400 with no token exchange for an expired state', async () => {
    vi.useFakeTimers();
    const state = signState('u1');
    vi.advanceTimersByTime(11 * 60 * 1000);
    const exchange = vi.fn(async () => tokens());
    const response = await createCallbackHandler({ store: fakeStore(rows), exchange })(asUser(callbackUrl(state)));
    expect(response.status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("never writes to another user's row, even if a state names them", async () => {
    // A state for u2 is a valid u2 state; it must touch u2 only, never u1.
    const store = fakeStore(rows);
    await createCallbackHandler({ store, exchange: async () => tokens() })(asUser(callbackUrl(signState('u2'))));
    expect(rows.u1.accessToken).toBeUndefined();
    expect(rows.u2.accessToken).toBeDefined();
  });

  it('redirects to error and logs nothing sensitive when the exchange fails', async () => {
    const exchange = vi.fn(async () => {
      throw new Error(`rejected ${CODE} ${REFRESH}`);
    });
    const response = await createCallbackHandler({ store: fakeStore(rows), exchange })(asUser(callbackUrl(signState('u1'))));
    expect(response.headers.get('location')).toBe('https://app.test/settings?hmrc=error');
    expect(rows.u1.accessToken).toBeUndefined();
    for (const secret of [CODE, REFRESH, ACCESS]) expect(logged).not.toContain(secret);
  });

  it('redirects to error without exchanging when HMRC reports a denial', async () => {
    const exchange = vi.fn(async () => tokens());
    const url = `/api/hmrc/callback?error=access_denied&state=${encodeURIComponent(signState('u1'))}`;
    const response = await createCallbackHandler({ store: fakeStore(rows), exchange })(asUser(url));
    expect(response.headers.get('location')).toBe('https://app.test/settings?hmrc=error');
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe('status', () => {
  it('refuses a request without sign-in', async () => {
    const response = await createStatusHandler(fakeStore(rows), authDeps)(asUser('/api/hmrc/status'));
    expect(response.status).toBe(401);
  });

  it("shows each user only their own connection and never token material", async () => {
    rows.u1 = { sandbox: true, accessToken: 'ct-a', refreshToken: 'ct-r', expiresAt: new Date('2030-01-01T00:00:00Z') };
    const handler = createStatusHandler(fakeStore(rows), authDeps);

    const first = await (await handler(asUser('/api/hmrc/status', 'u1'))).json();
    expect(first).toEqual({ ok: true, connected: true, expiresAt: '2030-01-01T00:00:00.000Z' });

    const second = await (await handler(asUser('/api/hmrc/status', 'u2'))).json();
    expect(second).toEqual({ ok: true, connected: false, expiresAt: null });
  });
});

describe('database store credentials', () => {
  const NEW_ACCESS = 'access-secret-NNN';
  const NEW_REFRESH = 'refresh-secret-RRR';
  let stored: { vatNumber: string | null; accessToken: string; refreshToken: string; expiresAt: Date };
  let setPayload: Record<string, unknown>;
  let updateMatches: boolean;

  async function loadStore() {
    vi.resetModules();
    vi.doMock('../db', () => ({
      db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [stored] }) }) }),
        update: () => ({
          set: (payload: Record<string, unknown>) => {
            setPayload = payload;
            return { where: () => ({ returning: async () => (updateMatches ? [{ id: 'u1' }] : []) }) };
          },
        }),
      },
    }));
    const crypto = await import('../../../server/src/lib/hmrcCrypto');
    stored = {
      vatNumber: '123456789',
      accessToken: crypto.encryptToken(ACCESS),
      refreshToken: crypto.encryptToken(REFRESH),
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    };
    return { ...(await import('../hmrcStore')), crypto };
  }

  afterEach(() => vi.doUnmock('../db'));

  it('decrypts stored tokens and keeps the stored refresh ciphertext as the guard', async () => {
    updateMatches = true;
    const { databaseHmrcStore, crypto } = await loadStore();
    const credentials = await databaseHmrcStore.credentials('u1');
    expect(credentials).toMatchObject({ vatNumber: '123456789', accessToken: ACCESS, refreshToken: REFRESH });
    expect(crypto.decryptToken(credentials!.storedRefreshToken)).toBe(REFRESH);
  });

  it('has no credentials when the user has no stored tokens', async () => {
    updateMatches = true;
    const { databaseHmrcStore } = await loadStore();
    stored.refreshToken = null as unknown as string;
    expect(await databaseHmrcStore.credentials('u1')).toBeUndefined();
  });

  it('saves refreshed tokens as ciphertext and reports whether the guard matched', async () => {
    const { databaseHmrcStore, crypto } = await loadStore();
    const tokens = { accessToken: NEW_ACCESS, refreshToken: NEW_REFRESH, expiresAt: new Date('2030-02-01T00:00:00Z') };

    updateMatches = true;
    expect(await databaseHmrcStore.saveRefreshedTokens('u1', stored.refreshToken, tokens)).toBe(true);
    expect(setPayload.hmrcAccessToken).not.toContain(NEW_ACCESS);
    expect(crypto.decryptToken(setPayload.hmrcRefreshToken as string)).toBe(NEW_REFRESH);

    updateMatches = false;
    expect(await databaseHmrcStore.saveRefreshedTokens('u1', 'rotated-elsewhere', tokens)).toBe(false);
  });
});
