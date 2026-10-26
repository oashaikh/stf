import { z } from 'zod';
import { HmrcError } from '../../src/lib/hmrc/client';
import { withAuth, type AuthDeps } from '../_lib/auth';
import { periodSchema, VatReturnError, vatErrorResponse } from '../_lib/vatReturns';
import { submitVatReturnForUser, type SubmitDeps } from '../_lib/vatSubmit';

// Filing is irreversible, so the caller must say so explicitly; boxes are never read from the body.
const confirmSchema = z.object({ confirm: z.literal(true) });

// ponytail: no per-client rate limit exists on any api route yet (SEC-14); the one-claim-per-period
// lock bounds HMRC calls for now. Upgrade path: shared limiter middleware in api/_lib once added.
export function createSubmitHandler(deps: SubmitDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const body = await request.json().catch(() => null);
    const period = periodSchema.safeParse(body);
    if (!period.success || !confirmSchema.safeParse(body).success) {
      return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    }
    try {
      const { formBundleNumber, processingDate, sandbox } = await submitVatReturnForUser(
        { userId: auth.userId, period: period.data, request },
        deps,
      );
      return Response.json({ ok: true, data: { formBundleNumber, processingDate, sandbox } });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      if (error instanceof HmrcError) {
        // The HMRC message can echo tokens or the VAT number, so only the code and status are logged.
        console.error('HMRC submit error', error.apiError.code, error.apiError.statusCode);
        return vatErrorResponse(502, error.apiError.code, 'HMRC request failed');
      }
      throw error;
    }
  }, authDeps);
}

export default { fetch: createSubmitHandler() };
