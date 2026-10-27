import { z } from 'zod';

import { withAuth, type AuthDeps } from './_lib/auth.js';
import { EntryRuleError } from './_lib/entries.js';
import {
  createTemplate,
  databaseRecurringStore,
  deleteTemplate,
  listTemplates,
  newTemplateSchema,
  templatePatchSchema,
  updateTemplate,
  type RecurringStore,
} from './_lib/recurringEntries.js';

const refuse = (status: number, error: string, code: string, fields: string[] = []) =>
  Response.json({ ok: false, error, code, fields }, { status });
const issueFields = (error: z.ZodError) => [...new Set(error.issues.map((issue) => String(issue.path[0])))];
const templateIdSchema = z.string().uuid();

export function createRecurringEntriesHandler(store: RecurringStore = databaseRecurringStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    const readBody = () => request.json().catch(() => null);
    const templateId = new URL(request.url).searchParams.get('id') ?? '';
    try {
      if (request.method === 'GET') return Response.json({ ok: true, templates: await listTemplates(store, auth.userId) });

      if (request.method === 'POST') {
        const parsed = newTemplateSchema.safeParse(await readBody());
        if (!parsed.success) return refuse(400, 'Invalid template', 'BAD_REQUEST', issueFields(parsed.error));
        return Response.json({ ok: true, template: await createTemplate(store, auth.userId, parsed.data) });
      }

      if (request.method === 'PATCH' || request.method === 'DELETE') {
        if (!templateIdSchema.safeParse(templateId).success) return refuse(400, 'Template id must be a uuid', 'BAD_REQUEST', ['id']);
        if (request.method === 'DELETE') {
          await deleteTemplate(store, auth.userId, templateId);
          return Response.json({ ok: true });
        }
        const parsed = templatePatchSchema.safeParse(await readBody());
        if (!parsed.success) return refuse(400, 'Invalid template change', 'BAD_REQUEST', issueFields(parsed.error));
        return Response.json({ ok: true, template: await updateTemplate(store, auth.userId, templateId, parsed.data) });
      }

      return refuse(405, 'Method not allowed', 'METHOD');
    } catch (error) {
      if (error instanceof EntryRuleError) return refuse(error.status, error.message, error.code, error.field ? [error.field] : []);
      throw error;
    }
  }, authDeps);
}

export default { fetch: createRecurringEntriesHandler() };
