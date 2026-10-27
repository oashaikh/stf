import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createInvoicesHandler } from '../../invoices';
import { postInvoiceIssue, postInvoicePayment, type InvoicePostingInput } from '../../../src/lib/invoicePostings';
import { buildVatReturnFromLedger, type LedgerLine } from '../../../src/lib/vat';
import type { AuthDeps } from '../auth';
import { InvoiceRuleError, type Invoice, type InvoiceStore } from '../invoices';

const authDeps: AuthDeps = {
  issuer: { verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null), getEmail: async () => 'a@example.com' },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const accountTypes: Record<string, LedgerLine['accountType']> = { income: 'income', vat: 'liability', debtors: 'asset', bank: 'asset' };
const invoiceId = '00000000-0000-4000-8000-000000000001';
const q3 = { start: '2026-07-01', end: '2026-09-30' };
const q4 = { start: '2026-10-01', end: '2026-12-31' };

// Two lines at 20% and one at 0%: net 30000, VAT 4000, gross 34000.
const posting: InvoicePostingInput = {
  lines: [
    { vatRate: 20, netPence: 10_000, vatPence: 2_000 },
    { vatRate: 20, netPence: 10_000, vatPence: 2_000 },
    { vatRate: 0, netPence: 10_000, vatPence: 0 },
  ],
  totalPence: 34_000,
  incomeAccountId: 'income',
  vatControlAccountId: 'vat',
  debtorsAccountId: 'debtors',
  bankAccountId: 'bank',
};

describe('invoice issue and payment through the route, with an in-memory ledger', () => {
  const ledger: LedgerLine[] = [];
  const post = (lines: ReturnType<typeof postInvoiceIssue>, date: string) =>
    ledger.push(...lines.map((line) => ({ date, accountType: accountTypes[line.accountId], amountPence: line.amountPence, vatPence: line.vatPence, status: 'confirmed' as const, deletedAt: null })));
  let status: Invoice['status'] = 'draft';
  const invoice = () => ({ id: invoiceId, status }) as Invoice;

  const store: InvoiceStore = {
    create: async () => invoice(),
    update: async () => undefined,
    void: async () => false,
    get: async () => undefined,
    list: async () => [],
    async issue(userId, id) {
      if (userId !== 'owner' || id !== invoiceId) return undefined;
      if (status !== 'draft') throw new InvoiceRuleError(409, 'CONFLICT', 'Only draft invoices can be issued');
      status = 'sent';
      post(postInvoiceIssue(posting), '2026-09-15');
      return invoice();
    },
    async markPaid(userId, id, paymentDate) {
      if (userId !== 'owner' || id !== invoiceId) return undefined;
      status = 'paid';
      post(postInvoicePayment(posting), paymentDate);
      return invoice();
    },
  };
  const handler = createInvoicesHandler(store, authDeps);
  const act = (action: string, body?: unknown) =>
    handler(new Request(`https://app.test/api/invoices?id=${invoiceId}&action=${action}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: 'stf_session=tok-owner' } }));

  it('puts the net in box 6 and the VAT in box 1 for the issue-date period only, and payment changes no box', async () => {
    expect((await act('issue')).status).toBe(200);
    const issued = buildVatReturnFromLedger(ledger, q3);
    expect(issued.box1).toBe(4_000);
    expect(issued.box6).toBe(30_000);
    expect(buildVatReturnFromLedger(ledger, q4).box6).toBe(0);

    // Paid in the next quarter: the bank and debtors lines are not VAT lines in either period.
    expect((await act('paid', { paymentDate: '2026-10-20' })).status).toBe(200);
    expect(buildVatReturnFromLedger(ledger, q3)).toEqual(issued);
    expect(buildVatReturnFromLedger(ledger, q4)).toMatchObject({ box1: 0, box6: 0 });
  });
});
