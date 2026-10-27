import { withAuth, type AuthDeps } from './_lib/auth.js';
import { getTaxEstimate, parseEstimateTaxYear } from './_lib/taxEstimate.js';
import { databaseTaxYearSummaryStore, type TaxYearSummaryStore } from './_lib/taxYearSummary.js';

export function createTaxEstimateHandler(store: TaxYearSummaryStore = databaseTaxYearSummaryStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const taxYear = parseEstimateTaxYear(new URL(request.url).searchParams);
    if (!taxYear) return Response.json({ ok: false, error: 'Give a supported taxYear as YYYY-YY, for example 2026-27', code: 'INVALID_TAX_YEAR' }, { status: 400 });
    return Response.json({ ok: true, data: await getTaxEstimate(store, auth.userId, taxYear) });
  }, authDeps);
}

export default { fetch: createTaxEstimateHandler() };
