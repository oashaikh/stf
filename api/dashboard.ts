import { withAuth, type AuthDeps } from './_lib/auth.js';
import { databaseDashboardStore, getDashboardSummary, type DashboardStore } from './_lib/dashboard.js';

export function createDashboardHandler(store: DashboardStore = databaseDashboardStore, authDeps?: AuthDeps, now: () => Date = () => new Date()) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    return Response.json({ ok: true, data: await getDashboardSummary(store, auth.userId, now()) });
  }, authDeps);
}

export default { fetch: createDashboardHandler() };
