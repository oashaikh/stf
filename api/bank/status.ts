import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { databaseBankStore, type BankStore } from '../_lib/bankStore.js';

export function createStatusHandler(store: BankStore = databaseBankStore, authDeps?: AuthDeps) {
  return withAuth(async (_request, auth) => {
    const { connected, displayName, maskedAccountNumber, consentExpiresAt, expired } = await store.status(auth.userId);
    return Response.json({ ok: true, connected, displayName, maskedAccountNumber, consentExpiresAt, expired });
  }, authDeps);
}

export default { fetch: createStatusHandler() };
