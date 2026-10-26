import {
  AccountRuleError,
  archiveAccount,
  assertNoRetype,
  createAccount,
  databaseAccountStore,
  DuplicateAccountCodeError,
  listAccounts,
  renameAccount,
  unarchiveAccount,
  validateAccountName,
  validateNewAccount,
  type AccountStore,
} from './_lib/accounts.js';
import { withAuth, type AuthDeps } from './_lib/auth.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAccountsHandler(store: AccountStore = databaseAccountStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method === 'GET') {
      const archived = new URL(request.url).searchParams.get('archived') === 'true';
      return Response.json({ ok: true, accounts: await listAccounts(store, auth.userId, archived) });
    }

    if (request.method === 'POST') {
      const newAccount = validateNewAccount(await request.json().catch(() => null));
      if (!newAccount) return refuse(400, 'Account needs a code, name and valid type', 'BAD_REQUEST');
      try {
        return Response.json({ ok: true, account: await createAccount(store, auth.userId, newAccount) });
      } catch (error) {
        if (error instanceof DuplicateAccountCodeError) return refuse(409, error.message, 'DUPLICATE_CODE');
        throw error;
      }
    }

    if (request.method === 'PATCH') {
      const body = await request.json().catch(() => null);
      if (typeof body?.id !== 'string' || !UUID.test(body.id)) return refuse(400, 'Account id must be a uuid', 'BAD_REQUEST');
      const name = body.name === undefined ? undefined : validateAccountName(body.name);
      if (name === null) return refuse(400, 'Name must be 1 to 100 characters', 'BAD_REQUEST');
      if (typeof body.archived !== 'boolean' && name === undefined) return refuse(400, 'Send a name or archived: true or false', 'BAD_REQUEST');

      const existing = await store.get(auth.userId, body.id);
      if (!existing) return refuse(404, 'Account not found', 'NOT_FOUND');
      try {
        assertNoRetype(existing, body.accountType);
        const account =
          body.archived === true
            ? await archiveAccount(store, auth.userId, body.id)
            : body.archived === false
              ? await unarchiveAccount(store, auth.userId, body.id)
              : await renameAccount(store, auth.userId, body.id, name as string);
        if (!account) return refuse(404, 'Account not found', 'NOT_FOUND');
        return Response.json({ ok: true, account });
      } catch (error) {
        if (error instanceof AccountRuleError) return refuse(403, error.message, 'SYSTEM_ACCOUNT');
        throw error;
      }
    }

    return refuse(405, 'Method not allowed', 'METHOD');
  }, authDeps);
}

export default { fetch: createAccountsHandler() };
