import { z } from 'zod';
import { HmrcError } from '../../src/lib/hmrc/client.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsCumulativePreviewSchema } from '../_lib/itsCumulativePreview.js';
import { submitItsUpdateForUser, type ItsSubmitDeps } from '../_lib/itsSubmit.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// Filing is irreversible, so the caller must say so explicitly; the payload comes from the stored confirmation, never the body.
const submitBodySchema = itsCumulativePreviewSchema.extend({ confirm: z.literal(true) }).strict();

// Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsCumulativeSubmitHandler(deps: ItsSubmitDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = submitBodySchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const { sandbox } = await submitItsUpdateForUser(
        { userId: auth.userId, taxYear: input.data.taxYear, quarter: input.data.quarter, request },
        deps,
      );
      return Response.json({ ok: true, data: { sandbox } });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      if (error instanceof HmrcError) {
        // The HMRC message can echo tokens or the NINO, so only the code and status are logged.
        console.error('HMRC submit error', error.apiError.code, error.apiError.statusCode);
        return vatErrorResponse(502, error.apiError.code, 'HMRC request failed');
      }
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsCumulativeSubmitHandler() };
