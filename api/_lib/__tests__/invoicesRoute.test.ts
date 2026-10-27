import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createInvoicesHandler } from '../../invoices';
import { invoiceTotals, lineTotals } from '../../../src/lib/invoiceMaths';
import type { VatRate } from '../../../src/lib/vat';
import type { AuthDeps } from '../auth';
import { InvoiceRuleError, formatInvoiceNumber, type DraftInvoiceBody, type Invoice, type InvoiceStore } from '../invoices';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const invoiceId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Owner {
  prefix: string;
  next: number;
  vatNumber: string | null;
}
type Stored = Invoice & { userId: string; createdSeq: number };

describe('invoices route', () => {
  let owners: Record<string, Owner>;
  let saved: Stored[];
  let audits: string[];
  // Models the users-row lock: allocation for the same owner runs one at a time, like SELECT ... FOR UPDATE.
  let lockChain: Promise<unknown>;

  const build = (userId: string, body: DraftInvoiceBody, header: Pick<Invoice, 'id' | 'publicNumber' | 'status'>): Invoice => {
    const vat = Boolean(owners[userId].vatNumber);
    const lines = body.lines.map((line, index) => {
      const { netPence, vatPence, totalPence } = lineTotals(line.quantity, line.unitPricePence, line.vatRatePercent as VatRate, vat);
      return { id: `line-${header.id}-${index}`, ...line, subtotalPence: netPence, vatPence, totalPence };
    });
    const totals = invoiceTotals(body.lines.map((line) => ({ quantityScaled: line.quantity, unitPricePence: line.unitPricePence, vatRate: line.vatRatePercent as VatRate })), vat);
    return {
      ...header,
      clientName: body.clientName,
      clientEmail: body.clientEmail,
      clientAddress: body.clientAddress,
      issueDate: body.issueDate,
      dueDate: body.dueDate,
      notes: body.notes,
      subtotalPence: totals.netPence,
      vatPence: totals.vatPence,
      totalPence: totals.totalPence,
      createdAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-01T00:00:00Z'),
      lines,
    } as Invoice;
  };

  const store: InvoiceStore = {
    // Issue and mark-paid routes arrive in a later task.
    issue: async () => undefined,
    markPaid: async () => undefined,
    create(userId, body) {
      const run = lockChain.then(async () => {
        const owner = owners[userId];
        const number = owner.next;
        await Promise.resolve(); // a yield inside the critical section: without the lock, two creates would read the same counter
        owner.next = number + 1;
        const invoice = build(userId, body, { id: invoiceId(100 + saved.length), publicNumber: formatInvoiceNumber(owner.prefix, number), status: 'draft' });
        saved.push({ ...invoice, userId, createdSeq: saved.length });
        audits.push(`${userId}:invoice.create`);
        return invoice;
      });
      lockChain = run.catch(() => undefined);
      return run;
    },
    async update(userId, id, body) {
      const found = saved.find((row) => row.userId === userId && row.id === id && row.status !== 'voided');
      if (!found) return undefined;
      if (found.status !== 'draft') throw new InvoiceRuleError(409, 'CONFLICT', 'Only draft invoices can be changed');
      Object.assign(found, build(userId, body, { id: found.id, publicNumber: found.publicNumber, status: found.status }));
      audits.push(`${userId}:invoice.edit`);
      return found;
    },
    async void(userId, id, reason) {
      const found = saved.find((row) => row.userId === userId && row.id === id && row.status !== 'voided');
      if (!found) return false;
      if (found.status !== 'draft') throw new InvoiceRuleError(409, 'CONFLICT', 'Only draft invoices can be changed');
      found.status = 'voided';
      audits.push(`${userId}:invoice.void:${reason}`);
      return true;
    },
    async get(userId, id) {
      return saved.find((row) => row.userId === userId && row.id === id);
    },
    async list(userId, status, after, limit) {
      return saved
        .filter((row) => row.userId === userId && (status ? row.status === status : row.status !== 'voided'))
        .filter((row) => !after || row.createdSeq < Number(after.createdAt))
        .reverse()
        .slice(0, limit)
        .map((row) => ({ ...row, cursorCreatedAt: String(row.createdSeq) }));
    },
  };

  const handler = createInvoicesHandler(store, authDeps);
  const call = (method: string, body?: unknown, userId?: string, query = '') =>
    handler(
      new Request(`https://app.test/api/invoices${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );
  const valid = {
    clientName: 'Acme Ltd',
    issueDate: '2026-02-01',
    dueDate: '2026-03-01',
    lines: [{ description: 'Consulting', quantity: 15_000, unitPricePence: 10_000, vatRatePercent: 20 }],
  };

  beforeEach(() => {
    owners = {
      owner: { prefix: 'INV-', next: 1, vatNumber: 'GB123456789' },
      novat: { prefix: 'INV-', next: 1, vatNumber: null },
      other: { prefix: 'INV-', next: 1, vatNumber: 'GB123456789' },
    };
    saved = [];
    audits = [];
    lockChain = Promise.resolve();
  });

  it('gives concurrent creates distinct sequential numbers', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => call('POST', valid, 'owner')));
    const numbers = (await Promise.all(responses.map((response) => response.json()))).map((body) => body.invoice.publicNumber);
    expect([...numbers].sort()).toEqual(['INV-0001', 'INV-0002', 'INV-0003', 'INV-0004', 'INV-0005']);
    expect(new Set(numbers).size).toBe(5);
  });

  it('does not free a voided invoice number', async () => {
    const first = (await (await call('POST', valid, 'owner')).json()).invoice;
    expect((await call('DELETE', { reason: 'Wrong client' }, 'owner', `?id=${first.id}`)).status).toBe(200);
    const next = (await (await call('POST', valid, 'owner')).json()).invoice;
    expect(next.publicNumber).toBe('INV-0002');
    const voided = (await (await call('GET', undefined, 'owner', '?status=voided')).json()).invoices;
    expect(voided.map((row: Invoice) => row.publicNumber)).toEqual(['INV-0001']);
    expect(audits).toContain('owner:invoice.void:Wrong client');
  });

  it('ignores client-sent totals, number and status', async () => {
    const response = await call('POST', { ...valid, subtotalPence: 1, vatPence: 1, totalPence: 1, publicNumber: 'HACK-1', public_number: 'HACK-1', status: 'paid' }, 'owner');
    const { invoice } = await response.json();
    expect(invoice).toMatchObject({ subtotalPence: 15_000, vatPence: 3_000, totalPence: 18_000, publicNumber: 'INV-0001', status: 'draft' });
  });

  it('applies VAT only when the owner has a VAT number', async () => {
    const withVat = (await (await call('POST', valid, 'owner')).json()).invoice;
    const withoutVat = (await (await call('POST', valid, 'novat')).json()).invoice;
    expect(withVat.vatPence).toBe(3_000);
    expect(withoutVat).toMatchObject({ vatPence: 0, totalPence: 15_000 });
    expect(withoutVat.lines[0].vatPence).toBe(0);
  });

  it('recomputes totals on edit and keeps the number', async () => {
    const created = (await (await call('POST', valid, 'owner')).json()).invoice;
    const edited = { ...valid, totalPence: 5, publicNumber: 'X', lines: [{ description: 'More', quantity: 20_000, unitPricePence: 10_000, vatRatePercent: 5 }] };
    const response = await call('PUT', edited, 'owner', `?id=${created.id}`);
    const { invoice } = await response.json();
    expect(invoice).toMatchObject({ publicNumber: 'INV-0001', subtotalPence: 20_000, vatPence: 1_000, totalPence: 21_000 });
    expect(audits).toEqual(['owner:invoice.create', 'owner:invoice.edit']);
  });

  it('refuses to edit or void an invoice that is no longer a draft', async () => {
    const created = (await (await call('POST', valid, 'owner')).json()).invoice;
    saved[0].status = 'sent';
    const edit = await call('PUT', valid, 'owner', `?id=${created.id}`);
    expect(edit.status).toBe(409);
    expect((await edit.json()).code).toBe('CONFLICT');
    expect((await call('DELETE', { reason: 'x' }, 'owner', `?id=${created.id}`)).status).toBe(409);
  });

  it('gives a second user 404 on another owner\'s invoice and an empty list', async () => {
    const created = (await (await call('POST', valid, 'owner')).json()).invoice;
    const query = `?id=${created.id}`;
    expect((await call('GET', undefined, 'other', query)).status).toBe(404);
    expect((await call('PUT', valid, 'other', query)).status).toBe(404);
    expect((await call('DELETE', { reason: 'x' }, 'other', query)).status).toBe(404);
    expect((await (await call('GET', undefined, 'other')).json()).invoices).toEqual([]);
    expect(saved[0].status).toBe('draft');
  });

  it('fetches one invoice with its lines', async () => {
    const created = (await (await call('POST', valid, 'owner')).json()).invoice;
    const { invoice } = await (await call('GET', undefined, 'owner', `?id=${created.id}`)).json();
    expect(invoice.lines).toHaveLength(1);
  });

  it('filters the list by status and pages with a capped limit', async () => {
    for (let n = 0; n < 3; n += 1) await call('POST', valid, 'owner');
    saved[1].status = 'sent';
    const sent = (await (await call('GET', undefined, 'owner', '?status=sent')).json()).invoices;
    expect(sent.map((row: Invoice) => row.publicNumber)).toEqual(['INV-0002']);

    const firstPage = await (await call('GET', undefined, 'owner', '?limit=1')).json();
    expect(firstPage.invoices.map((row: Invoice) => row.publicNumber)).toEqual(['INV-0003']);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await (await call('GET', undefined, 'owner', `?limit=2&cursor=${firstPage.nextCursor}`)).json();
    expect(secondPage.invoices.map((row: Invoice) => row.publicNumber)).toEqual(['INV-0002', 'INV-0001']);
    expect(secondPage.nextCursor).toBeNull();

    const listSpy = vi.spyOn(store, 'list');
    await call('GET', undefined, 'owner', '?limit=100000');
    expect(listSpy.mock.calls[0][3]).toBe(101);
    listSpy.mockRestore();
  });

  it('refuses unauthenticated requests', async () => {
    expect((await call('POST', valid)).status).toBe(401);
    expect((await call('GET')).status).toBe(401);
    expect((await call('DELETE', { reason: 'x' }, undefined, `?id=${invoiceId(1)}`)).status).toBe(401);
  });

  it('refuses bad bodies, ids, cursors and methods', async () => {
    const noLines = await call('POST', { ...valid, lines: [] }, 'owner');
    expect(noLines.status).toBe(400);
    expect((await noLines.json()).fields).toEqual(['lines']);
    expect((await call('POST', { ...valid, lines: [{ ...valid.lines[0], vatRatePercent: 17 }] }, 'owner')).status).toBe(400);
    expect((await call('POST', { ...valid, dueDate: '2026-01-01' }, 'owner')).status).toBe(400);
    expect((await call('POST', undefined, 'owner')).status).toBe(400);
    expect((await call('GET', undefined, 'owner', '?id=nope')).status).toBe(400);
    expect((await call('DELETE', {}, 'owner', `?id=${invoiceId(1)}`)).status).toBe(400);
    expect((await call('GET', undefined, 'owner', '?cursor=garbage')).status).toBe(400);
    expect((await call('GET', undefined, 'owner', '?status=bogus')).status).toBe(400);
    expect((await call('PATCH', valid, 'owner', `?id=${invoiceId(1)}`)).status).toBe(405);
    expect(saved).toEqual([]);
  });
});
