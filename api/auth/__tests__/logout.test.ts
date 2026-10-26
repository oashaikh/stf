import { describe, expect, it } from 'vitest';
import { handleLogout } from '../logout';

describe('POST /api/auth/logout', () => {
  it('clears the session cookie with the same attributes', async () => {
    const response = await handleLogout(new Request('https://x.test/api/auth/logout', { method: 'POST' }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie') as string;
    expect(cookie).toMatch(/^stf_session=;/);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('rejects non-POST methods with 405 and no cookie change', async () => {
    const response = await handleLogout(new Request('https://x.test/api/auth/logout'));
    expect(response.status).toBe(405);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
