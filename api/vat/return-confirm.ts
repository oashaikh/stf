import { withAuth } from '../_lib/auth.js';
import {
  confirmBodySchema,
  confirmReturn,
  databaseStore,
  periodSchema,
  VatReturnError,
  vatErrorResponse,
  type VatReturnStore,
} from '../_lib/vatReturns.js';

export function vatConfirmHandler(store: VatReturnStore, now: () => Date = () => new Date()) {
  return async (request: Request, auth: { userId: string }): Promise<Response> => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    try {
      const body = await request.json().catch(() => null);
      const period = periodSchema.safeParse(body);
      if (!period.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
      // Only the literal declaration is read; any boxes the client sends are ignored.
      if (!confirmBodySchema.safeParse(body).success) {
        return vatErrorResponse(422, 'DECLARATION_REQUIRED', 'The declaration must be accepted to confirm');
      }
      const data = await confirmReturn(store, auth.userId, period.data, now());
      return Response.json({ ok: true, data });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  };
}

export default { fetch: withAuth(vatConfirmHandler(databaseStore)) };
