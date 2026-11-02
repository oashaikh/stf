import { decryptToken } from '../../server/src/lib/hmrcCrypto.js';
import {
  getAdjustableSummary,
  getTaxLiabilityAdjustments,
  refreshAccessToken,
  triggerAdjustableSummary,
  type AdjustableSummary,
  type TaxLiabilityAdjustment,
} from '../../src/lib/hmrc/client.js';
import { TAX_BANDS } from '../../src/lib/taxBands.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { callHmrcAsUser, type HmrcCallDeps } from '../_lib/hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';
import { databaseTaxIdentifiersStore, type TaxIdentifiersStore } from '../_lib/taxIdentifiers.js';

// Read only: shows what HMRC holds for the year's self-employment summary and tax adjustments.
// Rate limiting: see the ponytail note in submit.ts (SEC-14).
export function createItsAdjustmentsHandler(
  store: HmrcStore = databaseHmrcStore,
  identifiers: TaxIdentifiersStore = databaseTaxIdentifiersStore,
  authDeps?: AuthDeps,
  { fetchFn, refresh = refreshAccessToken, now }: HmrcCallDeps & { fetchFn?: typeof fetch } = {},
) {
  return withAuth(async (request, auth) => {
    const fail = (status: number, code: string, error: string) => Response.json({ ok: false, error, code }, { status });
    if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

    const taxYear = new URL(request.url).searchParams.get('taxYear') ?? '';
    const period = taxYear in TAX_BANDS ? taxYearPeriod(taxYear) : null;
    if (!period) return fail(400, 'BAD_REQUEST', 'taxYear is required');

    // Live needs both switches: the deployment env and the user's own opt-in.
    const userSandbox = await store.sandboxMode(auth.userId);
    const envSandbox = process.env.HMRC_SANDBOX_MODE !== 'false';
    if (userSandbox === undefined || userSandbox !== envSandbox) return fail(403, 'LIVE_MODE_REFUSED', 'HMRC mode not allowed');

    const credentials = await store.credentials(auth.userId);
    if (!credentials) return fail(409, 'HMRC_NOT_CONNECTED', 'HMRC is not connected');
    const { itsBusinessId, needsItsReconnect } = await store.status(auth.userId);
    if (needsItsReconnect) return fail(409, 'ITS_SCOPE_MISSING', 'Reconnect HMRC to grant Income Tax access');
    if (!itsBusinessId) return fail(409, 'NO_BUSINESS', 'Choose your business first');

    const stored = await identifiers.get(auth.userId);
    if (!stored?.ninoEncrypted) return fail(409, 'NO_NINO', 'Add your National Insurance number first');
    const nino = decryptToken(stored.ninoEncrypted);

    return callHmrcAsUser(
      {
        request,
        userId: auth.userId,
        credentials,
        store,
        label: 'adjustments',
        call: async (accessToken, fraudHeaders) => {
          const { calculationId } = await triggerAdjustableSummary(
            nino,
            { businessId: itsBusinessId, startDate: period.start, endDate: period.end },
            accessToken, fraudHeaders, fetchFn,
          );
          const summary: AdjustableSummary = await getAdjustableSummary(nino, calculationId, accessToken, fraudHeaders, fetchFn);
          const adjustments: TaxLiabilityAdjustment[] = await getTaxLiabilityAdjustments(nino, taxYear, accessToken, fraudHeaders, fetchFn);
          return Response.json({ ok: true, summary, adjustments });
        },
      },
      { refresh, now },
    );
  }, authDeps);
}

export default { fetch: createItsAdjustmentsHandler() };
