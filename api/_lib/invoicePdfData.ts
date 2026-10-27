import { eq } from 'drizzle-orm';

import { users } from '../../server/src/db/schema.js';
import { vatSummaryByRate, type VatSummaryRow } from '../../src/lib/invoiceMaths.js';
import { db } from './db.js';
import { databaseInvoiceStore, type Invoice, type InvoiceStore } from './invoices.js';

export interface InvoicePdfSeller {
  businessName: string | null;
  businessAddress: string | null;
  vatNumber: string | null;
  paymentBankName: string | null;
  paymentSortCode: string | null;
  paymentAccountNumber: string | null;
}

export interface InvoicePdfData {
  invoice: Invoice;
  seller: InvoicePdfSeller;
  vatSummary: VatSummaryRow[];
}

export interface InvoicePdfStore {
  /** Undefined when the invoice is not the owner's. */
  load(userId: string, invoiceId: string): Promise<InvoicePdfData | undefined>;
}

// Query audit: filters on users.id (primary key, from the session), one row, only the columns the PDF prints.
const readSellerFromDatabase = async (userId: string): Promise<InvoicePdfSeller | undefined> => {
  const [row] = await db
    .select({
      businessName: users.businessName,
      businessAddress: users.businessAddress,
      vatNumber: users.vatNumber,
      paymentBankName: users.paymentBankName,
      paymentSortCode: users.paymentSortCode,
      paymentAccountNumber: users.paymentAccountNumber,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row;
};

export async function loadInvoicePdfData(
  sources: { invoices: Pick<InvoiceStore, 'get'>; readSeller: (userId: string) => Promise<InvoicePdfSeller | undefined> },
  userId: string,
  invoiceId: string,
): Promise<InvoicePdfData | undefined> {
  const invoice = await sources.invoices.get(userId, invoiceId);
  if (!invoice) return undefined;
  const seller = await sources.readSeller(userId);
  if (!seller) return undefined;
  return { invoice, seller, vatSummary: vatSummaryByRate(invoice.lines) };
}

export const databaseInvoicePdfStore: InvoicePdfStore = {
  load: (userId, invoiceId) => loadInvoicePdfData({ invoices: databaseInvoiceStore, readSeller: readSellerFromDatabase }, userId, invoiceId),
};
