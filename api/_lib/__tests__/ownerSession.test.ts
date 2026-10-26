import { afterEach, describe, expect, it, vi } from 'vitest';
import { timingSafeEqual } from 'node:crypto';

import {
  clearedSessionCookie,
  createSessionToken,
  readSessionCookie,
  sessionCookie,
  verifyOwnerPassword,
  verifySessionToken,
} from '../ownerSession';

const SECRET = 'a-test-session-secret-of-32-chars-or-more';
const env = { SESSION_SECRET: SECRET, OWNER_PASSWORD: 'correct horse' } as NodeJS.ProcessEnv;
const NOW = new Date('2026-10-26T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

afterEach(() => {
  vi.mocked(timingSafeEqual).mockClear();
});

describe('verifyOwnerPassword', () => {
  it('accepts the right password and refuses a wrong one', () => {
    expect(verifyOwnerPassword('correct horse', env)).toBe(true);
    expect(verifyOwnerPassword('wrong', env)).toBe(false);
    expect(verifyOwnerPassword('correct horse ', env)).toBe(false);
  });

  it('fails closed when OWNER_PASSWORD is unset or empty, even for an empty submission', () => {
    expect(verifyOwnerPassword('', {} as NodeJS.ProcessEnv)).toBe(false);
    expect(verifyOwnerPassword('', { OWNER_PASSWORD: '' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('hashes both sides with scrypt and compares with timingSafeEqual', () => {
    const compare = vi.mocked(timingSafeEqual);
    verifyOwnerPassword('wrong', env);
    expect(compare).toHaveBeenCalledTimes(1);
    const [left, right] = compare.mock.calls[0] as [Buffer, Buffer];
    expect(left).toHaveLength(32);
    expect(right).toHaveLength(32);
    expect(left.toString()).not.toContain('wrong');
  });
});

describe('session tokens', () => {
  it('round-trips and expires after 30 days', () => {
    const token = createSessionToken(NOW, env);
    expect(verifySessionToken(token, new Date(NOW.getTime() + 29 * DAY), env)).toBe('owner');
    expect(verifySessionToken(token, new Date(NOW.getTime() + 30 * DAY), env)).toBeNull();
  });

  it('refuses tampered payloads, tampered signatures, a different secret and malformed values', () => {
    const token = createSessionToken(NOW, env);
    const [payload, signature] = token.split('.');
    const later = String(Number(payload) + DAY);
    expect(verifySessionToken(`${later}.${signature}`, NOW, env)).toBeNull();
    expect(verifySessionToken(`${payload}.${signature.slice(0, -2)}AA`, NOW, env)).toBeNull();
    expect(verifySessionToken(token, NOW, { SESSION_SECRET: `${SECRET}-other` } as NodeJS.ProcessEnv)).toBeNull();
    for (const bad of ['', 'abc', `${payload}.`, `.${signature}`, `${token}.extra`, 'x.y']) {
      expect(verifySessionToken(bad, NOW, env)).toBeNull();
    }
  });

  it('fails closed when SESSION_SECRET is unset or short', () => {
    const token = createSessionToken(NOW, env);
    expect(verifySessionToken(token, NOW, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(verifySessionToken(token, NOW, { SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toBeNull();
    expect(() => createSessionToken(NOW, {} as NodeJS.ProcessEnv)).toThrow('SESSION_SECRET is not configured');
    expect(() => createSessionToken(NOW, { SESSION_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow(
      /^SESSION_SECRET is not configured$/,
    );
  });
});

describe('cookies', () => {
  it('sets HttpOnly, Secure, SameSite=Lax, Path=/ and a 30 day Max-Age', () => {
    const cookie = sessionCookie('tok');
    expect(cookie.startsWith('stf_session=tok;')).toBe(true);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) {
      expect(cookie.split('; ')).toContain(attribute);
    }
  });

  it('clears the cookie with Max-Age=0 and the same attributes', () => {
    const cookie = clearedSessionCookie();
    expect(cookie.startsWith('stf_session=;')).toBe(true);
    expect(cookie.split('; ')).toEqual(expect.arrayContaining(['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']));
  });

  it('reads the session cookie among others', () => {
    const request = (cookie?: string) => new Request('https://x.test/', { headers: cookie ? { cookie } : {} });
    expect(readSessionCookie(request('a=1; stf_session=abc.def; b=2'))).toBe('abc.def');
    expect(readSessionCookie(request('a=1'))).toBeUndefined();
    expect(readSessionCookie(request('stf_session='))).toBeUndefined();
    expect(readSessionCookie(request())).toBeUndefined();
  });
});
