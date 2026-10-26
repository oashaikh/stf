import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'stf_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const OWNER_EXTERNAL_ID = 'owner';
export const OWNER_EMAIL = 'owner@stf.invalid';

const MIN_SECRET_LENGTH = 32;
// Fixed salt: scrypt is only here to give both sides equal length for timingSafeEqual, not to store passwords.
const COMPARE_SALT = 'stf-owner-password-compare';

function scryptDigest(value: string): Buffer {
  return scryptSync(value, COMPARE_SALT, 32);
}

/** Fails closed when OWNER_PASSWORD is unset or empty. */
export function verifyOwnerPassword(submitted: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = env.OWNER_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(scryptDigest(submitted), scryptDigest(expected));
}

function sessionSecret(env: NodeJS.ProcessEnv): string | null {
  const secret = env.SESSION_SECRET;
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

function sign(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

/** Token is `<expiry-ms>.<base64url hmac>`. Throws if SESSION_SECRET is unset or short; the message names no value. */
export function createSessionToken(now: Date, env: NodeJS.ProcessEnv = process.env): string {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const payload = String(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

/** Returns the owner's external id for a valid, unexpired token, else null. Fails closed without a secret. */
export function verifySessionToken(token: string, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = sessionSecret(env);
  const [payload, signature, ...rest] = token.split('.');
  if (!secret || !payload || !signature || rest.length > 0 || !/^\d+$/.test(payload)) return null;
  const presented = Buffer.from(signature, 'base64url');
  const expected = sign(payload, secret);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  return Number(payload) > now.getTime() ? OWNER_EXTERNAL_ID : null;
}

export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=') || undefined;
  }
  return undefined;
}

const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}
