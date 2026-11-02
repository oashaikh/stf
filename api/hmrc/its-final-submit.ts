import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsFinalSubmitSchema, submitItsFinalForUser, type ItsFinalDeps } from '../_lib/itsFinalDeclaration.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// The calculation id comes from the stored confirmation, never the body. Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsFinalSubmitHandler(deps: ItsFinalDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = itsFinalSubmitSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const { sandbox } = await submitItsFinalForUser({ userId: auth.userId, taxYear: input.data.taxYear, request }, deps);
      return Response.json({ ok: true, data: { sandbox } });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsFinalSubmitHandler() };
