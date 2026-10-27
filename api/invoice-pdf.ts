import { withAuth, type AuthDeps } from './_lib/auth.js';
import { databaseInvoicePdfStore, type InvoicePdfStore } from './_lib/invoicePdfData.js';
import { renderInvoicePdf } from './_lib/invoicePdf.js';

const refuse = (status: number, error: string, code: string, fields: string[] = []) =>
  Response.json({ ok: false, error, code, fields }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInvoicePdfHandler(store: InvoicePdfStore = databaseInvoicePdfStore, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return refuse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
    const invoiceId = new URL(request.url).searchParams.get('id') ?? '';
    if (!UUID.test(invoiceId)) return refuse(400, 'Invoice id must be a uuid', 'BAD_REQUEST', ['id']);
    const data = await store.load(auth.userId, invoiceId);
    // Voided invoices are not documents to send on, so they answer like a missing one.
    if (!data || data.invoice.status === 'voided') return refuse(404, 'Invoice not found', 'NOT_FOUND');
    const pdf = await renderInvoicePdf(data);
    const safeNumber = data.invoice.publicNumber.replace(/[^A-Za-z0-9_-]/g, '_');
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${safeNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  }, authDeps);
}

export default { fetch: createInvoicePdfHandler() };
