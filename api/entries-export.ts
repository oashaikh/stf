import { withAuth, type AuthDeps } from './_lib/auth.js';
import { databaseExportStore, exportEntries, parseExportRange, type ExportStore } from './_lib/entriesExport.js';

export function createEntriesExportHandler(store: ExportStore = databaseExportStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
    const range = parseExportRange(new URL(request.url).searchParams);
    if ('error' in range) return Response.json({ ok: false, error: range.error, code: range.code }, { status: 400 });
    const result = await exportEntries(store, auth.userId, range.from, range.to);
    if ('error' in result) return Response.json({ ok: false, error: result.error, code: 'TOO_MANY_ROWS' }, { status: 400 });
    return new Response(result.csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="entries-${range.from}-to-${range.to}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }, authDeps);
}

export default { fetch: createEntriesExportHandler() };
