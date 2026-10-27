import { describe, expect, it } from 'vitest';
import { journeyTotpCode, writeIsAllowed } from '../../../e2e/writeGuard';

describe('journey write guard', () => {
  it('lets a live run read and sign in, including the code step', () => {
    expect(writeIsAllowed('GET /api/entries', false)).toBe(true);
    expect(writeIsAllowed('POST /api/auth/login', false)).toBe(true);
    expect(writeIsAllowed('POST /api/auth/mfa', false)).toBe(true);
  });

  it.each(['POST /api/entries', 'PATCH /api/entries', 'PUT /api/vat/return', 'POST /api/vat/preview', 'DELETE /api/entries', 'POST /api/settings/authenticator'])(
    'fails a live run that attempts %s',
    (key) => {
      expect(writeIsAllowed(key, false)).toBe(false);
    },
  );

  it('lets the mock run write', () => {
    expect(writeIsAllowed('POST /api/entries', true)).toBe(true);
  });

  it('generates the code for a base32 secret at a fixed time', () => {
    // RFC 6238 test secret ("12345678901234567890"), SHA1, 6 digits: T=59s gives 287082.
    expect(journeyTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
  });
});
