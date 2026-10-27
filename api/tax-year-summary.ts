import { withAuth, type AuthDeps } from './_lib/auth.js';
import { databaseTaxYearSummaryStore, getTaxYearSummary, parseTaxYearPeriod, type TaxYearSummaryStore } from './_lib/taxYearSummary.js';

export function createTaxYearSummaryHandler(store: TaxYearSummaryStore = databaseTaxYearSummaryStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const period = parseTaxYearPeriod(new URL(request.url).searchParams);
    if (!period) return Response.json({ ok: false, error: 'Give taxYear as YYYY-YY, for example 2026-27', code: 'INVALID_TAX_YEAR' }, { status: 400 });
    return Response.json({ ok: true, data: await getTaxYearSummary(store, auth.userId, period) });
  }, authDeps);
}

export default { fetch: createTaxYearSummaryHandler() };
