import { clearedSessionCookie } from '../_lib/ownerSession.js';

export async function handleLogout(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD' }, { status: 405 });
  }
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie() } });
}

export default { fetch: handleLogout };
