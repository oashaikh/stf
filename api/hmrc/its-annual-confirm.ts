import { z } from 'zod';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { confirmItsAnnualForUser, itsAnnualBodySchema, type ItsAnnualDeps } from '../_lib/itsAnnualSubmit.js';
import { VatReturnError, vatErrorResponse } from '../_lib/vatReturns.js';

// The snapshot is recomputed on the server; the caller only names the year and ticks the declaration.
const confirmBodySchema = itsAnnualBodySchema({ declaration: z.literal(true) });

// Rate limiting: see the ponytail note in api/vat/submit.ts (SEC-14).
export function createItsAnnualConfirmHandler(deps: ItsAnnualDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return vatErrorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = confirmBodySchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return vatErrorResponse(400, 'BAD_REQUEST', 'Invalid request');
    try {
      const { sandbox, body } = await confirmItsAnnualForUser({ userId: auth.userId, ...input.data, declaration: true, request }, deps);
      return Response.json({ ok: true, data: { sandbox, body } });
    } catch (error) {
      if (error instanceof VatReturnError) return vatErrorResponse(error.status, error.code, error.message);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createItsAnnualConfirmHandler() };
