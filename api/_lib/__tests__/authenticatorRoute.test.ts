import * as OTPAuth from 'otpauth';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createAuthenticatorHandler } from '../../settings/authenticator';
import type { AuthDeps } from '../auth';
import { createLoginThrottle, MAX_FAILURES, type LoginAttemptRows } from '../loginThrottle';
import { createTotpService, hashRecoveryCode, type TotpRows } from '../totp';

const NOW = new Date('2026-10-26T12:00:10Z');
const LATER = new Date('2026-10-26T12:05:10Z');
const authDeps: AuthDeps = {
  issuer: { verifyToken: async (token) => (token === 'owner-token' ? 'owner' : null), getEmail: async () => 'owner@example.com' },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const codeAt = (secret: string, date: Date) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: date.getTime() });

function memoryRows() {
  const state = { secretEncrypted: null as string | null, enabledAt: null as Date | null, lastStep: null as number | null, recovery: [] as string[] };
  const rows: TotpRows = {
    async find() {
      return state.secretEncrypted ? { secretEncrypted: state.secretEncrypted, enabledAt: state.enabledAt, lastStep: state.lastStep } : null;
    },
    async saveSecret(_user, encrypted) {
      Object.assign(state, { secretEncrypted: encrypted, enabledAt: null, lastStep: null });
    },
    async enable(_user, enabledAt, step, hashes) {
      Object.assign(state, { enabledAt, lastStep: step, recovery: hashes });
    },
    async advanceStep(_user, step) {
      if (state.lastStep !== null && state.lastStep >= step) return false;
      state.lastStep = step;
      return true;
    },
    async useRecoveryHash() {
      return false;
    },
    async disable() {
      Object.assign(state, { secretEncrypted: null, enabledAt: null, lastStep: null, recovery: [] });
    },
  };
  return { state, rows };
}

function memoryThrottleRows(): LoginAttemptRows {
  let attempts: Date[] = [];
  return {
    async insert(at) {
      attempts.push(at);
    },
    async latestSince(since, limit) {
      return attempts.filter((at) => at > since).sort((a, b) => b.getTime() - a.getTime()).slice(0, limit);
    },
    async deleteBefore(cutoff) {
      attempts = attempts.filter((at) => at > cutoff);
    },
    async deleteAll() {
      attempts = [];
    },
  };
}

beforeAll(() => {
  process.env.HMRC_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authenticator settings route', () => {
  let state: ReturnType<typeof memoryRows>['state'];
  let now: Date;
  let call: (method: string, action?: string, body?: unknown, token?: string | null) => Promise<Response>;

  beforeEach(() => {
    const memory = memoryRows();
    state = memory.state;
    now = NOW;
    const handler = createAuthenticatorHandler(
      { throttle: createLoginThrottle(memoryThrottleRows()), totp: createTotpService(memory.rows), now: () => now },
      authDeps,
    );
    call = (method, action, body, token = 'owner-token') =>
      handler(
        new Request(`https://app.test/api/settings/authenticator${action ? `?action=${action}` : ''}`, {
          method,
          headers: token ? { cookie: `stf_session=${token}` } : {},
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
  });

  const startSetup = async () => ((await (await call('POST', 'start')).json()) as { secret: string }).secret;

  it('refuses every action without a session', async () => {
    for (const [method, action] of [['GET'], ['POST', 'start'], ['POST', 'confirm'], ['POST', 'disable']] as const) {
      expect((await call(method, action, undefined, null)).status).toBe(401);
    }
  });

  it('start stores the secret encrypted and leaves the authenticator off', async () => {
    const response = await call('POST', 'start');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(state.secretEncrypted).not.toContain(body.secret);
    expect(state.enabledAt).toBeNull();
    expect(await (await call('GET')).json()).toEqual({ ok: true, enabled: false });
  });

  it('a wrong code on confirm leaves the authenticator off', async () => {
    await startSetup();
    const response = await call('POST', 'confirm', { code: '000000' });
    expect(response.status).toBe(401);
    expect(state.enabledAt).toBeNull();
    expect(await (await call('GET')).json()).toEqual({ ok: true, enabled: false });
  });

  it('confirm returns 8 recovery codes once, stored only as hashes, and status never repeats them', async () => {
    const secret = await startSetup();
    const response = await call('POST', 'confirm', { code: codeAt(secret, now) });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.recoveryCodes).toHaveLength(8);
    expect(state.recovery).toEqual(body.recoveryCodes.map(hashRecoveryCode));
    expect(state.recovery).not.toContain(body.recoveryCodes[0]);

    const status = JSON.stringify(await (await call('GET')).json());
    expect(status).toBe('{"ok":true,"enabled":true}');
  });

  it('refuses to restart setup while enabled', async () => {
    const secret = await startSetup();
    await call('POST', 'confirm', { code: codeAt(secret, now) });
    const before = state.secretEncrypted;
    expect((await call('POST', 'start')).status).toBe(409);
    expect(state.secretEncrypted).toBe(before);
  });

  it('disable refuses a wrong code and accepts the current one', async () => {
    const secret = await startSetup();
    await call('POST', 'confirm', { code: codeAt(secret, now) });
    now = LATER;

    expect((await call('POST', 'disable', { code: '000000' })).status).toBe(401);
    expect(state.enabledAt).not.toBeNull();

    const response = await call('POST', 'disable', { code: codeAt(secret, now) });
    expect(response.status).toBe(200);
    expect(state.secretEncrypted).toBeNull();
    expect(state.recovery).toEqual([]);
  });

  it('counts wrong codes toward the login lockout', async () => {
    const secret = await startSetup();
    for (let attempt = 0; attempt < MAX_FAILURES; attempt++) {
      expect((await call('POST', 'confirm', { code: '000000' })).status).toBe(401);
    }
    const locked = await call('POST', 'confirm', { code: codeAt(secret, now) });
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).not.toBeNull();
    expect(state.enabledAt).toBeNull();
  });

  it('rejects a missing code and an unknown action', async () => {
    expect((await call('POST', 'confirm', {})).status).toBe(400);
    expect((await call('POST', 'nope')).status).toBe(400);
  });

  it('logs no secret or code when the store fails', async () => {
    const secret = await startSetup();
    const code = codeAt(secret, now);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = createAuthenticatorHandler(
      {
        throttle: createLoginThrottle(memoryThrottleRows()),
        totp: { ...createTotpService(memoryRows().rows), confirm: async () => { throw new Error(`boom ${secret} ${code}`); } },
        now: () => now,
      },
      authDeps,
    );
    const response = await failing(
      new Request('https://app.test/api/settings/authenticator?action=confirm', {
        method: 'POST',
        headers: { cookie: 'stf_session=owner-token' },
        body: JSON.stringify({ code }),
      }),
    );
    expect(response.status).toBe(500);
    const output = JSON.stringify(logged.mock.calls);
    expect(output).not.toContain(secret);
    expect(output).not.toContain(code);
  });
});
