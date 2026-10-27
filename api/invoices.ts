import { withAuth, type AuthDeps } from './_lib/auth.js';
import {
  InvoiceRuleError,
  databaseInvoiceStore,
  decodeInvoiceCursor,
  draftInvoiceSchema,
  invoiceListQuerySchema,
  listInvoices,
  markPaidSchema,
  voidInvoiceSchema,
  type InvoiceStore,
} from './_lib/invoices.js';

const refuse = (status: number, error: string, code: string, fields: string[] = []) =>
  Response.json({ ok: false, error, code, fields }, { status });
const issueFields = (issues: Array<{ path: PropertyKey[] }>) => [...new Set(issues.map((issue) => String(issue.path[0])))];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => refuse(404, 'Invoice not found', 'NOT_FOUND');

export function createInvoicesHandler(store: InvoiceStore = databaseInvoiceStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    const run = async (work: () => Promise<Response>) => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof InvoiceRuleError) return refuse(error.status, error.message, error.code);
        throw error;
      }
    };
    const url = new URL(request.url);
    const invoiceId = url.searchParams.get('id') ?? '';
    const readBody = () => request.json().catch(() => null);

    if (request.method === 'POST' && invoiceId) {
      const action = url.searchParams.get('action');
      if (action !== 'issue' && action !== 'paid') return refuse(400, 'Action must be issue or paid', 'BAD_REQUEST', ['action']);
      if (!UUID.test(invoiceId)) return refuse(400, 'Invoice id must be a uuid', 'BAD_REQUEST', ['id']);
      let paymentDate = '';
      if (action === 'paid') {
        const parsed = markPaidSchema.safeParse(await readBody());
        if (!parsed.success) return refuse(400, 'A valid payment date is required', 'BAD_REQUEST', ['paymentDate']);
        paymentDate = parsed.data.paymentDate;
      }
      return run(async () => {
        const invoice = action === 'issue' ? await store.issue(auth.userId, invoiceId) : await store.markPaid(auth.userId, invoiceId, paymentDate);
        return invoice ? Response.json({ ok: true, invoice }) : notFound();
      });
    }

    if (request.method === 'POST') {
      const parsed = draftInvoiceSchema.safeParse(await readBody());
      if (!parsed.success) return refuse(400, 'Invalid invoice', 'BAD_REQUEST', issueFields(parsed.error.issues));
      return run(async () => Response.json({ ok: true, invoice: await store.create(auth.userId, parsed.data) }));
    }

    if (request.method === 'GET' && !invoiceId) {
      const parsed = invoiceListQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return refuse(400, 'Invalid list query', 'BAD_REQUEST', issueFields(parsed.error.issues));
      const after = parsed.data.cursor ? decodeInvoiceCursor(parsed.data.cursor) : undefined;
      if (parsed.data.cursor && !after) return refuse(400, 'Invalid cursor', 'BAD_REQUEST', ['cursor']);
      return Response.json({ ok: true, ...(await listInvoices(store, auth.userId, parsed.data.status, after, parsed.data.limit)) });
    }

    if (!['GET', 'PUT', 'DELETE'].includes(request.method)) return refuse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
    if (!UUID.test(invoiceId)) return refuse(400, 'Invoice id must be a uuid', 'BAD_REQUEST', ['id']);

    if (request.method === 'GET') {
      const invoice = await store.get(auth.userId, invoiceId);
      return invoice ? Response.json({ ok: true, invoice }) : notFound();
    }

    if (request.method === 'PUT') {
      const parsed = draftInvoiceSchema.safeParse(await readBody());
      if (!parsed.success) return refuse(400, 'Invalid invoice', 'BAD_REQUEST', issueFields(parsed.error.issues));
      return run(async () => {
        const invoice = await store.update(auth.userId, invoiceId, parsed.data);
        return invoice ? Response.json({ ok: true, invoice }) : notFound();
      });
    }

    const parsed = voidInvoiceSchema.safeParse(await readBody());
    if (!parsed.success) return refuse(400, 'A void reason is required', 'BAD_REQUEST', ['reason']);
    return run(async () => ((await store.void(auth.userId, invoiceId, parsed.data.reason)) ? Response.json({ ok: true }) : notFound()));
  }, authDeps);
}

export default { fetch: createInvoicesHandler() };
