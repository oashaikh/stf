import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsFinalConfirmSchema, confirmItsFinalForUser, type ItsFinalDeps } from '../_lib/itsFinalDeclaration.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// The figures are re-read from HMRC by id; the caller only ticks the declaration. Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsFinalConfirmHandler(deps: ItsFinalDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = itsFinalConfirmSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const { sandbox, hmrc } = await confirmItsFinalForUser({ userId: auth.userId, ...input.data, request }, deps);
      return Response.json({ ok: true, data: { sandbox, hmrc } });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsFinalConfirmHandler() };
