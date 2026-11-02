import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signState } from '../../../server/src/lib/hmrcCrypto';
import { createCallbackHandler } from '../../bank/callback';
import { createConnectHandler } from '../../bank/connect';
import { createDisconnectHandler } from '../../bank/disconnect';
import { createStatusHandler } from '../../bank/status';
import type { AuthDeps } from '../auth';
import type { BankFeedProvider } from '../bankFeed';
import type { BankStatus, BankStore } from '../bankStore';

const CODE = 'auth-code-CCC';
const ACCESS = 'access-secret-AAA';
const NOW = new Date('2026-11-01T10:00:00Z');

interface Row {
  displayName: string;
  maskedAccountNumber: string | null;
  consentExpiresAt: Date;
  accessToken: string;
  deleted: boolean;
}

// In-memory store that scopes by user id the way the database store does.
function fakeStore(rows: Record<string, Row>): BankStore {
  return {
    save: vi.fn(async (userId, connection) => {
      rows[userId] = {
        displayName: connection.displayName,
        maskedAccountNumber: connection.maskedAccountNumber,
        consentExpiresAt: connection.consentExpiresAt,
        accessToken: connection.accessToken,
        deleted: false,
      };
    }),
    status: async (userId): Promise<BankStatus> => {
      const row = rows[userId];
      if (!row || row.deleted) return { connected: false, displayName: null, maskedAccountNumber: null, consentExpiresAt: null, expired: false };
      return {
        connected: true,
        displayName: row.displayName,
        maskedAccountNumber: row.maskedAccountNumber,
        consentExpiresAt: row.consentExpiresAt.toISOString(),
        expired: row.consentExpiresAt.getTime() <= Date.now(),
      };
    },
    disconnect: vi.fn(async (userId) => {
      if (rows[userId]) rows[userId].deleted = true;
    }),
  };
}

function fakeProvider(overrides: Partial<BankFeedProvider> = {}): BankFeedProvider {
  return {
    startConsent: (state) => `https://bank.test/consent?state=${encodeURIComponent(state)}`,
    finishConsent: vi.fn(async () => ({ accessToken: ACCESS, refreshToken: 'refresh-BBB', expiresAt: new Date('2026-11-01T11:00:00Z') })),
    listAccounts: vi.fn(async () => [{ id: 'acc-1', name: 'Sandbox Current', maskedNumber: '5678' }]),
    listTransactions: vi.fn(),
    ...overrides,
  };
}

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const asUser = (path: string, userId?: string, method = 'GET') =>
  new Request(`https://app.test${path}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} });

let rows: Record<string, Row>;
let logged: string;

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  vi.stubEnv('HMRC_STATE_SECRET', 'test-state-secret');
  vi.stubEnv('APP_ORIGIN', 'https://app.test');
  rows = {};
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
    const response = await createConnectHandler(() => fakeProvider(), authDeps)(asUser('/api/bank/connect'));
    expect(response.status).toBe(401);
  });

  it('returns the consent URL carrying a state signed for the caller', async () => {
    const response = await createConnectHandler(() => fakeProvider(), authDeps)(asUser('/api/bank/connect', 'u1'));
    const body = await response.json();
    expect(body.ok).toBe(true);
    const state = new URL(body.url).searchParams.get('state')!;
    const { verifiedStateUserId } = await import('../../../server/src/lib/hmrcCrypto');
    expect(verifiedStateUserId(state)).toBe('u1');
  });
});

describe('callback', () => {
  const callbackUrl = (state: string, code = CODE) => `/api/bank/callback?code=${code}&state=${encodeURIComponent(state)}`;

  it('saves the first GBP account with a 90 day consent expiry for the user named by the state', async () => {
    vi.useFakeTimers({ now: NOW });
    const store = fakeStore(rows);
    const response = await createCallbackHandler({ store, getProvider: () => fakeProvider() })(asUser(callbackUrl(signState('u1'))));
    expect(response.headers.get('location')).toBe('https://app.test/bank?bank=connected');
    expect(rows.u1.displayName).toBe('Sandbox Current');
    expect(rows.u1.maskedAccountNumber).toBe('5678');
    expect(rows.u1.consentExpiresAt).toEqual(new Date(NOW.getTime() + 90 * 24 * 60 * 60 * 1000));
    expect(rows.u2).toBeUndefined();
  });

  it('returns 400 INVALID_STATE with no provider call for a missing state', async () => {
    const provider = fakeProvider();
    const response = await createCallbackHandler({ store: fakeStore(rows), getProvider: () => provider })(asUser(`/api/bank/callback?code=${CODE}`));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_STATE');
    expect(provider.finishConsent).not.toHaveBeenCalled();
  });

  it('returns 400 with no provider call for a forged state', async () => {
    const provider = fakeProvider();
    const [payload] = signState('u1').split('.');
    const response = await createCallbackHandler({ store: fakeStore(rows), getProvider: () => provider })(asUser(callbackUrl(`${payload}.forged`)));
    expect(response.status).toBe(400);
    expect(provider.finishConsent).not.toHaveBeenCalled();
  });

  it('returns 400 with no provider call for an expired state', async () => {
    vi.useFakeTimers();
    const state = signState('u1');
    vi.advanceTimersByTime(11 * 60 * 1000);
    const provider = fakeProvider();
    const response = await createCallbackHandler({ store: fakeStore(rows), getProvider: () => provider })(asUser(callbackUrl(state)));
    expect(response.status).toBe(400);
    expect(provider.finishConsent).not.toHaveBeenCalled();
  });

  it('redirects to error without calling the provider for an oversized code', async () => {
    const provider = fakeProvider();
    const response = await createCallbackHandler({ store: fakeStore(rows), getProvider: () => provider })(
      asUser(callbackUrl(signState('u1'), 'x'.repeat(257))),
    );
    expect(response.headers.get('location')).toBe('https://app.test/bank?bank=error');
    expect(provider.finishConsent).not.toHaveBeenCalled();
  });

  it('redirects to error and saves nothing when there is no GBP account', async () => {
    const store = fakeStore(rows);
    const provider = fakeProvider({ listAccounts: vi.fn(async () => []) });
    const response = await createCallbackHandler({ store, getProvider: () => provider })(asUser(callbackUrl(signState('u1'))));
    expect(response.headers.get('location')).toBe('https://app.test/bank?bank=error');
    expect(store.save).not.toHaveBeenCalled();
  });

  it('redirects to error and logs only the error class when the provider fails', async () => {
    const provider = fakeProvider({
      finishConsent: vi.fn(async () => {
        throw new TypeError(`rejected ${CODE} ${ACCESS}`);
      }),
    });
    const response = await createCallbackHandler({ store: fakeStore(rows), getProvider: () => provider })(asUser(callbackUrl(signState('u1'))));
    expect(response.headers.get('location')).toBe('https://app.test/bank?bank=error');
    expect(logged).toContain('TypeError');
    for (const secret of [CODE, ACCESS]) expect(logged).not.toContain(secret);
  });
});

describe('status', () => {
  it('refuses a request without sign-in', async () => {
    expect((await createStatusHandler(fakeStore(rows), authDeps)(asUser('/api/bank/status'))).status).toBe(401);
  });

  it('reports expired consent and never returns a token field', async () => {
    rows.u1 = { displayName: 'Sandbox Current', maskedAccountNumber: '5678', consentExpiresAt: new Date(Date.now() - 1000), accessToken: ACCESS, deleted: false };
    const response = await createStatusHandler(fakeStore(rows), authDeps)(asUser('/api/bank/status', 'u1'));
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, connected: true, expired: true, displayName: 'Sandbox Current', maskedAccountNumber: '5678' });
    expect(text).not.toMatch(/token/i);
    expect(text).not.toContain(ACCESS);
  });

  it("does not show another user's connection", async () => {
    rows.u1 = { displayName: 'Sandbox Current', maskedAccountNumber: '5678', consentExpiresAt: new Date(Date.now() + 100000), accessToken: ACCESS, deleted: false };
    const body = await (await createStatusHandler(fakeStore(rows), authDeps)(asUser('/api/bank/status', 'u2'))).json();
    expect(body.connected).toBe(false);
    expect(body.displayName).toBeNull();
  });
});

describe('disconnect', () => {
  beforeEach(() => {
    rows.u1 = { displayName: 'Sandbox Current', maskedAccountNumber: '5678', consentExpiresAt: new Date(Date.now() + 100000), accessToken: ACCESS, deleted: false };
  });

  it('refuses a request without sign-in', async () => {
    const response = await createDisconnectHandler(fakeStore(rows), authDeps)(asUser('/api/bank/disconnect', undefined, 'POST'));
    expect(response.status).toBe(401);
    expect(rows.u1.deleted).toBe(false);
  });

  it('refuses GET', async () => {
    expect((await createDisconnectHandler(fakeStore(rows), authDeps)(asUser('/api/bank/disconnect', 'u1'))).status).toBe(405);
  });

  it('disconnects the caller and a repeat is harmless', async () => {
    const handler = createDisconnectHandler(fakeStore(rows), authDeps);
    expect((await handler(asUser('/api/bank/disconnect', 'u1', 'POST'))).status).toBe(200);
    expect(rows.u1.deleted).toBe(true);
    expect((await handler(asUser('/api/bank/disconnect', 'u1', 'POST'))).status).toBe(200);
  });

  it("leaves another user's connection alone", async () => {
    await createDisconnectHandler(fakeStore(rows), authDeps)(asUser('/api/bank/disconnect', 'u2', 'POST'));
    expect(rows.u1.deleted).toBe(false);
  });
});
