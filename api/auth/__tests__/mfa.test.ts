import * as OTPAuth from 'otpauth';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { requireAuth, UnauthorizedError } from '../../_lib/auth';
import { createLoginThrottle, type LoginAttemptRows } from '../../_lib/loginThrottle';
import { createChallengeToken, readSecondFactor, verifySessionToken } from '../../_lib/ownerSession';
import { createTotpService, generateSecret, hashRecoveryCode, type TotpRows } from '../../_lib/totp';
import { createMfaHandler } from '../mfa';

const ENV = { OWNER_PASSWORD: 'unused-here', SESSION_SECRET: 'a-test-session-secret-of-32-chars-or-more' } as NodeJS.ProcessEnv;
const NOW = new Date('2026-10-26T12:00:10Z');
const SECRET = generateSecret();

const codeAt = (date: Date) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(SECRET), digits: 6, period: 30 }).generate({ timestamp: date.getTime() });

function memoryThrottleRows(): LoginAttemptRows {
  let attempts: { key: string; at: Date }[] = [];
  return {
    async insert(key, at) {
      attempts.push({ key, at });
    },
    async latestSince(key, since, limit) {
      return attempts
        .filter((row) => row.key === key && row.at > since)
        .map((row) => row.at)
        .sort((a, b) => b.getTime() - a.getTime())
        .slice(0, limit);
    },
    async deleteBefore(cutoff) {
      attempts = attempts.filter((row) => row.at > cutoff);
    },
    async deleteForClient(key) {
      attempts = attempts.filter((row) => row.key !== key);
    },
  };
}

async function setup(recoveryCodes: string[] = []) {
  const state = { secretEncrypted: '', lastStep: null as number | null, recovery: new Map(recoveryCodes.map((c) => [hashRecoveryCode(c), false])) };
  const rows: TotpRows = {
    async find() {
      return { secretEncrypted: state.secretEncrypted, enabledAt: new Date(0), lastStep: state.lastStep };
    },
    async saveSecret(_user, encrypted) {
      state.secretEncrypted = encrypted;
    },
    async enable() {},
    async advanceStep(_user, step) {
      if (state.lastStep !== null && state.lastStep >= step) return false;
      state.lastStep = step;
      return true;
    },
    async useRecoveryHash(_user, hash) {
      if (state.recovery.get(hash) !== false) return false;
      state.recovery.set(hash, true);
      return true;
    },
    async disable() {},
  };
  const service = createTotpService(rows);
  await service.begin('owner-row-id', SECRET);
  const users = { findId: vi.fn(), createIfAbsent: vi.fn(async () => 'owner-row-id') };
  const handler = createMfaHandler({ throttle: createLoginThrottle(memoryThrottleRows()), users, totp: service, env: ENV, now: () => NOW });
  const submit = (code: unknown, challenge: string | null = createChallengeToken(NOW, ENV), address = '203.0.113.7') =>
    handler(
      new Request('https://x.test/api/auth/mfa', {
        method: 'POST',
        headers: { 'x-vercel-forwarded-for': address, ...(challenge ? { cookie: `stf_mfa_challenge=${challenge}` } : {}) },
        body: JSON.stringify({ code }),
      }),
    );
  return { submit, users };
}

beforeAll(() => {
  process.env.HMRC_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/mfa', () => {
  it('issues a session carrying a TOTP second factor for a right code', async () => {
    const { submit } = await setup();
    const response = await submit(codeAt(NOW));
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    const session = cookies.find((cookie) => cookie.startsWith('stf_session='))!;
    expect(session).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(cookies.some((cookie) => cookie.startsWith('stf_mfa_challenge=;') && cookie.includes('Max-Age=0'))).toBe(true);
    const token = session.split(';')[0].split('=').slice(1).join('=');
    expect(verifySessionToken(token, NOW, ENV)).toBe('owner');
    const record = readSecondFactor(new Request('https://x.test', { headers: { cookie: `stf_session=${token}` } }), NOW, ENV);
    expect(record).toMatchObject({ type: 'TOTP', authenticatedAt: NOW });
  });

  it('refuses a wrong code with 401 and no session', async () => {
    const { submit } = await setup();
    const response = await submit('000000');
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a reused TOTP code', async () => {
    const { submit } = await setup();
    expect((await submit(codeAt(NOW))).status).toBe(200);
    expect((await submit(codeAt(NOW))).status).toBe(401);
  });

  it('accepts a recovery code once, with the same TOTP type, and refuses its reuse', async () => {
    const { submit } = await setup(['abcdef0123-4567890123']);
    const first = await submit('abcdef0123-4567890123');
    expect(first.status).toBe(200);
    const token = first.headers.getSetCookie()[0].split(';')[0].split('=').slice(1).join('=');
    expect(readSecondFactor(new Request('https://x.test', { headers: { cookie: `stf_session=${token}` } }), NOW, ENV)?.type).toBe('TOTP');
    expect((await submit('abcdef0123-4567890123')).status).toBe(401);
  });

  it('locks out only the client that guessed wrong', async () => {
    const { submit } = await setup();
    for (let i = 0; i < 5; i += 1) await submit('000000', undefined, '198.51.100.9');
    expect((await submit(codeAt(NOW), undefined, '198.51.100.9')).status).toBe(429);
    expect((await submit(codeAt(NOW))).status).toBe(200);
  });

  it('counts wrong codes toward the lockout: the 6th attempt gets 429 even with a right code', async () => {
    const { submit } = await setup();
    for (let i = 0; i < 5; i += 1) expect((await submit('000000')).status).toBe(401);
    const response = await submit(codeAt(NOW));
    expect(response.status).toBe(429);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('refuses without a valid challenge cookie, even with a right code', async () => {
    const { submit } = await setup();
    const missing = await submit(codeAt(NOW), null);
    expect(missing.status).toBe(401);
    expect((await missing.json()).code).toBe('CHALLENGE_EXPIRED');
    expect((await submit(codeAt(NOW), 'mfa-challenge.1.AAAA')).status).toBe(401);
    expect((await submit(codeAt(NOW), createChallengeToken(new Date(NOW.getTime() - 6 * 60_000), ENV))).status).toBe(401);
  });

  it('rejects a bad code field with 400', async () => {
    const { submit } = await setup();
    expect((await submit(42)).status).toBe(400);
    expect((await submit('')).status).toBe(400);
  });

  it('keeps the code and secret out of logs and bodies', async () => {
    const spies = (['log', 'error', 'warn', 'info'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const { submit, users } = await setup();
    const good = codeAt(NOW);
    users.createIfAbsent.mockRejectedValueOnce(new Error(`boom ${good} ${SECRET}`));
    const broken = await submit(good);
    expect(broken.status).toBe(500);
    const bodies = [await broken.text(), await (await submit('000000')).text()];
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const secret of [good, SECRET, '000000']) {
      expect(logged).not.toContain(secret);
      for (const body of bodies) expect(body).not.toContain(secret);
    }
  });

  it('a challenge cookie alone cannot call requireAuth', async () => {
    const challenge = createChallengeToken(NOW, ENV);
    const deps = {
      issuer: { verifyToken: async (token: string) => verifySessionToken(token, NOW, ENV), getEmail: async () => 'x' },
      users: { findId: async () => 'id', createIfAbsent: async () => 'id' },
    };
    for (const cookie of [`stf_mfa_challenge=${challenge}`, `stf_session=${challenge}`]) {
      await expect(requireAuth(new Request('https://x.test', { headers: { cookie } }), deps)).rejects.toBeInstanceOf(UnauthorizedError);
    }
  });
});
