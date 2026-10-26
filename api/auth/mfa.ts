import type { ApiError } from '../../src/model/types.js';
import { databaseUsers, type UserStore } from '../_lib/auth.js';
import { loginThrottle } from '../_lib/loginThrottle.js';
import {
  clearedChallengeCookie,
  createSessionToken,
  OWNER_EMAIL,
  OWNER_EXTERNAL_ID,
  readChallengeCookie,
  sessionCookie,
  verifyChallengeToken,
} from '../_lib/ownerSession.js';
import { totp } from '../_lib/totpStore.js';

const MAX_CODE_LENGTH = 64;

export interface MfaDeps {
  throttle: Pick<typeof loginThrottle, 'lockedUntil' | 'recordFailure' | 'clear'>;
  users: UserStore;
  totp: Pick<typeof totp, 'verifyLogin' | 'consumeRecoveryCode'>;
  env: NodeJS.ProcessEnv;
  now: () => Date;
}

const refuse = (status: number, error: string, code: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error, code } satisfies ApiError, { status, headers });

export function createMfaHandler(deps: MfaDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return refuse(405, 'Method not allowed', 'METHOD');
    try {
      const body = await request.json().catch(() => null);
      const code = body?.code;
      if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) {
        return refuse(400, 'code must be a non-empty string', 'BAD_REQUEST');
      }

      // Same lockout as the password step, checked first so a locked client learns nothing about the code.
      const now = deps.now();
      const lockedUntil = await deps.throttle.lockedUntil(now);
      if (lockedUntil) {
        const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
        return refuse(429, 'Too many attempts', 'LOCKED', { 'Retry-After': String(retryAfter) });
      }

      const challenge = readChallengeCookie(request);
      if (!challenge || !verifyChallengeToken(challenge, now, deps.env)) {
        return refuse(401, 'Sign in with your password first', 'CHALLENGE_EXPIRED');
      }

      const userId = await deps.users.createIfAbsent(OWNER_EXTERNAL_ID, OWNER_EMAIL);
      const accepted = (await deps.totp.verifyLogin(userId, code, now)) || (await deps.totp.consumeRecoveryCode(userId, code));
      if (!accepted) {
        await deps.throttle.recordFailure(now);
        return refuse(401, 'Invalid code', 'UNAUTHORIZED');
      }

      await deps.throttle.clear();
      const headers = new Headers();
      headers.append('Set-Cookie', sessionCookie(createSessionToken(now, deps.env, now)));
      headers.append('Set-Cookie', clearedChallengeCookie());
      return Response.json({ ok: true }, { headers });
    } catch (error) {
      // Log the class only: messages can carry the code or the secret.
      console.error('MFA error', error instanceof Error ? error.name : 'unknown');
      return refuse(500, 'Internal server error', 'INTERNAL');
    }
  };
}

export default {
  fetch: createMfaHandler({ throttle: loginThrottle, users: databaseUsers, totp, env: process.env, now: () => new Date() }),
};
