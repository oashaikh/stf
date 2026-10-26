import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { previewVatReturnForUser, type PreviewDeps } from '../_lib/vatPreview.js';
import { periodSchema, VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// Nothing is filed, so unlike submit there is no confirm flag; the period is the whole input.
// Rate limiting: see the ponytail note in submit.ts (SEC-14); the preview makes no HMRC call.
export function createPreviewHandler(deps: PreviewDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const period = periodSchema.safeParse(await request.json().catch(() => null));
    if (!period.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const data = await previewVatReturnForUser({ userId: auth.userId, period: period.data, request }, deps);
      return Response.json({ ok: true, data });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createPreviewHandler() };
