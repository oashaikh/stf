import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer';

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

// Server-side only: no fast refresh, so the component-export rule does not apply.
// eslint-disable-next-line react-refresh/only-export-components
function InvoiceDocument({ invoice, seller, vatSummary }: InvoicePdfData) {
  return (
    <Document title={`Invoice ${invoice.publicNumber}`}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Invoice {invoice.publicNumber}</Text>

        <View style={styles.section}>
          {seller.businessName ? <Text style={styles.heading}>{seller.businessName}</Text> : null}
          {seller.businessAddress ? <Text>{seller.businessAddress}</Text> : null}
          {seller.vatNumber ? <Text>VAT number: {seller.vatNumber}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Bill to</Text>
          <Text>{invoice.clientName}</Text>
          {invoice.clientEmail ? <Text>{invoice.clientEmail}</Text> : null}
          {invoice.clientAddress ? <Text>{invoice.clientAddress}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text>Issue date: {formatDate(invoice.issueDate)}</Text>
          <Text>Due date: {formatDate(invoice.dueDate)}</Text>
        </View>

        <View style={[styles.row, styles.headerRow]}>
          <Text style={styles.description}>Description</Text>
          <Text style={styles.cell}>Qty</Text>
          <Text style={styles.cell}>Unit price</Text>
          <Text style={styles.cell}>VAT rate</Text>
          <Text style={styles.cell}>Net</Text>
        </View>
        {invoice.lines.map((line) => (
          <View key={line.id} style={styles.row} wrap={false}>
            <Text style={styles.description}>{line.description}</Text>
            <Text style={styles.cell}>{formatQuantity(line.quantity)}</Text>
            <Text style={styles.cell}>{formatPence(line.unitPricePence)}</Text>
            <Text style={styles.cell}>{line.vatRatePercent}%</Text>
            <Text style={styles.cell}>{formatPence(line.subtotalPence)}</Text>
          </View>
        ))}

        <View style={styles.summary} wrap={false}>
          {vatSummary.map((row) => (
            <View key={row.vatRatePercent} style={styles.row}>
              <Text style={styles.description}>
                VAT at {row.vatRatePercent}% on {formatPence(row.netPence)}
              </Text>
              <Text style={styles.cell}>{formatPence(row.vatPence)}</Text>
            </View>
          ))}
          <View style={styles.row}>
            <Text style={styles.description}>Subtotal</Text>
            <Text style={styles.cell}>{formatPence(invoice.subtotalPence)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.description}>VAT</Text>
            <Text style={styles.cell}>{formatPence(invoice.vatPence)}</Text>
          </View>
          <Text style={styles.totalDue}>Total due: {formatPence(invoice.totalPence)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Payment instructions</Text>
          {seller.paymentBankName ? <Text>Bank: {seller.paymentBankName}</Text> : null}
          {seller.paymentSortCode ? <Text>Sort code: {seller.paymentSortCode}</Text> : null}
          {seller.paymentAccountNumber ? <Text>Account number: {seller.paymentAccountNumber}</Text> : null}
        </View>

        {invoice.notes ? (
          <View style={styles.section}>
            <Text style={styles.heading}>Notes</Text>
            <Text>{invoice.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

export function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument {...data} />);
}
