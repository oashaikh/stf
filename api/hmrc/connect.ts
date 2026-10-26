import { signState } from '../../server/src/lib/hmrcCrypto.js';
import { buildHmrcAuthUrl } from '../../src/lib/hmrc/client';
import { withAuth, type AuthDeps } from '../_lib/auth';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore';

export function createConnectHandler(store: HmrcStore = databaseHmrcStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD' }, { status: 405 });

    // Live needs both switches: the deployment env and the user's own opt-in.
    const userSandbox = await store.sandboxMode(auth.userId);
    const envSandbox = process.env.HMRC_SANDBOX_MODE !== 'false';
    if (userSandbox === undefined || userSandbox !== envSandbox) {
      return Response.json({ ok: false, error: 'HMRC mode not allowed', code: 'LIVE_MODE_REFUSED' }, { status: 403 });
    }

    const redirectUri = process.env.HMRC_REDIRECT_URI;
    if (!redirectUri) throw new Error('HMRC_REDIRECT_URI is not set');
    return Response.json({ ok: true, url: buildHmrcAuthUrl(redirectUri, signState(auth.userId)) });
  }, authDeps);
}

export default { fetch: createConnectHandler() };
