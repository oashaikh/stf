import { signState } from '../../server/src/lib/hmrcCrypto.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import type { BankFeedProvider } from '../_lib/bankFeed.js';
import { createTrueLayerProvider, trueLayerConfigFromEnv } from '../_lib/truelayerProvider.js';

export const defaultProvider = (): BankFeedProvider => createTrueLayerProvider(trueLayerConfigFromEnv());

export function createConnectHandler(getProvider: () => BankFeedProvider = defaultProvider, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD' }, { status: 405 });
    return Response.json({ ok: true, url: getProvider().startConsent(signState(auth.userId)) });
  }, authDeps);
}

export default { fetch: createConnectHandler() };
