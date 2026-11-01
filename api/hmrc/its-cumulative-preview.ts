import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { itsCumulativePreviewSchema, previewItsCumulativeUpdateForUser, type ItsCumulativePreviewDeps } from '../_lib/itsCumulativePreview.js';

// Nothing is sent to HMRC, so there is no confirm flag. Rate limiting: see the ponytail note in submit.ts (SEC-14).
export function createItsCumulativePreviewHandler(deps: ItsCumulativePreviewDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    const fail = (status: number, code: string, error: string) => Response.json({ ok: false, error, code }, { status });
    if (request.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
    const input = itsCumulativePreviewSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return fail(400, 'BAD_REQUEST', 'Invalid request');
    const result = await previewItsCumulativeUpdateForUser({ userId: auth.userId, ...input.data }, deps);
    if (!result.ok) return fail(result.status, result.code, result.error);
    return Response.json(result);
  }, authDeps);
}

export default { fetch: createItsCumulativePreviewHandler() };
