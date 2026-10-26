import type { ApiError } from '../../src/model/types.js';
import { databaseUsers, type UserStore } from '../_lib/auth.js';
import { loginThrottle } from '../_lib/loginThrottle.js';
import { createSessionToken, OWNER_EMAIL, OWNER_EXTERNAL_ID, sessionCookie, verifyOwnerPassword } from '../_lib/ownerSession.js';

const MAX_PASSWORD_LENGTH = 1024;

export interface LoginDeps {
  throttle: Pick<typeof loginThrottle, 'lockedUntil' | 'recordFailure' | 'clear'>;
  users: UserStore;
  env: NodeJS.ProcessEnv;
  now: () => Date;
}

const refuse = (status: number, error: string, code: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error, code } satisfies ApiError, { status, headers });

export function createLoginHandler(deps: LoginDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return refuse(405, 'Method not allowed', 'METHOD');
    try {
      const body = await request.json().catch(() => null);
      const password = body?.password;
      if (typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
        return refuse(400, 'password must be a non-empty string', 'BAD_REQUEST');
      }

      // Lockout comes first so a locked client never learns whether the password was right.
      const now = deps.now();
      const lockedUntil = await deps.throttle.lockedUntil(now);
      if (lockedUntil) {
        const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
        return refuse(429, 'Too many attempts', 'LOCKED', { 'Retry-After': String(retryAfter) });
      }

      if (!verifyOwnerPassword(password, deps.env)) {
        await deps.throttle.recordFailure(now);
        return refuse(401, 'Invalid password', 'UNAUTHORIZED');
      }

      await deps.throttle.clear();
      await deps.users.createIfAbsent(OWNER_EXTERNAL_ID, OWNER_EMAIL);
      const token = createSessionToken(now, deps.env);
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token) } });
    } catch (error) {
      // Log the class only: messages can carry the password or session secret.
      console.error('Login error', error instanceof Error ? error.name : 'unknown');
      return refuse(500, 'Internal server error', 'INTERNAL');
    }
  };
}

export default {
  fetch: createLoginHandler({ throttle: loginThrottle, users: databaseUsers, env: process.env, now: () => new Date() }),
};
