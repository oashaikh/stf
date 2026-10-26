import { withAuth } from '../_lib/auth.js';
import {
  databaseStore,
  getReturnReview,
  periodFromQuery,
  periodSchema,
  saveBodySchema,
  saveReturnDraft,
  VatReturnError,
  vatErrorResponse,
  type VatReturnStore,
} from '../_lib/vatReturns.js';

export function vatReturnHandler(store: VatReturnStore) {
  return async (request: Request, auth: { userId: string }): Promise<Response> => {
    try {
      if (request.method === 'GET') {
        const data = await getReturnReview(store, auth.userId, periodFromQuery(new URL(request.url)));
        return Response.json({ ok: true, data });
      }
      if (request.method === 'PUT') {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const period = periodSchema.safeParse(body);
        const options = saveBodySchema.safeParse(body);
        if (!period.success || !options.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
        const data = await saveReturnDraft(store, auth.userId, period.data, options.data.reopen ?? false);
        return Response.json({ ok: true, data });
      }
      return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error; // withAuth logs the class only and returns the 500 shape
    }
  };
}

export default { fetch: withAuth(vatReturnHandler(databaseStore)) };
