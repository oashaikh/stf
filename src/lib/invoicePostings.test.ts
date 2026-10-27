import { describe, expect, it } from 'vitest';
import { postInvoiceIssue, postInvoicePayment, type InvoicePostingInput } from './invoicePostings.js';
import { lineTotals } from './invoiceMaths.js';
import { buildVatReturnFromLedger, type LedgerLine, type VatRate } from './vat.js';

const accountIds = { incomeAccountId: 'income', vatControlAccountId: 'vat', debtorsAccountId: 'debtors', bankAccountId: 'bank' };
const issuePeriod = { start: '2026-07-01', end: '2026-09-30' };
const otherPeriod = { start: '2026-10-01', end: '2026-12-31' };
const accountTypes: Record<string, LedgerLine['accountType']> = {
  income: 'income', vat: 'liability', debtors: 'asset', bank: 'asset',
};

function invoiceFrom(specs: [number, number, VatRate][]): InvoicePostingInput {
  const lines = specs.map(([quantityScaled, unitPricePence, vatRate]) => {
    const t = lineTotals(quantityScaled, unitPricePence, vatRate, true);
    return { vatRate, netPence: t.netPence, vatPence: t.vatPence };
  });
  const sum = (pick: (l: (typeof lines)[number]) => number) => lines.reduce((s, l) => s + pick(l), 0);
  return { lines, totalPence: sum((l) => l.netPence + l.vatPence), ...accountIds };
}

function ledgerOf(posted: ReturnType<typeof postInvoiceIssue>, date: string): LedgerLine[] {
  return posted.map((l) => ({
    date, accountType: accountTypes[l.accountId], amountPence: l.amountPence,
    vatPence: l.vatPence, status: 'confirmed', deletedAt: null,
  }));
}

const mixed = invoiceFrom([[10000, 10000, 20], [15000, 3333, 5], [10000, 2500, 0], [30000, 1999, 20]]);
const sum = (lines: { amountPence: number }[]) => lines.reduce((s, l) => s + l.amountPence, 0);

describe('postInvoiceIssue', () => {
  it('posts one income line per VAT rate and a single debtors debit for the gross', () => {
    const posted = postInvoiceIssue(mixed);
    expect(posted.filter((l) => l.accountId === 'income').map((l) => l.vatRatePercent).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 5, 20]);
    expect(posted.filter((l) => l.accountId === 'debtors')).toEqual([
      { accountId: 'debtors', amountPence: mixed.totalPence, vatPence: 0, vatRatePercent: null },
    ]);
    expect(posted.filter((l) => l.accountId === 'vat')).toHaveLength(2);
  });

  it('sums to zero for mixed-rate and zero-VAT invoices', () => {
    const zeroVat = invoiceFrom([[10000, 1234, 0]]);
    expect(sum(postInvoiceIssue(mixed))).toBe(0);
    expect(sum(postInvoiceIssue(zeroVat))).toBe(0);
    expect(postInvoiceIssue(zeroVat)).toHaveLength(2);
  });

  it('keeps the per-line rounded VAT even where VAT on the group net would differ by a penny', () => {
    // three lines of 0.10 at 5% round to 1p each (3p); VAT on the 30p group net is 2p
    const rounding = invoiceFrom([[10000, 10, 5], [10000, 10, 5], [10000, 10, 5]]);
    const vatControl = postInvoiceIssue(rounding).find((l) => l.accountId === 'vat');
    expect(vatControl?.amountPence).toBe(-3);
    expect(sum(postInvoiceIssue(rounding))).toBe(0);
  });

  it('gives box 1 as the invoice VAT and box 6 as the net, for the issue-date period only', () => {
    const ledger = ledgerOf(postInvoiceIssue(mixed), '2026-08-15');
    const netTotal = mixed.lines.reduce((s, l) => s + l.netPence, 0);
    const vatTotal = mixed.lines.reduce((s, l) => s + l.vatPence, 0);
    const inPeriod = buildVatReturnFromLedger(ledger, issuePeriod);
    expect(inPeriod.box1).toBe(vatTotal);
    expect(inPeriod.box6).toBe(netTotal);
    const elsewhere = buildVatReturnFromLedger(ledger, otherPeriod);
    expect(elsewhere.box1).toBe(0);
    expect(elsewhere.box6).toBe(0);
  });

  it('rejects non-integer pence', () => {
    expect(() => postInvoiceIssue({ ...mixed, totalPence: 1.5 })).toThrow(/integer/);
  });
});

describe('postInvoicePayment', () => {
  it('debits bank and credits debtors for the total, with no VAT or category lines', () => {
    expect(postInvoicePayment(mixed)).toEqual([
      { accountId: 'bank', amountPence: mixed.totalPence, vatPence: 0, vatRatePercent: null },
      { accountId: 'debtors', amountPence: -mixed.totalPence, vatPence: 0, vatRatePercent: null },
    ]);
  });

  it('leaves all nine boxes unchanged when added to the issue postings', () => {
    const issued = ledgerOf(postInvoiceIssue(mixed), '2026-08-15');
    const paid = ledgerOf(postInvoicePayment(mixed), '2026-10-20');
    for (const period of [issuePeriod, otherPeriod]) {
      expect(buildVatReturnFromLedger([...issued, ...paid], period)).toEqual(buildVatReturnFromLedger(issued, period));
    }
  });
});
