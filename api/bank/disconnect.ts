import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { databaseBankStore, type BankStore } from '../_lib/bankStore.js';

export function createDisconnectHandler(store: BankStore = databaseBankStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD' }, { status: 405 });
    await store.disconnect(auth.userId);
    return Response.json({ ok: true });
  }, authDeps);
}

export default { fetch: createDisconnectHandler() };
