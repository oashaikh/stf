import { withAuth } from '../_lib/auth';
import { databaseStore, vatErrorResponse, type VatReturnStore } from '../_lib/vatReturns';

export function vatHistoryHandler(store: VatReturnStore) {
  return async (request: Request, auth: { userId: string }): Promise<Response> => {
    if (request.method !== 'GET') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const data = await store.listReturnHistory(auth.userId);
    return Response.json({ ok: true, data });
  };
}

export default { fetch: withAuth(vatHistoryHandler(databaseStore)) };
