import { z } from 'zod';

import { decryptToken } from '../../server/src/lib/hmrcCrypto.js';
import { listItsSelfEmploymentBusinesses, refreshAccessToken, type ItsBusiness } from '../../src/lib/hmrc/client.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { callHmrcAsUser, type HmrcCallDeps } from '../_lib/hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';
import { databaseTaxIdentifiersStore, type TaxIdentifiersStore } from '../_lib/taxIdentifiers.js';

const chooseBusinessSchema = z.object({ businessId: z.string().min(1).max(40) });

// Rate limiting: see the ponytail note in submit.ts (SEC-14).
export function createItsBusinessesHandler(
  store: HmrcStore = databaseHmrcStore,
  identifiers: TaxIdentifiersStore = databaseTaxIdentifiersStore,
  authDeps?: AuthDeps,
  { fetchFn, refresh = refreshAccessToken, now }: HmrcCallDeps & { fetchFn?: typeof fetch } = {},
) {
  return withAuth(async (request, auth) => {
    const fail = (status: number, code: string, error: string) => Response.json({ ok: false, error, code }, { status });
    if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

    // Live needs both switches: the deployment env and the user's own opt-in.
    const userSandbox = await store.sandboxMode(auth.userId);
    const envSandbox = process.env.HMRC_SANDBOX_MODE !== 'false';
    if (userSandbox === undefined || userSandbox !== envSandbox) return fail(403, 'LIVE_MODE_REFUSED', 'HMRC mode not allowed');

    let chosenId: string | undefined;
    if (request.method === 'POST') {
      const parsed = chooseBusinessSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return fail(400, 'BAD_REQUEST', 'businessId is required');
      chosenId = parsed.data.businessId;
    }

    const credentials = await store.credentials(auth.userId);
    if (!credentials) return fail(409, 'HMRC_NOT_CONNECTED', 'HMRC is not connected');
    const { itsBusinessId, needsItsReconnect } = await store.status(auth.userId);
    if (needsItsReconnect) return fail(409, 'ITS_SCOPE_MISSING', 'Reconnect HMRC to grant Income Tax access');

    const stored = await identifiers.get(auth.userId);
    if (!stored?.ninoEncrypted) return fail(409, 'NO_NINO', 'Add your National Insurance number first');
    const nino = decryptToken(stored.ninoEncrypted);

    // No transaction is open here: the HMRC call finishes before any write (COD-4).
    const hmrcResponse = await callHmrcAsUser(
      {
        request,
        userId: auth.userId,
        credentials,
        store,
        label: 'list businesses',
        call: async (accessToken, fraudHeaders) =>
          Response.json(await listItsSelfEmploymentBusinesses(nino, accessToken, fraudHeaders, fetchFn)),
      },
      { refresh, now },
    );
    if (!hmrcResponse.ok) return hmrcResponse;

    const { businessDetails } = (await hmrcResponse.json()) as { businessDetails: ItsBusiness[] };
    const businesses = businessDetails
      .filter((business) => business.typeOfBusiness === 'self-employment')
      .map(({ businessId, tradingName }) => ({ businessId, tradingName: tradingName ?? null }));

    // The id must come from HMRC's own list, so a client cannot store an arbitrary one.
    let selectedBusinessId = itsBusinessId;
    if (chosenId !== undefined) {
      if (!businesses.some((business) => business.businessId === chosenId)) return fail(400, 'UNKNOWN_BUSINESS', 'Not one of your HMRC businesses');
      selectedBusinessId = chosenId;
    } else if (businesses.length === 1) {
      selectedBusinessId = businesses[0].businessId;
    }
    if (selectedBusinessId !== itsBusinessId && selectedBusinessId !== null) await store.setItsBusinessId(auth.userId, selectedBusinessId);

    return Response.json({ ok: true, businesses, selectedBusinessId });
  }, authDeps);
}

export default { fetch: createItsBusinessesHandler() };
