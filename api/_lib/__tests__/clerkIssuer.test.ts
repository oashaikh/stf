import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyToken = vi.hoisted(() => vi.fn());
vi.mock('@clerk/backend', () => ({ verifyToken, createClerkClient: vi.fn() }));

import { clerkIssuer } from '../clerkIssuer';

describe('clerkIssuer.verifyToken authorized parties', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    verifyToken.mockReset();
  });

  it('fails closed in production when CLERK_AUTHORIZED_PARTIES is unset', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_fake');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', '');
    await expect(clerkIssuer.verifyToken('token')).rejects.toThrow('CLERK_AUTHORIZED_PARTIES');
    expect(verifyToken).not.toHaveBeenCalled();
  });

  it('passes trimmed, non-empty parties to Clerk', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_fake');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', ' https://a.example , ,https://b.example');
    verifyToken.mockResolvedValue({ sub: 'user_1' });
    await expect(clerkIssuer.verifyToken('token')).resolves.toBe('user_1');
    expect(verifyToken).toHaveBeenCalledWith('token', {
      secretKey: 'sk_test_fake',
      authorizedParties: ['https://a.example', 'https://b.example'],
    });
  });

  it('skips the azp check outside production when unset', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_fake');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CLERK_AUTHORIZED_PARTIES', '');
    verifyToken.mockResolvedValue({ sub: 'user_1' });
    await clerkIssuer.verifyToken('token');
    expect(verifyToken).toHaveBeenCalledWith('token', { secretKey: 'sk_test_fake', authorizedParties: undefined });
  });
});
