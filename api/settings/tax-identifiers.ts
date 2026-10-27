import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { databaseTaxIdentifiersStore, maskStored, taxIdentifiersSchema, toStoredPatch, type TaxIdentifiersStore } from '../_lib/taxIdentifiers.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export function createTaxIdentifiersHandler(store: TaxIdentifiersStore = databaseTaxIdentifiersStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET' && request.method !== 'PUT') return refuse(405, 'Method not allowed', 'METHOD');

    let stored;
    if (request.method === 'PUT') {
      const parsed = taxIdentifiersSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return refuse(400, parsed.error.issues[0]?.message ?? 'Invalid tax identifiers', 'BAD_REQUEST');
      stored = await store.update(auth.userId, toStoredPatch(parsed.data));
    } else {
      stored = await store.get(auth.userId);
    }
    if (!stored) return refuse(404, 'User not found', 'NOT_FOUND');
    return Response.json({ ok: true, ...maskStored(stored) });
  }, authDeps);
}

export default { fetch: createTaxIdentifiersHandler() };
