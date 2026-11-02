import { z } from 'zod';

import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { assertOk, bodySchema, createDraftFromLine, databaseReconcileStore, getProposals, type ReconcileStore } from '../_lib/bankReconcile.js';
import { databaseEntryStore, EntryRuleError, type EntryStore } from '../_lib/entries.js';

const refuse = (status: number, error: string, code: string, fields: string[] = []) =>
  Response.json({ ok: false, error, code, fields }, { status });
const issueFields = (error: z.ZodError) => [...new Set(error.issues.map((issue) => String(issue.path[0])))];

export function createReconcileHandler(
  store: ReconcileStore = databaseReconcileStore,
  entryStore: EntryStore = databaseEntryStore,
  authDeps?: AuthDeps,
  now: () => Date = () => new Date(),
) {
  return withAuth(async (request, auth) => {
    if (request.method === 'GET') return Response.json({ ok: true, ...(await getProposals(store, auth.userId)) });
    if (request.method !== 'POST') return refuse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return refuse(400, 'Invalid request', 'BAD_REQUEST', issueFields(parsed.error));
    const body = parsed.data;

    try {
      switch (body.action) {
        case 'match':
          assertOk(await store.match(auth.userId, body.lineId, body.entryId));
          break;
        case 'unmatch':
          assertOk(await store.unmatch(auth.userId, body.lineId));
          break;
        case 'dismiss':
          assertOk(await store.dismiss(auth.userId, body.lineId, body.reason));
          break;
        case 'undismiss':
          assertOk(await store.undismiss(auth.userId, body.lineId));
          break;
        case 'createEntry':
          return Response.json({ ok: true, entryId: (await createDraftFromLine(store, entryStore, auth.userId, body, now())).id });
      }
      return Response.json({ ok: true });
    } catch (error) {
      if (error instanceof EntryRuleError) return refuse(error.status, error.message, error.code, error.field ? [error.field] : []);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createReconcileHandler() };
