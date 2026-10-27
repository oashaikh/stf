import { withAuth, type AuthDeps } from './_lib/auth.js';
import { databaseProfitAndLossStore, getProfitAndLoss, parseProfitAndLossPeriod, type ProfitAndLossStore } from './_lib/profitAndLoss.js';

export function createProfitAndLossHandler(
  store: ProfitAndLossStore = databaseProfitAndLossStore,
  authDeps?: AuthDeps,
  now: () => Date = () => new Date(),
) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const period = parseProfitAndLossPeriod(new URL(request.url).searchParams, now());
    if (typeof period === 'string') return Response.json({ ok: false, error: period, code: 'INVALID_PERIOD' }, { status: 400 });
    return Response.json({ ok: true, data: await getProfitAndLoss(store, auth.userId, period) });
  }, authDeps);
}

export default { fetch: createProfitAndLossHandler() };
