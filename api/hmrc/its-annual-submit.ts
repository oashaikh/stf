import { z } from 'zod';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsAnnualInputSchema, submitItsAnnualForUser, type ItsAnnualDeps } from '../_lib/itsAnnualSubmit.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// Filing is irreversible, so the caller must say so explicitly; the payload comes from the stored confirmation, never the body.
const submitBodySchema = itsAnnualInputSchema.extend({ confirm: z.literal(true) }).strict();

// Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsAnnualSubmitHandler(deps: ItsAnnualDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = submitBodySchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const { sandbox } = await submitItsAnnualForUser({ userId: auth.userId, taxYear: input.data.taxYear, request }, deps);
      return Response.json({ ok: true, data: { sandbox } });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsAnnualSubmitHandler() };
