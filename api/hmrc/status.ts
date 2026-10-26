import { withAuth, type AuthDeps } from '../_lib/auth';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore';

export function createStatusHandler(store: HmrcStore = databaseHmrcStore, authDeps?: AuthDeps) {
  return withAuth(async (_request, auth) => {
    const { connected, expiresAt } = await store.status(auth.userId);
    return Response.json({ ok: true, connected, expiresAt });
  }, authDeps);
}

export default { fetch: createStatusHandler() };
