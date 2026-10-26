import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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

export interface SecondFactor {
  type: 'TOTP';
  authenticatedAt: Date;
  /** SHA-256 of a random per-login reference; the raw reference is never kept. */
  referenceHash: string;
}

/**
 * Token is `<expiry-ms>.<base64url hmac>` without a second factor, or
 * `<expiry-ms>.totp.<authenticated-at-ms>.<reference-hash>.<hmac>` with one. The HMAC covers every field before it.
 * Throws if SESSION_SECRET is unset or short; the message names no value.
 */
export function createSessionToken(now: Date, env: NodeJS.ProcessEnv = process.env, secondFactorAt?: Date): string {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const expiry = String(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
  const payload = secondFactorAt
    ? [expiry, 'totp', secondFactorAt.getTime(), createHash('sha256').update(randomBytes(16)).digest('hex')].join('.')
    : expiry;
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

interface ParsedSession {
  expiry: number;
  secondFactor: SecondFactor | null;
}

function parseSessionToken(token: string, now: Date, env: NodeJS.ProcessEnv): ParsedSession | null {
  const secret = sessionSecret(env);
  const parts = token.split('.');
  const signature = parts.pop();
  const payload = parts.join('.');
  if (!secret || !signature || (parts.length !== 1 && parts.length !== 4) || !/^\d+$/.test(parts[0])) return null;
  const presented = Buffer.from(signature, 'base64url');
  const expected = sign(payload, secret);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return null;
  const expiry = Number(parts[0]);
  if (expiry <= now.getTime()) return null;
  if (parts.length === 1) return { expiry, secondFactor: null };
  if (parts[1] !== 'totp' || !/^\d+$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) return null;
  return { expiry, secondFactor: { type: 'TOTP', authenticatedAt: new Date(Number(parts[2])), referenceHash: parts[3] } };
}

/** Returns the owner's external id for a valid, unexpired token, else null. Fails closed without a secret. */
export function verifySessionToken(token: string, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): string | null {
  return parseSessionToken(token, now, env) ? OWNER_EXTERNAL_ID : null;
}

/** The second-factor record on a request's valid session, or null for no session or a password-only one. */
export function readSecondFactor(request: Request, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): SecondFactor | null {
  const token = readSessionCookie(request);
  return token ? (parseSessionToken(token, now, env)?.secondFactor ?? null) : null;
}

export const CHALLENGE_COOKIE = 'stf_mfa_challenge';
export const CHALLENGE_MAX_AGE_SECONDS = 5 * 60;

/** Proves only that the password step passed. The `mfa-challenge` prefix keeps it from parsing as a session token. */
export function createChallengeToken(now: Date, env: NodeJS.ProcessEnv = process.env): string {
  const secret = sessionSecret(env);
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const payload = `mfa-challenge.${now.getTime() + CHALLENGE_MAX_AGE_SECONDS * 1000}`;
  return `${payload}.${sign(payload, secret).toString('base64url')}`;
}

export function verifyChallengeToken(token: string, now: Date = new Date(), env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = sessionSecret(env);
  const [prefix, expiry, signature, ...rest] = token.split('.');
  if (!secret || prefix !== 'mfa-challenge' || !/^\d+$/.test(expiry ?? '') || !signature || rest.length > 0) return false;
  const presented = Buffer.from(signature, 'base64url');
  const expected = sign(`${prefix}.${expiry}`, secret);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return false;
  return Number(expiry) > now.getTime();
}

function readCookie(request: Request, cookieName: string): string | undefined {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) return value.join('=') || undefined;
  }
  return undefined;
}

export const readChallengeCookie = (request: Request) => readCookie(request, CHALLENGE_COOKIE);

export const readSessionCookie = (request: Request) => readCookie(request, SESSION_COOKIE);

const COOKIE_ATTRIBUTES = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

export function challengeCookie(token: string): string {
  return `${CHALLENGE_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${CHALLENGE_MAX_AGE_SECONDS}`;
}

export function clearedChallengeCookie(): string {
  return `${CHALLENGE_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}
