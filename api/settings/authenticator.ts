import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { loginThrottle } from '../_lib/loginThrottle.js';
import { generateSecret, otpauthUri, qrCodeDataUrl } from '../_lib/totp.js';
import { totp } from '../_lib/totpStore.js';

const MAX_CODE_LENGTH = 64;
const ISSUER = 'STF';

export interface AuthenticatorDeps {
  throttle: Pick<typeof loginThrottle, 'lockedUntil' | 'recordFailure' | 'clear'>;
  totp: Pick<typeof totp, 'begin' | 'confirm' | 'isEnabled' | 'verifyLogin' | 'disable'>;
  now: () => Date;
}

// The start and confirm bodies carry the secret and the one-time recovery codes.
const NO_STORE = { 'Cache-Control': 'no-store' };

const refuse = (status: number, error: string, code: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error, code }, { status, headers });

/**
 * POST ?action=start | confirm | disable, GET for status. Wrong codes here feed the same lockout as
 * login, so a stolen session cannot be used to guess the code.
 */
export function createAuthenticatorHandler(deps: AuthenticatorDeps, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method === 'GET') {
      return Response.json({ ok: true, enabled: await deps.totp.isEnabled(auth.userId) });
    }
    if (request.method !== 'POST') return refuse(405, 'Method not allowed', 'METHOD');

    const action = new URL(request.url).searchParams.get('action');
    if (action === 'start') {
      if (await deps.totp.isEnabled(auth.userId)) return refuse(409, 'Authenticator is already on', 'ALREADY_ENABLED');
      const secret = generateSecret();
      await deps.totp.begin(auth.userId, secret);
      const uri = otpauthUri(secret, ISSUER);
      return Response.json(
        { ok: true, otpauthUri: uri, qrDataUrl: await qrCodeDataUrl(uri), secret },
        { headers: NO_STORE },
      );
    }
    if (action !== 'confirm' && action !== 'disable') return refuse(400, 'Unknown action', 'BAD_REQUEST');

    const body = await request.json().catch(() => null);
    const code = body?.code;
    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) {
      return refuse(400, 'code must be a non-empty string', 'BAD_REQUEST');
    }

    const now = deps.now();
    const lockedUntil = await deps.throttle.lockedUntil(now);
    if (lockedUntil) {
      const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
      return refuse(429, 'Too many attempts', 'LOCKED', { 'Retry-After': String(retryAfter) });
    }

    if (action === 'confirm') {
      const recoveryCodes = await deps.totp.confirm(auth.userId, code, now);
      if (!recoveryCodes) {
        await deps.throttle.recordFailure(now);
        return refuse(401, 'Invalid code', 'INVALID_CODE');
      }
      return Response.json({ ok: true, enabled: true, recoveryCodes }, { headers: NO_STORE });
    }

    if (!(await deps.totp.verifyLogin(auth.userId, code, now))) {
      await deps.throttle.recordFailure(now);
      return refuse(401, 'Invalid code', 'INVALID_CODE');
    }
    await deps.totp.disable(auth.userId);
    return Response.json({ ok: true, enabled: false });
  }, authDeps);
}

export default { fetch: createAuthenticatorHandler({ throttle: loginThrottle, totp, now: () => new Date() }) };
