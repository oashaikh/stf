import { encryptToken, verifiedStateUserId } from '../../server/src/lib/hmrcCrypto.js';
import { exchangeAuthCode, type HmrcTokenSet } from '../../src/lib/hmrc/client.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';

interface CallbackDeps {
  store: HmrcStore;
  exchange: (code: string, redirectUri: string) => Promise<HmrcTokenSet>;
}

const defaultDeps: CallbackDeps = { store: databaseHmrcStore, exchange: (code, redirectUri) => exchangeAuthCode(code, redirectUri) };

function settingsRedirect(outcome: 'connected' | 'error'): Response {
  return Response.redirect(`${process.env.APP_ORIGIN}/settings?hmrc=${outcome}`, 302);
}

// Public route: HMRC redirects the browser here without a bearer header, so the signed state is the credential.
export function createCallbackHandler(deps: CallbackDeps = defaultDeps) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD' }, { status: 405 });

    const params = new URL(request.url).searchParams;
    const state = params.get('state');
    const userId = state ? verifiedStateUserId(state) : null;
    if (!userId) return Response.json({ ok: false, error: 'Invalid state', code: 'INVALID_STATE' }, { status: 400 });

    const code = params.get('code');
    if (!code || params.get('error')) return settingsRedirect('error');

    try {
      const redirectUri = process.env.HMRC_REDIRECT_URI;
      if (!redirectUri) throw new Error('HMRC_REDIRECT_URI is not set');
      // The HMRC call finishes before the single-statement write, so no transaction is held open across it.
      const tokens = await deps.exchange(code, redirectUri);
      await deps.store.saveTokens(userId, {
        accessToken: encryptToken(tokens.accessToken),
        refreshToken: encryptToken(tokens.refreshToken),
        expiresAt: new Date(tokens.expiresAt),
        scope: tokens.scope,
      });
      return settingsRedirect('connected');
    } catch (error) {
      // Class name only: messages can carry codes or tokens.
      console.error('HMRC callback failed', error instanceof Error ? error.name : 'unknown');
      return settingsRedirect('error');
    }
  };
}

export default { fetch: createCallbackHandler() };
