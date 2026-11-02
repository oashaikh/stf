import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsFinalInputSchema, previewItsFinalForUser, type ItsFinalDeps } from '../_lib/itsFinalDeclaration.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// Asks HMRC to calculate the year; nothing is filed. Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsFinalPreviewHandler(deps: ItsFinalDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = itsFinalInputSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const data = await previewItsFinalForUser({ userId: auth.userId, taxYear: input.data.taxYear, request }, deps);
      return Response.json({ ok: true, data });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsFinalPreviewHandler() };
