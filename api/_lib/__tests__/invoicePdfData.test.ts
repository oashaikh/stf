import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import type { Invoice, InvoiceStore } from '../invoices';
import { loadInvoicePdfData, type InvoicePdfSeller } from '../invoicePdfData';

const invoice = {
  id: 'inv-1',
  publicNumber: 'INV-0001',
  lines: [
    { id: 'l1', description: 'Work', quantity: 10_000, unitPricePence: 1000, vatRatePercent: 20, subtotalPence: 1000, vatPence: 200, totalPence: 1200 },
    { id: 'l2', description: 'Book', quantity: 10_000, unitPricePence: 500, vatRatePercent: 0, subtotalPence: 500, vatPence: 0, totalPence: 500 },
  ],
} as unknown as Invoice;

const seller: InvoicePdfSeller = {
  businessName: 'Acme Ltd',
  businessAddress: '1 High St',
  vatNumber: 'GB123456789',
  paymentBankName: 'Bank',
  paymentSortCode: '112233',
  paymentAccountNumber: '12345678',
};

function fakes() {
  const get = vi.fn(async (userId: string, invoiceId: string) => (userId === 'owner-a' && invoiceId === 'inv-1' ? invoice : undefined));
  const readSeller = vi.fn(async () => seller);
  return { invoices: { get } as unknown as InvoiceStore, readSeller, get };
}

describe('loadInvoicePdfData', () => {
  it('returns the invoice, the seller and the VAT summary for the owner', async () => {
    const { invoices, readSeller } = fakes();
    const result = await loadInvoicePdfData({ invoices, readSeller }, 'owner-a', 'inv-1');
    expect(result?.invoice).toBe(invoice);
    expect(result?.seller).toEqual(seller);
    expect(result?.vatSummary).toEqual([
      { vatRatePercent: 0, netPence: 500, vatPence: 0 },
      { vatRatePercent: 20, netPence: 1000, vatPence: 200 },
    ]);
    expect(readSeller).toHaveBeenCalledWith('owner-a');
  });

  it("returns undefined for another owner's invoice without reading the seller", async () => {
    const { invoices, readSeller } = fakes();
    expect(await loadInvoicePdfData({ invoices, readSeller }, 'owner-b', 'inv-1')).toBeUndefined();
    expect(readSeller).not.toHaveBeenCalled();
  });

  it('returns undefined when the seller row is missing', async () => {
    const { invoices } = fakes();
    expect(await loadInvoicePdfData({ invoices, readSeller: async () => undefined }, 'owner-a', 'inv-1')).toBeUndefined();
  });
});
