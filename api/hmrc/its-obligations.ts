import { decryptToken } from '../../server/src/lib/hmrcCrypto.js';
import {
  getItsFinalDeclarationObligations,
  getItsIncomeAndExpenditureObligations,
  refreshAccessToken,
  type ItsFinalDeclarationObligations,
  type ItsIncomeAndExpenditureObligations,
} from '../../src/lib/hmrc/client.js';
import { currentTaxYear } from '../../src/lib/taxBands.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { callHmrcAsUser, type HmrcCallDeps } from '../_lib/hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';
import { markItsObligations, normaliseItsObligations, previousTaxYear, type ItsObligation } from '../_lib/itsObligations.js';
import { databaseTaxIdentifiersStore, type TaxIdentifiersStore } from '../_lib/taxIdentifiers.js';

const HMRC_FAILED_MESSAGE = 'HMRC could not be reached just now, so these dates may be out of date.';

// Rate limiting: see the ponytail note in submit.ts (SEC-14).
export function createItsObligationsHandler(
  store: HmrcStore = databaseHmrcStore,
  identifiers: TaxIdentifiersStore = databaseTaxIdentifiersStore,
  authDeps?: AuthDeps,
  { fetchFn, refresh = refreshAccessToken, now = () => new Date() }: HmrcCallDeps & { fetchFn?: typeof fetch } = {},
) {
  return withAuth(async (request, auth) => {
    const fail = (status: number, code: string, error: string) => Response.json({ ok: false, error, code }, { status });
    if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

    // Off by default: nothing below runs, so no HMRC call and no database read.
    if (process.env.HMRC_ITSA_ENABLED !== 'true') return fail(404, 'ITSA_DISABLED', 'Income Tax is off');

    // Live needs both switches: the deployment env and the user's own opt-in.
    const userSandbox = await store.sandboxMode(auth.userId);
    const envSandbox = process.env.HMRC_SANDBOX_MODE !== 'false';
    if (userSandbox === undefined || userSandbox !== envSandbox) return fail(403, 'LIVE_MODE_REFUSED', 'HMRC mode not allowed');

    const credentials = await store.credentials(auth.userId);
    if (!credentials) return fail(409, 'HMRC_NOT_CONNECTED', 'HMRC is not connected');
    const { itsBusinessId, needsItsReconnect } = await store.status(auth.userId);
    if (needsItsReconnect) return fail(409, 'ITS_SCOPE_MISSING', 'Reconnect HMRC to grant Income Tax access');
    if (!itsBusinessId) return fail(409, 'NO_BUSINESS_SELECTED', 'Choose your self-employment business first');

    const stored = await identifiers.get(auth.userId);
    if (!stored?.ninoEncrypted) return fail(409, 'NO_NINO', 'Add your National Insurance number first');
    const nino = decryptToken(stored.ninoEncrypted);

    const today = now();
    const todayDate = today.toISOString().slice(0, 10);
    const thisYear = currentTaxYear(today);
    const taxYears = [previousTaxYear(thisYear), thisYear];

    // No transaction is open here: the HMRC calls finish before any write (COD-4). One callHmrcAsUser
    // wraps all four so a token refresh happens once and the rotated token serves the rest.
    // A network failure or an unreadable body falls back to the stored dates, like an HMRC error does.
    let perYear: { taxYear: string; items: ItsObligation[] }[] | undefined;
    try {
      const hmrcResponse = await callHmrcAsUser(
        {
          request,
          userId: auth.userId,
          credentials,
          store,
          label: 'income tax obligations',
          call: async (accessToken, fraudHeaders) => {
            const years: { taxYear: string; quarterly: ItsIncomeAndExpenditureObligations; finalDeclaration: ItsFinalDeclarationObligations }[] = [];
            for (const taxYear of taxYears) {
              const period = taxYearPeriod(taxYear)!;
              years.push({
                taxYear,
                quarterly: await getItsIncomeAndExpenditureObligations(nino, itsBusinessId, period.start, period.end, accessToken, fraudHeaders, fetchFn),
                finalDeclaration: await getItsFinalDeclarationObligations(nino, period.start, period.end, accessToken, fraudHeaders, fetchFn),
              });
            }
            return Response.json(years);
          },
        },
        { refresh, now },
      );
      if (hmrcResponse.ok) {
        const years = (await hmrcResponse.json()) as { taxYear: string; quarterly: ItsIncomeAndExpenditureObligations; finalDeclaration: ItsFinalDeclarationObligations }[];
        perYear = years.map(({ taxYear, quarterly, finalDeclaration }) => ({ taxYear, items: normaliseItsObligations(taxYear, quarterly, finalDeclaration) }));
      }
    } catch {
      // The error text can echo tokens or the NINO, so log a fixed message only.
      console.error('HMRC income tax obligations could not be fetched');
    }

    if (perYear) {
      const fresh = perYear;
      // A failed save must not hide fresh data from the user; the next fetch writes it again.
      try {
        await Promise.all(fresh.map(({ taxYear, items }) => store.saveItsObligations(auth.userId, taxYear, items, today)));
      } catch {
        console.error('Income tax obligations could not be stored');
      }
      return Response.json({ ok: true, stale: false, ...markItsObligations(fresh.flatMap(({ items }) => items), todayDate) });
    }

    const cached = await store.lastItsObligations(auth.userId, taxYears);
    if (cached.length === 0) return fail(502, 'HMRC_FAILED', HMRC_FAILED_MESSAGE);
    const fetchedAt = new Date(Math.min(...cached.map((entry) => entry.fetchedAt.getTime()))).toISOString();
    const items = cached.flatMap((entry) => entry.payload as ItsObligation[]);
    return Response.json({ ok: true, stale: true, fetchedAt, error: HMRC_FAILED_MESSAGE, ...markItsObligations(items, todayDate) });
  }, authDeps);
}

export default { fetch: createItsObligationsHandler() };
