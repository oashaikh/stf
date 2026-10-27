import { createElement as h } from 'react';
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';

type Style = Parameters<typeof StyleSheet.create>[0][string];

import { formatDate } from '../../src/lib/dates.js';
import { formatQuantity } from '../../src/lib/invoiceForm.js';
import { formatPence } from '../../src/lib/money.js';
import type { InvoicePdfData } from './invoicePdfData.js';

// Built-in Helvetica needs no font files in the function bundle and covers the pound sign.
const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#111111' },
  title: { fontSize: 22, marginBottom: 16, fontFamily: 'Helvetica-Bold' },
  section: { marginBottom: 14 },
  heading: { fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  row: { flexDirection: 'row', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#999999' },
  headerRow: { fontFamily: 'Helvetica-Bold' },
  description: { flex: 4 },
  cell: { flex: 1.5, textAlign: 'right' },
  summary: { alignSelf: 'flex-end', width: 240, marginTop: 10 },
  totalDue: { fontFamily: 'Helvetica-Bold', fontSize: 13, marginTop: 6 },
});

const text = (style: Style | Style[], ...children: string[]) => h(Text, { style }, ...children);

// Plain createElement: Vercel does not bundle .tsx modules under api/ (STF-98).
function InvoiceDocument({ invoice, seller, vatSummary }: InvoicePdfData) {
  const { page, title, section, heading, row, headerRow, description, cell, summary, totalDue } = styles;
  const labelled = (label: string, value: string | null | undefined) => (value ? h(Text, null, `${label}${value}`) : null);
  return h(
    Document,
    { title: `Invoice ${invoice.publicNumber}` },
    h(
      Page,
      { size: 'A4', style: page },
      text(title, `Invoice ${invoice.publicNumber}`),
      h(
        View,
        { style: section },
        seller.businessName ? h(Text, { style: heading }, seller.businessName) : null,
        seller.businessAddress ? h(Text, null, seller.businessAddress) : null,
        labelled('VAT number: ', seller.vatNumber),
      ),
      h(
        View,
        { style: section },
        text(heading, 'Bill to'),
        h(Text, null, invoice.clientName),
        invoice.clientEmail ? h(Text, null, invoice.clientEmail) : null,
        invoice.clientAddress ? h(Text, null, invoice.clientAddress) : null,
      ),
      h(
        View,
        { style: section },
        h(Text, null, `Issue date: ${formatDate(invoice.issueDate)}`),
        h(Text, null, `Due date: ${formatDate(invoice.dueDate)}`),
      ),
      h(
        View,
        { style: [row, headerRow] },
        text(description, 'Description'),
        text(cell, 'Qty'),
        text(cell, 'Unit price'),
        text(cell, 'VAT rate'),
        text(cell, 'Net'),
      ),
      ...invoice.lines.map((line) =>
        h(
          View,
          { key: line.id, style: row, wrap: false },
          text(description, line.description),
          text(cell, formatQuantity(line.quantity)),
          text(cell, formatPence(line.unitPricePence)),
          text(cell, `${line.vatRatePercent}%`),
          text(cell, formatPence(line.subtotalPence)),
        ),
      ),
      h(
        View,
        { style: summary, wrap: false },
        ...vatSummary.map((vatRow) =>
          h(
            View,
            { key: vatRow.vatRatePercent, style: row },
            text(description, `VAT at ${vatRow.vatRatePercent}% on ${formatPence(vatRow.netPence)}`),
            text(cell, formatPence(vatRow.vatPence)),
          ),
        ),
        h(View, { style: row }, text(description, 'Subtotal'), text(cell, formatPence(invoice.subtotalPence))),
        h(View, { style: row }, text(description, 'VAT'), text(cell, formatPence(invoice.vatPence))),
        text(totalDue, `Total due: ${formatPence(invoice.totalPence)}`),
      ),
      h(
        View,
        { style: section },
        text(heading, 'Payment instructions'),
        labelled('Bank: ', seller.paymentBankName),
        labelled('Sort code: ', seller.paymentSortCode),
        labelled('Account number: ', seller.paymentAccountNumber),
      ),
      invoice.notes
        ? h(View, { style: section }, text(heading, 'Notes'), h(Text, null, invoice.notes))
        : null,
    ),
  );
}

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(InvoiceDocument(data));
}
