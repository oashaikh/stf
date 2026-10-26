import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifyClerkToken } from '../auth';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

import * as clerkBackend from '@clerk/backend';

describe('verifyClerkToken', () => {
  const originalEnv = process.env.CLERK_SECRET_KEY;

  beforeEach(() => {
    process.env.CLERK_SECRET_KEY = 'test-secret-key';
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.CLERK_SECRET_KEY = originalEnv;
    } else {
      delete process.env.CLERK_SECRET_KEY;
    }
  });

  it('should return error when token is missing', async () => {
    const result = await verifyClerkToken('');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Missing authentication token');
  });

  it('should return error when CLERK_SECRET_KEY is not set', async () => {
    delete process.env.CLERK_SECRET_KEY;
    const result = await verifyClerkToken('some-token');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Server misconfiguration: CLERK_SECRET_KEY not set');
  });

  it('should return error when token is invalid', async () => {
    const mockVerifyToken = vi.mocked(clerkBackend.verifyToken);
    mockVerifyToken.mockRejectedValueOnce(new Error('Invalid token'));

    const result = await verifyClerkToken('invalid-token');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid or expired token');
  });

  it('should return error when decoded token has no userId', async () => {
    const mockVerifyToken = vi.mocked(clerkBackend.verifyToken);
    mockVerifyToken.mockResolvedValueOnce({ sub: undefined } as any);

    const result = await verifyClerkToken('token-without-userid');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid token: missing user ID');
  });

  it('should return userId for valid token', async () => {
    const mockVerifyToken = vi.mocked(clerkBackend.verifyToken);
    const testUserId = 'user_12345abcde';
    mockVerifyToken.mockResolvedValueOnce({ sub: testUserId } as any);

    const result = await verifyClerkToken('valid-token');
    expect(result.success).toBe(true);
    expect(result.userId).toBe(testUserId);
    expect(result.error).toBeUndefined();
  });
});
