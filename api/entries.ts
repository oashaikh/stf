import { withAuth, type AuthDeps } from './_lib/auth.js';
import { createEntry, databaseEntryStore, EntryRuleError, newEntrySchema, type EntryStore } from './_lib/entries.js';

const refuse = (status: number, error: string, code: string, fields: string[] = []) =>
  Response.json({ ok: false, error, code, fields }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createEntriesHandler(store: EntryStore = databaseEntryStore, authDeps?: AuthDeps, now: () => Date = () => new Date()) {
  return withAuth(async (request, auth) => {
    if (request.method === 'POST') {
      const parsed = newEntrySchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return refuse(400, 'Invalid entry', 'BAD_REQUEST', [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]);
      try {
        return Response.json({ ok: true, entry: await createEntry(store, auth.userId, parsed.data, now()) });
      } catch (error) {
        if (error instanceof EntryRuleError) return refuse(error.status, error.message, error.code, error.field ? [error.field] : []);
        throw error;
      }
    }

    if (request.method === 'GET') {
      const entryId = new URL(request.url).searchParams.get('id');
      if (entryId === null) return Response.json({ ok: true, entries: await store.list(auth.userId) });
      if (!UUID.test(entryId)) return refuse(400, 'Entry id must be a uuid', 'BAD_REQUEST');
      const entry = await store.get(auth.userId, entryId);
      return entry ? Response.json({ ok: true, entry }) : refuse(404, 'Entry not found', 'NOT_FOUND');
    }

    return refuse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
  }, authDeps);
}

export default { fetch: createEntriesHandler() };
