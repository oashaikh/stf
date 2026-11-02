import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsAnnualBodySchema, previewItsAnnualForUser, type ItsAnnualDeps } from '../_lib/itsAnnualSubmit.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// Nothing is sent to HMRC, so there is no confirm flag. Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsAnnualPreviewHandler(deps: ItsAnnualDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = itsAnnualBodySchema().safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const data = await previewItsAnnualForUser({ userId: auth.userId, ...input.data }, deps);
      return Response.json({ ok: true, data });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsAnnualPreviewHandler() };
