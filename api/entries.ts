import { z } from 'zod';

import { withAuth, type AuthDeps } from './_lib/auth.js';
import { confirmEntry, createEntry, decodeCursor, entryListQuerySchema, listEntries, editEntry, voidEntry, databaseEntryStore, EntryRuleError, newEntrySchema, type EntryStore } from './_lib/entries.js';

const refuse = (status: number, error: string, code: string, fields: string[] = []) =>
  Response.json({ ok: false, error, code, fields }, { status });
const confirmBodySchema = z.object({ status: z.literal('confirmed') });
const issueFields = (error: z.ZodError) => [...new Set(error.issues.map((issue) => String(issue.path[0])))];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createEntriesHandler(store: EntryStore = databaseEntryStore, authDeps?: AuthDeps, now: () => Date = () => new Date()) {
  return withAuth(async (request, auth) => {
    const run = async (work: () => Promise<Response>) => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof EntryRuleError) return refuse(error.status, error.message, error.code, error.field ? [error.field] : []);
        throw error;
      }
    };
    const entryId = new URL(request.url).searchParams.get('id') ?? '';
    const readBody = () => request.json().catch(() => null);

    if (request.method === 'POST') {
      const parsed = newEntrySchema.safeParse(await readBody());
      if (!parsed.success) return refuse(400, 'Invalid entry', 'BAD_REQUEST', issueFields(parsed.error));
      return run(async () => Response.json({ ok: true, entry: await createEntry(store, auth.userId, parsed.data, now()) }));
    }

    if (request.method === 'GET' && !entryId) {
      const parsed = entryListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return refuse(400, 'Invalid list query', 'BAD_REQUEST');
      const { limit, cursor, ...filters } = parsed.data;
      const after = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !after) return refuse(400, 'Invalid cursor', 'BAD_REQUEST');
      return Response.json({ ok: true, ...(await listEntries(store, auth.userId, filters, after, limit)) });
    }

    if (request.method === 'GET') {
      if (!UUID.test(entryId)) return refuse(400, 'Entry id must be a uuid', 'BAD_REQUEST');
      const entry = await store.get(auth.userId, entryId);
      return entry ? Response.json({ ok: true, entry }) : refuse(404, 'Entry not found', 'NOT_FOUND');
    }

    if (!['PUT', 'DELETE', 'PATCH'].includes(request.method)) return refuse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
    if (!UUID.test(entryId)) return refuse(400, 'Entry id must be a uuid', 'BAD_REQUEST');

    if (request.method === 'PUT') {
      const parsed = newEntrySchema.safeParse(await readBody());
      if (!parsed.success) return refuse(400, 'Invalid entry', 'BAD_REQUEST', issueFields(parsed.error));
      return run(async () => Response.json({ ok: true, entry: await editEntry(store, auth.userId, entryId, parsed.data, now()) }));
    }

    if (request.method === 'DELETE') {
      return run(async () => {
        await voidEntry(store, auth.userId, entryId);
        return Response.json({ ok: true });
      });
    }

    if (!confirmBodySchema.safeParse(await readBody()).success) return refuse(400, 'Body must be {"status":"confirmed"}', 'BAD_REQUEST');
    return run(async () => Response.json({ ok: true, entry: await confirmEntry(store, auth.userId, entryId) }));
  }, authDeps);
}

export default { fetch: createEntriesHandler() };
