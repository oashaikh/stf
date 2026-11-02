import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { type ItsCumulativePreviewDeps } from '../_lib/itsCumulativePreview.js';
import { itsPropertyPreviewSchema, previewItsPropertyUpdateForUser } from '../_lib/itsPropertyPreview.js';

// Nothing is sent to HMRC, so there is no confirm flag. Rate limiting: see the ponytail note in submit.ts (SEC-14).
export function createItsPropertyPreviewHandler(deps: ItsCumulativePreviewDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    const fail = (status: number, code: string, error: string) => Response.json({ ok: false, error, code }, { status });
    if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = itsPropertyPreviewSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return fail(400, 'BAD_REQUEST', 'Invalid request');
    const result = await previewItsPropertyUpdateForUser({ userId: auth.userId, request, ...input.data }, deps);
    if (!result.ok) return fail(result.status, result.code, result.error);
    return Response.json(result);
  }, authDeps);
}

export default { fetch: createItsPropertyPreviewHandler() };
