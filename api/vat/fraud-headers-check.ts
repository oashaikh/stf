import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { runFraudHeadersCheck, type FraudCheckDeps } from '../_lib/fraudHeadersCheck.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// Sandbox only: the validator client has no live base URL. Rate limiting: see the ponytail note in submit.ts (SEC-14).
export function createFraudHeadersCheckHandler(deps: FraudCheckDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    try {
      const data = await runFraudHeadersCheck({ userId: auth.userId, request }, deps);
      return Response.json({ ok: true, data });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createFraudHeadersCheckHandler() };
