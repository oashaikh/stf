import * as OTPAuth from 'otpauth';

// The sign-in and its code step are the only writes a live run may make; both only start a session.
const LIVE_WRITES = new Set(['POST /api/auth/login', 'POST /api/auth/mfa']);

/** `key` is "<METHOD> <pathname>". A mock run may write anything; a live run may read and sign in. */
export function writeIsAllowed(key: string, mocked: boolean): boolean {
  return mocked || key.startsWith('GET ') || LIVE_WRITES.has(key);
}

/** Lets a live run past the owner's second factor without changing the account: the secret is only read. */
export function journeyTotpCode(base32Secret: string, now = Date.now()): string {
  return new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(base32Secret), digits: 6, period: 30 }).generate({ timestamp: now });
}
