import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { businessProfileSchema, databaseBusinessProfileStore, type BusinessProfileStore } from '../_lib/businessProfile.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export function createBusinessProfileHandler(store: BusinessProfileStore = databaseBusinessProfileStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET' && request.method !== 'PUT') return refuse(405, 'Method not allowed', 'METHOD');

    let profile;
    if (request.method === 'PUT') {
      const parsed = businessProfileSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? 'Invalid business profile', 'BAD_REQUEST');
      profile = await store.update(auth.userId, parsed.data);
    } else {
      profile = await store.get(auth.userId);
    }
    if (!profile) return refuse(404, 'User not found', 'NOT_FOUND');
    return Response.json({ ok: true, profile });
  }, authDeps);
}

export default { fetch: createBusinessProfileHandler() };
