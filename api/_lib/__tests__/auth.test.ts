import { describe, expect, it, vi } from 'vitest';
import { requireAuth, UnauthorizedError, withAuth, type AuthDeps } from '../auth';

function makeDeps(verified: string | null = 'user_abc'): AuthDeps {
  const rows = new Map<string, string>();
  return {
    issuer: {
      verifyToken: vi.fn(async () => verified),
      getEmail: vi.fn(async () => 'a@example.com'),
    },
    users: {
      findId: vi.fn(async (issuerUserId: string) => rows.get(issuerUserId)),
      createIfAbsent: vi.fn(async (issuerUserId: string) => {
        if (!rows.has(issuerUserId)) rows.set(issuerUserId, `internal-${rows.size + 1}`);
        return rows.get(issuerUserId) as string;
      }),
    },
  };
}

const withBearer = (token?: string) =>
  new Request('https://x.test/api/me', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe('requireAuth', () => {
  it('rejects a request with no token without touching the issuer or database', async () => {
    const deps = makeDeps();
    await expect(requireAuth(withBearer(), deps)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.issuer.verifyToken).not.toHaveBeenCalled();
    expect(deps.users.findId).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired token and creates no user', async () => {
    const deps = makeDeps(null);
    await expect(requireAuth(withBearer('bad'), deps)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.users.createIfAbsent).not.toHaveBeenCalled();
  });

  it('provisions a user on first sign-in and reuses it afterwards', async () => {
    const deps = makeDeps();
    const first = await requireAuth(withBearer('good'), deps);
    const second = await requireAuth(withBearer('good'), deps);
    expect(first).toEqual({ userId: 'internal-1', issuerUserId: 'user_abc' });
    expect(second.userId).toBe(first.userId);
    expect(deps.users.createIfAbsent).toHaveBeenCalledTimes(1);
  });
});

describe('withAuth', () => {
  it('returns a 401 envelope and skips the handler when unauthenticated', async () => {
    const handler = vi.fn();
    const response = await withAuth(handler, makeDeps())(withBearer());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes the server-derived identity to the handler', async () => {
    const handler = vi.fn(async () => new Response('ok'));
    await withAuth(handler, makeDeps())(withBearer('good'));
    expect(handler).toHaveBeenCalledWith(expect.any(Request), {
      userId: 'internal-1',
      issuerUserId: 'user_abc',
    });
  });

  it('returns a generic 500 envelope when something other than auth fails', async () => {
    const deps = makeDeps();
    deps.issuer.verifyToken = vi.fn(async () => {
      throw new Error('CLERK_SECRET_KEY secret-value missing');
    });
    const response = await withAuth(vi.fn(), deps)(withBearer('good'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret-value');
  });
});
