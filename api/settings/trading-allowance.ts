import { withAuth, type AuthDeps } from '../_lib/auth.js';
import {
  databaseTradingAllowanceStore,
  taxYearQuerySchema,
  tradingAllowanceChoiceSchema,
  type TradingAllowanceStore,
} from '../_lib/tradingAllowance.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export function createTradingAllowanceHandler(store: TradingAllowanceStore = databaseTradingAllowanceStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET' && request.method !== 'PUT') return refuse(405, 'Method not allowed', 'METHOD');

    if (request.method === 'PUT') {
      const parsed = tradingAllowanceChoiceSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? 'Invalid choice', 'BAD_REQUEST');
      const method = await store.set(auth.userId, parsed.data.taxYear, parsed.data.method);
      return Response.json({ ok: true, method });
    }

    const parsed = taxYearQuerySchema.safeParse({ taxYear: new URL(request.url).searchParams.get('taxYear') });
    if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? 'Invalid tax year', 'BAD_REQUEST');
    const method = (await store.get(auth.userId, parsed.data.taxYear)) ?? 'actual';
    return Response.json({ ok: true, method });
  }, authDeps);
}

export default { fetch: createTradingAllowanceHandler() };
