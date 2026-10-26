import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export function createModeHandler(store: HmrcStore = databaseHmrcStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (typeof body?.live !== 'boolean') return refuse(400, 'live must be a boolean', 'BAD_REQUEST');
      await store.setSandboxMode(auth.userId, !body.live);
    } else if (request.method !== 'GET') {
      return refuse(405, 'Method not allowed', 'METHOD');
    }

    const userSandbox = await store.sandboxMode(auth.userId);
    if (userSandbox === undefined) return refuse(404, 'User not found', 'NOT_FOUND');
    return Response.json({ ok: true, live: !userSandbox, envLive: process.env.HMRC_SANDBOX_MODE === 'false' });
  }, authDeps);
}

export default { fetch: createModeHandler() };
