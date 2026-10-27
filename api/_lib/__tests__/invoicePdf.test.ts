import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { renderInvoicePdf } from '../invoicePdf';
import type { InvoicePdfData } from '../invoicePdfData';

const fixture = (vatNumber: string | null): InvoicePdfData =>
  ({
    invoice: {
      id: 'inv-1',
      publicNumber: 'INV-0042',
      clientName: 'Example Client Ltd',
      clientEmail: 'accounts@example.test',
      clientAddress: '1 Example Road',
      issueDate: '2026-10-01',
      dueDate: '2026-10-31',
      subtotalPence: 150_000,
      vatPence: 20_000,
      totalPence: 170_000,
      notes: 'Thanks for your business',
      lines: [
        { id: 'l1', description: 'Consulting', quantity: 15_000, unitPricePence: 100_000, vatRatePercent: 20, subtotalPence: 100_000, vatPence: 20_000, totalPence: 120_000 },
        { id: 'l2', description: 'Printed manual', quantity: 10_000, unitPricePence: 50_000, vatRatePercent: 0, subtotalPence: 50_000, vatPence: 0, totalPence: 50_000 },
      ],
    },
    seller: {
      businessName: 'Sample Trading',
      businessAddress: '2 Sample Street',
      vatNumber,
      paymentBankName: 'Sample Bank',
      paymentSortCode: '12-34-56',
      paymentAccountNumber: '12345678',
    },
    vatSummary: [
      { vatRatePercent: 0, netPence: 50_000, vatPence: 0 },
      { vatRatePercent: 20, netPence: 100_000, vatPence: 20_000 },
    ],
  }) as unknown as InvoicePdfData;

async function extractText(pdf: Buffer): Promise<string> {
  const document = await getDocument({ data: new Uint8Array(pdf) }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const content = await (await document.getPage(pageNumber)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n');
}

describe('renderInvoicePdf', () => {
  it('renders a PDF carrying the number, totals, VAT summary and VAT number', async () => {
    const pdf = await renderInvoicePdf(fixture('GB123456789'));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const text = await extractText(pdf);
    for (const expected of [
      'INV-0042',
      'GB123456789',
      'Sample Trading',
      'Example Client Ltd',
      '1 Oct 2026',
      '31 Oct 2026',
      'Consulting',
      '1.5',
      '£1,000.00',
      '£500.00',
      '£200.00',
      '£1,500.00',
      'Total due: £1,700.00',
      '12-34-56',
      '12345678',
      'Thanks for your business',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).toMatch(/VAT at 20% on £1,000\.00\s+£200\.00/);
  });

  it('leaves out the VAT number line when the owner is not registered', async () => {
    const text = await extractText(await renderInvoicePdf(fixture(null)));
    expect(text).toContain('INV-0042');
    expect(text).not.toContain('VAT number');
  });
});
