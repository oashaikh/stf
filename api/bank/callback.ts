import { verifiedStateUserId } from '../../server/src/lib/hmrcCrypto.js';
import type { BankFeedProvider } from '../_lib/bankFeed.js';
import { databaseBankStore, type BankStore } from '../_lib/bankStore.js';
import { defaultProvider } from './connect.js';

interface CallbackDeps {
  store: BankStore;
  getProvider: () => BankFeedProvider;
}

// Provider codes are short; the cap stops a crafted link from posting a huge value to the token endpoint.
const MAX_AUTH_CODE_LENGTH = 256;
// Open banking consent lasts 90 days before the owner must reconnect.
const CONSENT_DAYS = 90;

const defaultDeps: CallbackDeps = { store: databaseBankStore, getProvider: defaultProvider };

function bankRedirect(outcome: 'connected' | 'error'): Response {
  return Response.redirect(`${process.env.APP_ORIGIN}/bank?bank=${outcome}`, 302);
}

// Public route: the bank redirects the browser here without a bearer header, so the signed state is the credential.
export function createCallbackHandler(deps: CallbackDeps = defaultDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD' }, { status: 405 });

    const params = new URL(request.url).searchParams;
    const state = params.get('state');
    const userId = state ? verifiedStateUserId(state) : null;
    if (!userId) return Response.json({ ok: false, error: 'Invalid state', code: 'INVALID_STATE' }, { status: 400 });

    const code = params.get('code');
    if (!code || code.length > MAX_AUTH_CODE_LENGTH || params.get('error')) return bankRedirect('error');

    try {
      const provider = deps.getProvider();
      // The provider calls finish before the single-statement write, so no transaction is held open across them.
      const tokens = await provider.finishConsent(code);
      const [account] = await provider.listAccounts(tokens.accessToken);
      if (!account) return bankRedirect('error');
      await deps.store.save(userId, {
        providerAccountId: account.id,
        displayName: account.name,
        maskedAccountNumber: account.maskedNumber ?? null,
        consentExpiresAt: new Date(Date.now() + CONSENT_DAYS * 24 * 60 * 60 * 1000),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
      });
      return bankRedirect('connected');
    } catch (error) {
      // Class name only: messages can carry codes or tokens.
      console.error('Bank callback failed', error instanceof Error ? error.name : 'unknown');
      return bankRedirect('error');
    }
  };
}

export default { fetch: createCallbackHandler() };
