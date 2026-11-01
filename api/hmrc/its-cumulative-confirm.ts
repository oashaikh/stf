import { z } from 'zod';
import { HmrcError } from '../../src/lib/hmrc/client.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsCumulativePreviewSchema } from '../_lib/itsCumulativePreview.js';
import { confirmItsUpdateForUser, type ItsSubmitDeps } from '../_lib/itsSubmit.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// The snapshot is recomputed on the server; the caller only names the period and ticks the declaration.
const confirmBodySchema = itsCumulativePreviewSchema.extend({ declaration: z.literal(true) }).strict();

// Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsCumulativeConfirmHandler(deps: ItsSubmitDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = confirmBodySchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const { sandbox, body } = await confirmItsUpdateForUser(
        { userId: auth.userId, taxYear: input.data.taxYear, quarter: input.data.quarter, declaration: true, request },
        deps,
      );
      return Response.json({ ok: true, data: { sandbox, body } });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      if (error instanceof HmrcError) {
        // The HMRC message can echo tokens or the NINO, so only the code and status are logged.
        console.error('HMRC confirm error', error.apiError.code, error.apiError.statusCode);
        return vatErrorResponse(502, error.apiError.code, 'HMRC request failed');
      }
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsCumulativeConfirmHandler() };
