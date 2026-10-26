import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(): Buffer {
  const encoded = process.env.HMRC_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error('HMRC_TOKEN_ENCRYPTION_KEY is not set');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('HMRC_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

function stateSecret(): string {
  const secret = process.env.HMRC_STATE_SECRET;
  if (!secret) throw new Error('HMRC_STATE_SECRET is not set');
  return secret;
}

/** Output is base64(iv | auth tag | ciphertext). */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

export function decryptToken(encoded: string): string {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error('Token decrypt failed');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, IV_BYTES));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  try {
    return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  } catch {
    // Node's own message can echo internals; keep ours fixed so nothing sensitive leaks.
    throw new Error('Token decrypt failed');
  }
}

function sign(payload: string): Buffer {
  return createHmac('sha256', stateSecret()).update(payload).digest();
}

/** Returns `payload.signature`, both base64url; payload is userId, expiry and a nonce. */
export function signState(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: userId, e: Date.now() + STATE_TTL_MS, n: randomBytes(16).toString('hex') }),
  ).toString('base64url');
  return `${payload}.${sign(payload).toString('base64url')}`;
}

/** The callback has no bearer header, so the user comes from the signed state. Null for any bad state. */
export function verifiedStateUserId(state: string): string | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = sign(payload);
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const valid = typeof claims.u === 'string' && typeof claims.e === 'number' && Date.now() <= claims.e;
    return valid ? claims.u : null;
  } catch {
    return null;
  }
}

export function verifyState(state: string, userId: string): boolean {
  return verifiedStateUserId(state) === userId;
}
