import { downloadFile } from './exportApi';
import type { DraftInvoiceRequest } from './invoiceForm';
import type { VatRate } from './vat';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'voided';

export const INVOICE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'voided'];

export interface InvoiceListRow {
  id: string;
  publicNumber: string | null;
  clientName: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  totalPence: number;
}

export interface ApiInvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPricePence: number;
  vatRatePercent: VatRate;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
}

export interface ApiInvoice extends InvoiceListRow {
  clientEmail: string | null;
  clientAddress: string | null;
  subtotalPence: number;
  vatPence: number;
  notes: string | null;
  lines: ApiInvoiceLine[];
}

export const invoicesQueryKey = ['invoices'];

async function send(url: string, method: string, payload?: unknown, fallback = 'Could not reach the server. Please try again.') {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : fallback);
  return body;
}

const invoiceUrl = (id: string) => `/api/invoices?${new URLSearchParams({ id })}`;

export async function fetchInvoices(status: InvoiceStatus | '', cursor?: string): Promise<{ invoices: InvoiceListRow[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (cursor) query.set('cursor', cursor);
  const body = await send(`/api/invoices?${query}`, 'GET', undefined, 'Could not load invoices');
  return { invoices: body.invoices, nextCursor: body.nextCursor };
}

export async function fetchInvoice(id: string): Promise<ApiInvoice> {
  return (await send(invoiceUrl(id), 'GET', undefined, 'Could not load the invoice')).invoice;
}

export async function saveDraft(id: string | null, draft: DraftInvoiceRequest): Promise<ApiInvoice> {
  const body = await send(id ? invoiceUrl(id) : '/api/invoices', id ? 'PUT' : 'POST', draft, 'Could not save the invoice. Please try again.');
  return body.invoice;
}

export async function issueInvoice(id: string): Promise<ApiInvoice> {
  return (await send(`${invoiceUrl(id)}&action=issue`, 'POST', undefined, 'Could not issue the invoice')).invoice;
}

export async function markInvoicePaid(id: string, paymentDate: string): Promise<ApiInvoice> {
  return (await send(`${invoiceUrl(id)}&action=paid`, 'POST', { paymentDate }, 'Could not mark the invoice as paid')).invoice;
}

export async function voidInvoice(id: string, reason: string): Promise<void> {
  await send(invoiceUrl(id), 'DELETE', { reason }, 'Could not void the invoice');
}

export function downloadInvoicePdf(id: string, publicNumber: string | null): Promise<void> {
  return downloadFile(`/api/invoice-pdf?id=${encodeURIComponent(id)}`, `invoice-${publicNumber ?? id}.pdf`, 'Could not download the invoice PDF');
}
