import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptToken, encryptToken, signState, verifyState } from './hmrcCrypto';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

beforeEach(() => {
  vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', KEY);
  vi.stubEnv('HMRC_STATE_SECRET', 'test-state-secret');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('token encryption', () => {
  it('round-trips and uses a fresh IV per call', () => {
    const first = encryptToken('access-token-123');
    expect(decryptToken(first)).toBe('access-token-123');
    expect(encryptToken('access-token-123')).not.toBe(first);
    expect(first).not.toContain('access-token-123');
  });

  it('throws without leaking plaintext when ciphertext is tampered', () => {
    const bytes = Buffer.from(encryptToken('secret-value'), 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptToken(bytes.toString('base64'))).toThrow(/decrypt/i);
    try {
      decryptToken(bytes.toString('base64'));
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-value');
    }
  });

  it('throws when decrypting with a different key', () => {
    const ciphertext = encryptToken('secret-value');
    vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', OTHER_KEY);
    expect(() => decryptToken(ciphertext)).toThrow(/decrypt/i);
  });

  it('throws on malformed ciphertext', () => {
    expect(() => decryptToken('abc')).toThrow(/decrypt/i);
  });

  it('fails closed when the key is missing or the wrong length', () => {
    vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', '');
    expect(() => encryptToken('x')).toThrow(/HMRC_TOKEN_ENCRYPTION_KEY/);
    vi.stubEnv('HMRC_TOKEN_ENCRYPTION_KEY', Buffer.alloc(16).toString('base64'));
    expect(() => encryptToken('x')).toThrow(/32 bytes/);
  });
});

describe('oauth state', () => {
  it('verifies state for the same user', () => {
    expect(verifyState(signState('user_1'), 'user_1')).toBe(true);
  });

  it('produces a different nonce each time', () => {
    expect(signState('user_1')).not.toBe(signState('user_1'));
  });

  it('rejects state issued to another user', () => {
    expect(verifyState(signState('user_1'), 'user_2')).toBe(false);
  });

  it('rejects forged and malformed state', () => {
    const [payload] = signState('user_1').split('.');
    expect(verifyState(`${payload}.AAAA`, 'user_1')).toBe(false);
    expect(verifyState('garbage', 'user_1')).toBe(false);
    expect(verifyState('', 'user_1')).toBe(false);
    expect(verifyState('a.b.c', 'user_1')).toBe(false);
  });

  it('rejects state signed with another secret', () => {
    const state = signState('user_1');
    vi.stubEnv('HMRC_STATE_SECRET', 'different-secret');
    expect(verifyState(state, 'user_1')).toBe(false);
  });

  it('rejects state after 10 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    const state = signState('user_1');
    vi.setSystemTime(new Date('2026-10-26T10:09:59Z'));
    expect(verifyState(state, 'user_1')).toBe(true);
    vi.setSystemTime(new Date('2026-10-26T10:10:01Z'));
    expect(verifyState(state, 'user_1')).toBe(false);
  });

  it('fails closed without a signing secret', () => {
    vi.stubEnv('HMRC_STATE_SECRET', '');
    expect(() => signState('user_1')).toThrow(/HMRC_STATE_SECRET/);
  });
});
