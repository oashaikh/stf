import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';

export function createStatusHandler(store: HmrcStore = databaseHmrcStore, authDeps?: AuthDeps) {
  return withAuth(async (_request, auth) => {
    const { connected, expiresAt, itsBusinessId, needsItsReconnect } = await store.status(auth.userId);
    // Income Tax stays hidden until the operator turns the flag on (the HMRC app may not hold the scopes yet).
    const itsEnabled = process.env.HMRC_ITSA_ENABLED === 'true';
    return Response.json({ ok: true, connected, expiresAt, itsBusinessId, needsItsReconnect: itsEnabled && needsItsReconnect, itsEnabled });
  }, authDeps);
}

export default { fetch: createStatusHandler() };
