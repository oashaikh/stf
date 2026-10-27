/**
 * Invoice postings — STF
 *
 * Pure functions turning an invoice into balanced ledger lines. Signs follow
 * architectures.md: debit positive, credit negative. Income is posted on issue against
 * trade debtors (VAT is due by the invoice date); payment only moves debtors to bank.
 *
 * Built from the stored per-line rounded VAT rather than postEntry: postEntry would
 * recompute VAT on each rate group's net, which can differ by a penny from the sum of
 * rounded line VAT and so from the invoice header.
 */

import type { PostedLine } from './postingRules.js';
import type { VatRate } from './vat.js';

export interface InvoicePostingInput {
  lines: { vatRate: VatRate; netPence: number; vatPence: number }[];
  /** Header total; must equal the sum of the lines' net and VAT. */
  totalPence: number;
  incomeAccountId: string;
  vatControlAccountId: string;
  debtorsAccountId: string;
  bankAccountId: string;
}

function assertIntegerPence(...values: number[]): void {
  if (!values.every(Number.isInteger)) {
    throw new Error('invoice amounts must be integer pence');
  }
}

export function postInvoiceIssue(invoice: InvoicePostingInput): PostedLine[] {
  const byRate = new Map<VatRate, { netPence: number; vatPence: number }>();
  for (const line of invoice.lines) {
    assertIntegerPence(line.netPence, line.vatPence);
    const group = byRate.get(line.vatRate) ?? { netPence: 0, vatPence: 0 };
    group.netPence += line.netPence;
    group.vatPence += line.vatPence;
    byRate.set(line.vatRate, group);
  }
  assertIntegerPence(invoice.totalPence);

  const posted: PostedLine[] = [];
  let grossPence = 0;
  for (const [vatRate, group] of byRate) {
    posted.push({ accountId: invoice.incomeAccountId, amountPence: -group.netPence, vatPence: -group.vatPence, vatRatePercent: vatRate });
    if (group.vatPence !== 0) {
      posted.push({ accountId: invoice.vatControlAccountId, amountPence: -group.vatPence, vatPence: 0, vatRatePercent: null });
    }
    grossPence += group.netPence + group.vatPence;
  }
  if (grossPence !== invoice.totalPence) {
    throw new Error('invoice lines do not add up to total_pence');
  }
  posted.push({ accountId: invoice.debtorsAccountId, amountPence: grossPence, vatPence: 0, vatRatePercent: null });
  return posted;
}

export function postInvoicePayment(invoice: InvoicePostingInput): PostedLine[] {
  assertIntegerPence(invoice.totalPence);
  return [
    { accountId: invoice.bankAccountId, amountPence: invoice.totalPence, vatPence: 0, vatRatePercent: null },
    { accountId: invoice.debtorsAccountId, amountPence: -invoice.totalPence, vatPence: 0, vatRatePercent: null },
  ];
}
