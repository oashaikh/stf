import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { databaseSetupProgressStore, parseSetupUpdate, type SetupProgressStore } from '../_lib/setupProgress.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export function createSetupHandler(
  store: SetupProgressStore = databaseSetupProgressStore,
  authDeps?: AuthDeps,
  now: () => Date = () => new Date(),
) {
  return withAuth(async (request, auth) => {
    if (request.method === 'POST') {
      const parsed = parseSetupUpdate(await request.json().catch(() => null));
      if (!parsed.ok) return refuse(400, 'Setup answers are not valid', 'BAD_REQUEST');
      await store.update(auth.userId, parsed.update, now());
    } else if (request.method !== 'GET') {
      return refuse(405, 'Method not allowed', 'METHOD');
    }

    const progress = await store.get(auth.userId);
    if (!progress) return refuse(404, 'User not found', 'NOT_FOUND');
    return Response.json({ ok: true, ...progress, finishedAt: progress.finishedAt?.toISOString() ?? null });
  }, authDeps);
}

export default { fetch: createSetupHandler() };
