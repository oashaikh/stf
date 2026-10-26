import { describe, expect, it, vi } from 'vitest';
import { createSessionToken, verifySessionToken } from '../ownerSession';
import { ownerIssuer, requireAuth, UnauthorizedError, withAuth, type AuthDeps } from '../auth';

const SESSION_ENV = { SESSION_SECRET: 'a-test-session-secret-of-32-chars-or-more' };

function makeDeps(): AuthDeps {
  const rows = new Map<string, string>();
  return {
    issuer: {
      verifyToken: vi.fn(async (token: string) => verifySessionToken(token, new Date(), SESSION_ENV as NodeJS.ProcessEnv)),
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

const validToken = (now = new Date()) => createSessionToken(now, SESSION_ENV as NodeJS.ProcessEnv);

const withCookie = (token?: string) =>
  new Request('https://x.test/api/me', {
    headers: token ? { cookie: `stf_session=${token}` } : {},
  });

describe('requireAuth', () => {
  it('rejects a request with no token without touching the issuer or database', async () => {
    const deps = makeDeps();
    await expect(requireAuth(withCookie(), deps)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(deps.issuer.verifyToken).not.toHaveBeenCalled();
    expect(deps.users.findId).not.toHaveBeenCalled();
  });

  it('rejects tampered, expired and wrong-secret cookies and creates no user', async () => {
    const good = validToken();
    const expired = validToken(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000));
    const wrongSecret = createSessionToken(new Date(), { SESSION_SECRET: 'b'.repeat(40) } as NodeJS.ProcessEnv);
    const [payload, signature] = good.split('.');
    const tampered = `${Number(payload) + 1000}.${signature}`;
    for (const bad of ['bad', expired, wrongSecret, tampered]) {
      const deps = makeDeps();
      await expect(requireAuth(withCookie(bad), deps)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(deps.users.createIfAbsent).not.toHaveBeenCalled();
    }
  });

  it('resolves every valid session to the one owner row, created once', async () => {
    const deps = makeDeps();
    const first = await requireAuth(withCookie(validToken()), deps);
    const second = await requireAuth(withCookie(validToken()), deps);
    expect(first).toEqual({ userId: 'internal-1', issuerUserId: 'owner' });
    expect(second.userId).toBe(first.userId);
    expect(deps.users.createIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('owner issuer maps a valid token to the fixed id and a placeholder email', async () => {
    vi.stubEnv('SESSION_SECRET', SESSION_ENV.SESSION_SECRET);
    expect(await ownerIssuer.verifyToken(validToken())).toBe('owner');
    expect(await ownerIssuer.verifyToken('bad')).toBeNull();
    expect(await ownerIssuer.getEmail('owner')).toBe('owner@stf.invalid');
    vi.unstubAllEnvs();
  });
});

describe('withAuth', () => {
  it('returns a 401 envelope and skips the handler for a missing or tampered cookie', async () => {
    for (const token of [undefined, 'bad', `${validToken()}x`]) {
      const handler = vi.fn();
      const response = await withAuth(handler, makeDeps())(withCookie(token));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it('passes the server-derived identity to the handler', async () => {
    const handler = vi.fn(async () => new Response('ok'));
    await withAuth(handler, makeDeps())(withCookie(validToken()));
    expect(handler).toHaveBeenCalledWith(expect.any(Request), {
      userId: 'internal-1',
      issuerUserId: 'owner',
    });
  });

  it('returns a generic 500 envelope when something other than auth fails', async () => {
    const deps = makeDeps();
    deps.issuer.verifyToken = vi.fn(async () => {
      throw new Error('SESSION_SECRET secret-value missing');
    });
    const response = await withAuth(vi.fn(), deps)(withCookie(validToken()));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('secret-value');
  });
});
