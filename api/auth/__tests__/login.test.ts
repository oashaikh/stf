import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoginThrottle, LOCKOUT_MS, type LoginAttemptRows } from '../../_lib/loginThrottle';
import { OWNER_EXTERNAL_ID, verifySessionToken } from '../../_lib/ownerSession';
import { createLoginHandler } from '../login';

const PASSWORD = 'correct-horse-battery-staple';
const WRONG = 'wrong-password-value';
const ENV = { OWNER_PASSWORD: PASSWORD, SESSION_SECRET: 'a-test-session-secret-of-32-chars-or-more' } as NodeJS.ProcessEnv;
const NOW = new Date('2026-10-26T12:00:00Z');

function memoryRows(): LoginAttemptRows {
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

function setup(now: () => Date = () => NOW) {
  const users = {
    findId: vi.fn(),
    createIfAbsent: vi.fn(async () => 'owner-row-id'),
  };
  const throttle = createLoginThrottle(memoryRows());
  const totp = { isEnabled: vi.fn(async () => false) };
  const handler = createLoginHandler({ throttle, users, totp, env: ENV, now });
  const login = (password: unknown) =>
    handler(new Request('https://x.test/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }));
  return { login, users, handler, totp };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/auth/login', () => {
  it('refuses a wrong password with 401 and no cookie', async () => {
    const { login } = setup();
    const response = await login(WRONG);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('sets a signed 30-day HttpOnly Secure SameSite=Lax cookie for the right password', async () => {
    const { login, users } = setup();
    const response = await login(PASSWORD);
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') as string;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
    const token = cookie.split(';')[0].split('=').slice(1).join('=');
    expect(verifySessionToken(token, NOW, ENV)).toBe(OWNER_EXTERNAL_ID);
    expect(users.createIfAbsent).toHaveBeenCalledWith(OWNER_EXTERNAL_ID, expect.any(String));
  });

  it('locks out the 6th attempt after 5 failures, even with the right password', async () => {
    const { login } = setup();
    for (let i = 0; i < 5; i += 1) expect((await login(WRONG)).status).toBe(401);
    const response = await login(PASSWORD);
    expect(response.status).toBe(429);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(Number(response.headers.get('retry-after'))).toBe(LOCKOUT_MS / 1000);
  });

  it('accepts the right password again once the lockout has passed', async () => {
    let now = NOW;
    const { login } = setup(() => now);
    for (let i = 0; i < 5; i += 1) await login(WRONG);
    now = new Date(NOW.getTime() + LOCKOUT_MS + 1000);
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it('clears earlier failures after a successful login', async () => {
    const { login } = setup();
    for (let i = 0; i < 4; i += 1) await login(WRONG);
    await login(PASSWORD);
    for (let i = 0; i < 4; i += 1) expect((await login(WRONG)).status).toBe(401);
  });

  it.each([undefined, 42, '', 'x'.repeat(1025)])('rejects a bad password field %j with 400', async (password) => {
    const { login } = setup();
    expect((await login(password)).status).toBe(400);
  });

  it('rejects a non-JSON body with 400', async () => {
    const { handler } = setup();
    const response = await handler(new Request('https://x.test/api/auth/login', { method: 'POST', body: 'nope' }));
    expect(response.status).toBe(400);
  });

  it('rejects non-POST methods with 405', async () => {
    const { handler } = setup();
    expect((await handler(new Request('https://x.test/api/auth/login'))).status).toBe(405);
  });

  it('never puts the password or cookie value in logs or response bodies', async () => {
    const spies = (['log', 'error', 'warn', 'info'] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const { login, users } = setup();
    const bodies: string[] = [];
    const failure = await login(WRONG);
    bodies.push(await failure.text());
    const success = await login(PASSWORD);
    bodies.push(await success.text());
    const token = (success.headers.get('set-cookie') as string).split(';')[0].split('=').slice(1).join('=');
    users.createIfAbsent.mockRejectedValueOnce(new Error(`boom ${PASSWORD} ${token}`));
    const broken = await login(PASSWORD);
    expect(broken.status).toBe(500);
    bodies.push(await broken.text());

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const secret of [PASSWORD, WRONG, token, ENV.SESSION_SECRET as string]) {
      expect(logged).not.toContain(secret);
      for (const body of bodies) expect(body).not.toContain(secret);
    }
  });

  it('with the authenticator on, a right password sets only a challenge cookie, not a session', async () => {
    const { login, totp } = setup();
    totp.isEnabled.mockResolvedValue(true);
    const response = await login(PASSWORD);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, mfaRequired: true });
    const cookie = response.headers.get('set-cookie') as string;
    expect(cookie).toMatch(/^stf_mfa_challenge=/);
    expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    expect(cookie).toContain('Max-Age=300');
    expect(cookie).not.toContain('stf_session');
  });

  it('with the authenticator on, a right password does not clear earlier failures', async () => {
    const { login, totp } = setup();
    totp.isEnabled.mockResolvedValue(true);
    for (let i = 0; i < 4; i += 1) await login(WRONG);
    await login(PASSWORD);
    await login(WRONG);
    expect((await login(PASSWORD)).status).toBe(429);
  });
});
