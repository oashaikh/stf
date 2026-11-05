import { signState } from '../../server/src/lib/hmrcCrypto.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import type { BankFeedProvider } from '../_lib/bankFeed.js';
import { createTrueLayerProvider, trueLayerConfigFromEnv } from '../_lib/truelayerProvider.js';

export const defaultProvider = (): BankFeedProvider => createTrueLayerProvider(trueLayerConfigFromEnv());

export function createConnectHandler(getProvider: () => BankFeedProvider = defaultProvider, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD' }, { status: 405 });
    try {
      return Response.json({ ok: true, url: getProvider().startConsent(signState(auth.userId)) });
    } catch (error) {
      // The message names no value; a deployment without TrueLayer or state-signing settings is "not set up yet", not a server fault.
      console.error('Bank connect config error:', error instanceof Error ? error.message : 'unknown');
      return Response.json({ ok: false, error: 'Bank connection is not set up yet', code: 'BANK_NOT_CONFIGURED' }, { status: 409 });
    }
  }, authDeps);
}

export default { fetch: createConnectHandler() };
