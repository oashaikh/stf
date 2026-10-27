import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createInvoicePdfHandler } from '../../invoice-pdf';
import type { AuthDeps } from '../auth';
import type { InvoicePdfData, InvoicePdfStore } from '../invoicePdfData';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const INVOICE_ID = '11111111-1111-4111-8111-111111111111';
const VOIDED_ID = '22222222-2222-4222-8222-222222222222';

const fixture = (id: string, status: string): InvoicePdfData =>
  ({
    invoice: {
      id,
      publicNumber: 'INV/0042',
      status,
      clientName: 'Example Client Ltd',
      clientEmail: null,
      clientAddress: '1 Example Road',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      subtotalPence: 100_000,
      vatPence: 20_000,
      totalPence: 120_000,
      notes: null,
      lines: [{ id: 'l1', description: 'Consulting', quantity: 10_000, unitPricePence: 100_000, vatRatePercent: 20, subtotalPence: 100_000, vatPence: 20_000, totalPence: 120_000 }],
    },
    seller: { businessName: 'Sample Trading', businessAddress: '2 Sample Street', vatNumber: 'GB123456789', paymentBankName: null, paymentSortCode: null, paymentAccountNumber: null },
    vatSummary: [{ vatRatePercent: 20, netPence: 100_000, vatPence: 20_000 }],
  }) as unknown as InvoicePdfData;

const invoicesByOwner: Record<string, Record<string, InvoicePdfData>> = {
  owner_a: { [INVOICE_ID]: fixture(INVOICE_ID, 'sent'), [VOIDED_ID]: fixture(VOIDED_ID, 'voided') },
  owner_b: {},
};
const store: InvoicePdfStore = { load: async (userId, invoiceId) => invoicesByOwner[userId]?.[invoiceId] };

const get = (query: string, userId?: string, method = 'GET') =>
  createInvoicePdfHandler(store, authDeps)(
    new Request(`https://app.test/api/invoice-pdf?${query}`, { method, headers: userId ? { cookie: `stf_session=tok-${userId}` } : {} }),
  );

async function extractText(pdf: ArrayBuffer): Promise<string> {
  const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n');
}

describe('invoice-pdf route', () => {
  it('returns the owner a PDF with the number, totals and VAT number', async () => {
    const response = await get(`id=${INVOICE_ID}`, 'owner_a');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="invoice-INV_0042.pdf"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await extractText(await response.arrayBuffer());
    expect(text).toContain('INV/0042');
    expect(text).toContain('£1,200.00');
    expect(text).toContain('GB123456789');
  });

  it("answers 404 with no PDF bytes for another owner's invoice", async () => {
    const response = await get(`id=${INVOICE_ID}`, 'owner_b');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('answers 404 for a voided invoice', async () => {
    expect((await get(`id=${VOIDED_ID}`, 'owner_a')).status).toBe(404);
  });

  it('answers 401 without a session', async () => {
    expect((await get(`id=${INVOICE_ID}`)).status).toBe(401);
  });

  it('answers 400 for a non-uuid or missing id', async () => {
    expect((await get('id=not-a-uuid', 'owner_a')).status).toBe(400);
    expect((await get('', 'owner_a')).status).toBe(400);
  });

  it('answers 405 for non-GET methods', async () => {
    expect((await get(`id=${INVOICE_ID}`, 'owner_a', 'POST')).status).toBe(405);
  });
});
