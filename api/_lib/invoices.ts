import { and, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { accounts, auditEvents, invoiceLines, invoices, transactionLines, transactions, users } from '../../server/src/db/schema.js';
import { BANK_ACCOUNT_CODE, SALES_ACCOUNT_CODE, TRADE_DEBTORS_CODE, VAT_CONTROL_CODE } from '../../src/lib/chartOfAccounts.js';
import { INVOICE_VAT_RATES, invoiceTotals, lineTotals, type Totals } from '../../src/lib/invoiceMaths.js';
import { postInvoiceIssue, postInvoicePayment } from '../../src/lib/invoicePostings.js';
import type { PostedLine } from '../../src/lib/postingRules.js';
import type { VatRate } from '../../src/lib/vat.js';
import { databaseAccountStore } from './accounts.js';
import { db } from './db.js';
import { MAX_DAYS_AHEAD, PERIOD_LOCKED_MESSAGE, databaseEntryStore, isoDate, voidLiveEntry } from './entries.js';

export const INVOICE_MAX_LINES = 50;
export const INVOICE_LIST_DEFAULT_PAGE = 25;
export const INVOICE_LIST_MAX_PAGE = 100;
const INT32_MAX = 2_147_483_647;
const NUMBER_PAD = 4;

export class InvoiceRuleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const optionalText = (max: number) =>
  z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.string().trim().max(max).nullish().transform((value) => value ?? null));

const lineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  // Scaled x10000. The caps keep quantity x price below 2^53 before the total check runs.
  quantity: z.number().int().min(1).max(100_000_000),
  unitPricePence: z.number().int().min(0).max(10_000_000),
  vatRatePercent: z.number().refine((rate): rate is VatRate => (INVOICE_VAT_RATES as readonly number[]).includes(rate), 'VAT rate must be 0, 5 or 20'),
});

// Plain z.object strips unknown keys, so client-sent totals, public_number and status never reach the store.
export const draftInvoiceSchema = z
  .object({
    clientName: z.string().trim().min(1).max(200),
    clientEmail: optionalText(254),
    clientAddress: optionalText(500),
    issueDate: isoDate,
    dueDate: isoDate,
    notes: optionalText(2000),
    lines: z.array(lineSchema).min(1).max(INVOICE_MAX_LINES),
  })
  .refine((body) => body.dueDate >= body.issueDate, { message: 'Due date is before the issue date', path: ['dueDate'] })
  // Worst case is VAT at 20% on every line; a total that fits then fits whatever the owner's VAT status.
  .refine(
    (body) =>
      invoiceTotals(
        body.lines.map((line) => ({ quantityScaled: line.quantity, unitPricePence: line.unitPricePence, vatRate: line.vatRatePercent as VatRate })),
        true,
      ).totalPence <= INT32_MAX,
    { message: 'Invoice total is too large', path: ['lines'] },
  );

export type DraftInvoiceBody = z.infer<typeof draftInvoiceSchema>;

// Strips unknown keys, so a client cannot send status, totals or account ids.
export const markPaidSchema = z.object({ paymentDate: isoDate });

export const voidInvoiceSchema = z.object({ reason: z.string().trim().min(1).max(200) });

export const invoiceListQuerySchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'overdue', 'voided']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).transform((value) => Math.min(value, INVOICE_LIST_MAX_PAGE)).default(INVOICE_LIST_DEFAULT_PAGE),
});

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'voided';

export interface InvoiceCursor {
  createdAt: string;
  id: string;
}

export const encodeInvoiceCursor = (cursor: InvoiceCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export function decodeInvoiceCursor(value: string): InvoiceCursor | undefined {
  try {
    const parsed = z.object({ createdAt: z.string().min(1).max(40), id: z.string().uuid() }).safeParse(JSON.parse(Buffer.from(value, 'base64url').toString()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const invoiceColumns = {
  id: invoices.id,
  publicNumber: invoices.publicNumber,
  clientName: invoices.clientName,
  clientEmail: invoices.clientEmail,
  clientAddress: invoices.clientAddress,
  issueDate: invoices.issueDate,
  dueDate: invoices.dueDate,
  status: invoices.status,
  subtotalPence: invoices.subtotalPence,
  vatPence: invoices.vatPence,
  totalPence: invoices.totalPence,
  notes: invoices.notes,
  createdAt: invoices.createdAt,
  updatedAt: invoices.updatedAt,
};

const lineColumns = {
  id: invoiceLines.id,
  description: invoiceLines.description,
  quantity: invoiceLines.quantity,
  unitPricePence: invoiceLines.unitPricePence,
  vatRatePercent: invoiceLines.vatRatePercent,
  subtotalPence: invoiceLines.subtotalPence,
  vatPence: invoiceLines.vatPence,
  totalPence: invoiceLines.totalPence,
};

type InvoiceHeader = Pick<typeof invoices.$inferSelect, keyof typeof invoiceColumns>;
type InvoiceLine = Pick<typeof invoiceLines.$inferSelect, keyof typeof lineColumns>;

export type Invoice = InvoiceHeader & { lines: InvoiceLine[] };
export type InvoiceListRow = InvoiceHeader & { cursorCreatedAt: string };

export interface InvoiceStore {
  create(userId: string, body: DraftInvoiceBody): Promise<Invoice>;
  /** Draft to sent: locks editing and posts the income dated the issue date. Undefined when not the owner's; 409 when not a draft; 409 PERIOD_LOCKED. */
  issue(userId: string, invoiceId: string): Promise<Invoice | undefined>;
  /** Sent to paid: posts debtors to bank dated paymentDate. Undefined when not the owner's; 409 when not sent. */
  markPaid(userId: string, invoiceId: string, paymentDate: string): Promise<Invoice | undefined>;
  /** Draft invoices only. Returns undefined when the invoice is not the owner's or is voided; throws InvoiceRuleError 409 when not a draft. */
  update(userId: string, invoiceId: string, body: DraftInvoiceBody): Promise<Invoice | undefined>;
  /** Drafts, and issued or paid invoices (their postings are voided too; 409 PERIOD_LOCKED inside a confirmed or filed period). */
  void(userId: string, invoiceId: string, reason: string): Promise<boolean>;
  get(userId: string, invoiceId: string): Promise<Invoice | undefined>;
  /** At most `limit` rows, newest first by (created_at, id), after the cursor. */
  list(userId: string, status: InvoiceStatus | undefined, after: InvoiceCursor | undefined, limit: number): Promise<InvoiceListRow[]>;
}

/** Fetches one extra row to learn whether another page exists, then trims it. */
export async function listInvoices(store: InvoiceStore, userId: string, status: InvoiceStatus | undefined, after: InvoiceCursor | undefined, limit: number) {
  const rows = await store.list(userId, status, after, limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { invoices: page, nextCursor: rows.length > limit && last ? encodeInvoiceCursor({ createdAt: last.cursorCreatedAt, id: last.id }) : null };
}

/** Overdue is derived at read time and never stored, so no job has to keep it in step. */
export const deriveInvoiceStatus = (status: InvoiceStatus, dueDate: string, today: string): InvoiceStatus =>
  status === 'sent' && dueDate < today ? 'overdue' : status;

export function assertPaymentDateAllowed(issueDate: string, paymentDate: string, now: Date): void {
  if (paymentDate < issueDate) throw new InvoiceRuleError(400, 'BAD_REQUEST', 'Payment date is before the issue date');
  const latest = new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
  if (paymentDate > latest) throw new InvoiceRuleError(400, 'BAD_REQUEST', `Payment date cannot be more than ${MAX_DAYS_AHEAD} days ahead`);
}

export const formatInvoiceNumber = (prefix: string, number: number) => `${prefix}${String(number).padStart(NUMBER_PAD, '0')}`;

// Ids, number, status and totals only: client name, email and address stay out of the audit trail.
const auditSnapshot = (invoice: Pick<InvoiceHeader, 'id' | 'publicNumber' | 'status' | 'subtotalPence' | 'vatPence' | 'totalPence'>) => ({
  id: invoice.id,
  publicNumber: invoice.publicNumber,
  status: invoice.status,
  subtotalPence: invoice.subtotalPence,
  vatPence: invoice.vatPence,
  totalPence: invoice.totalPence,
});

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Totals and line values are always derived here; the body carries no totals.
function computeLines(body: DraftInvoiceBody, ownerHasVatNumber: boolean) {
  const lines = body.lines.map((line) => {
    const { netPence, vatPence, totalPence } = lineTotals(line.quantity, line.unitPricePence, line.vatRatePercent as VatRate, ownerHasVatNumber);
    return { ...line, subtotalPence: netPence, vatPence, totalPence };
  });
  const totals: Totals = invoiceTotals(
    body.lines.map((line) => ({ quantityScaled: line.quantity, unitPricePence: line.unitPricePence, vatRate: line.vatRatePercent as VatRate })),
    ownerHasVatNumber,
  );
  return { lines, totals };
}

async function readLines(tx: Pick<typeof db, 'select'>, invoiceId: string): Promise<InvoiceLine[]> {
  return tx.select(lineColumns).from(invoiceLines).where(and(eq(invoiceLines.invoiceId, invoiceId), isNull(invoiceLines.deletedAt))).limit(INVOICE_MAX_LINES);
}

const postingLinkColumns = { transactionId: invoices.transactionId, paymentTransactionId: invoices.paymentTransactionId };

async function lockOwnedInvoice(tx: Transaction, userId: string, invoiceId: string) {
  const [existing] = await tx
    .select({ ...invoiceColumns, ...postingLinkColumns })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId), isNull(invoices.deletedAt)))
    .limit(1)
    .for('update');
  return existing;
}

async function lockOwnedDraft(tx: Transaction, userId: string, invoiceId: string) {
  const existing = await lockOwnedInvoice(tx, userId, invoiceId);
  if (existing && existing.status !== 'draft') throw new InvoiceRuleError(409, 'CONFLICT', 'Only draft invoices can be changed');
  return existing;
}

async function assertDateOpen(userId: string, date: string) {
  if (await databaseEntryStore.isDateLocked(userId, date)) throw new InvoiceRuleError(409, 'PERIOD_LOCKED', PERIOD_LOCKED_MESSAGE);
}

async function loadAccountIds(tx: Transaction, userId: string) {
  const rows = await tx
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.code, [SALES_ACCOUNT_CODE, BANK_ACCOUNT_CODE, TRADE_DEBTORS_CODE, VAT_CONTROL_CODE])))
    .limit(4);
  const idOf = (code: string) => {
    const found = rows.find((row) => row.code === code);
    if (!found) throw new Error('System account missing');
    return found.id;
  };
  return {
    incomeAccountId: idOf(SALES_ACCOUNT_CODE),
    bankAccountId: idOf(BANK_ACCOUNT_CODE),
    debtorsAccountId: idOf(TRADE_DEBTORS_CODE),
    vatControlAccountId: idOf(VAT_CONTROL_CODE),
  };
}

async function insertPosting(tx: Transaction, userId: string, date: string, description: string, lines: PostedLine[]) {
  const [row] = await tx.insert(transactions).values({ userId, date, description, source: 'manual', status: 'confirmed' }).returning({ id: transactions.id });
  await tx.insert(transactionLines).values(
    lines.map((line) => ({ transactionId: row.id, accountId: line.accountId, amountPence: line.amountPence, vatPence: line.vatPence, vatRatePercent: line.vatRatePercent ?? 0 })),
  );
  return row.id;
}

async function writeAudit(tx: Transaction, userId: string, action: string, invoiceId: string, before: Parameters<typeof auditSnapshot>[0], after: Parameters<typeof auditSnapshot>[0], metadata?: object) {
  await tx.insert(auditEvents).values({
    userId,
    actorType: 'user',
    action,
    resourceType: 'invoice',
    resourceId: invoiceId,
    beforeSnapshot: auditSnapshot(before),
    afterSnapshot: auditSnapshot(after),
    metadata,
  });
}

async function withPostingInput(tx: Transaction, userId: string, invoice: Pick<InvoiceHeader, 'id' | 'totalPence'>) {
  const lines = await readLines(tx, invoice.id);
  return {
    lines: lines.map((line) => ({ vatRate: line.vatRatePercent as VatRate, netPence: line.subtotalPence, vatPence: line.vatPence })),
    totalPence: invoice.totalPence,
    ...(await loadAccountIds(tx, userId)),
  };
}

// Query audit: every query filters on user_id (or users.id) from the session and has an explicit limit.
// The list is served by invoices_user_created_idx (user_id, created_at, id); a lookup by id uses the primary
// key plus the user_id predicate; lines are read by invoice_lines_invoice_id_idx, bounded by INVOICE_MAX_LINES.
// The users row lock serialises number allocation per owner; no network calls run inside a transaction.
export const databaseInvoiceStore: InvoiceStore = {
  async create(userId, body) {
    return db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ invoicePrefix: users.invoicePrefix, nextInvoiceNumber: users.nextInvoiceNumber, vatNumber: users.vatNumber })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
        .for('update');
      if (!owner) throw new InvoiceRuleError(404, 'NOT_FOUND', 'Owner not found');
      // The counter only ever moves forward, so a voided invoice's number is never handed out again.
      await tx.update(users).set({ nextInvoiceNumber: owner.nextInvoiceNumber + 1 }).where(eq(users.id, userId));

      const { lines, totals } = computeLines(body, Boolean(owner.vatNumber));
      const [header] = await tx
        .insert(invoices)
        .values({
          userId,
          publicNumber: formatInvoiceNumber(owner.invoicePrefix, owner.nextInvoiceNumber),
          clientName: body.clientName,
          clientEmail: body.clientEmail,
          clientAddress: body.clientAddress,
          issueDate: body.issueDate,
          dueDate: body.dueDate,
          status: 'draft',
          subtotalPence: totals.netPence,
          vatPence: totals.vatPence,
          totalPence: totals.totalPence,
          notes: body.notes,
        })
        .returning(invoiceColumns);
      const savedLines = await tx.insert(invoiceLines).values(lines.map((line) => ({ ...line, invoiceId: header.id }))).returning(lineColumns);
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'invoice.create',
        resourceType: 'invoice',
        resourceId: header.id,
        afterSnapshot: auditSnapshot(header),
      });
      return { ...header, lines: savedLines };
    });
  },

  async issue(userId, invoiceId) {
    // Idempotent, and kept outside the transaction like loadPostingContext does.
    await databaseAccountStore.seedDefaults(userId);
    return db.transaction(async (tx) => {
      const before = await lockOwnedDraft(tx, userId, invoiceId);
      if (!before) return undefined;
      await assertDateOpen(userId, before.issueDate);
      const postingLines = postInvoiceIssue(await withPostingInput(tx, userId, before));
      const transactionId = await insertPosting(tx, userId, before.issueDate, `Invoice ${before.publicNumber}`, postingLines);
      const [after] = await tx
        .update(invoices)
        .set({ status: 'sent', transactionId, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
        .returning(invoiceColumns);
      await writeAudit(tx, userId, 'invoice.issue', invoiceId, before, after, { transactionId });
      return { ...after, lines: await readLines(tx, invoiceId) };
    });
  },

  async markPaid(userId, invoiceId, paymentDate) {
    return db.transaction(async (tx) => {
      const before = await lockOwnedInvoice(tx, userId, invoiceId);
      if (!before) return undefined;
      if (before.status !== 'sent') throw new InvoiceRuleError(409, 'CONFLICT', 'Only a sent invoice can be marked paid');
      assertPaymentDateAllowed(before.issueDate, paymentDate, new Date());
      await assertDateOpen(userId, paymentDate);
      const postingLines = postInvoicePayment(await withPostingInput(tx, userId, before));
      const paymentTransactionId = await insertPosting(tx, userId, paymentDate, `Payment of invoice ${before.publicNumber}`, postingLines);
      const [after] = await tx
        .update(invoices)
        .set({ status: 'paid', paymentTransactionId, updatedAt: new Date() })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
        .returning(invoiceColumns);
      await writeAudit(tx, userId, 'invoice.paid', invoiceId, before, after, { paymentTransactionId, paymentDate });
      return { ...after, lines: await readLines(tx, invoiceId) };
    });
  },

  async update(userId, invoiceId, body) {
    return db.transaction(async (tx) => {
      const before = await lockOwnedDraft(tx, userId, invoiceId);
      if (!before) return undefined;
      const [owner] = await tx.select({ vatNumber: users.vatNumber }).from(users).where(eq(users.id, userId)).limit(1);
      const { lines, totals } = computeLines(body, Boolean(owner?.vatNumber));

      // Replaced lines are soft-deleted, not removed, so the previous line content stays on record.
      await tx
        .update(invoiceLines)
        .set({ deletedAt: new Date() })
        .where(and(eq(invoiceLines.invoiceId, invoiceId), isNull(invoiceLines.deletedAt)));
      const savedLines = await tx.insert(invoiceLines).values(lines.map((line) => ({ ...line, invoiceId }))).returning(lineColumns);
      // public_number is deliberately absent from the update set.
      const [after] = await tx
        .update(invoices)
        .set({
          clientName: body.clientName,
          clientEmail: body.clientEmail,
          clientAddress: body.clientAddress,
          issueDate: body.issueDate,
          dueDate: body.dueDate,
          notes: body.notes,
          subtotalPence: totals.netPence,
          vatPence: totals.vatPence,
          totalPence: totals.totalPence,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
        .returning(invoiceColumns);
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'invoice.edit',
        resourceType: 'invoice',
        resourceId: invoiceId,
        beforeSnapshot: auditSnapshot(before),
        afterSnapshot: auditSnapshot(after),
      });
      return { ...after, lines: savedLines };
    });
  },

  async void(userId, invoiceId, reason) {
    return db.transaction(async (tx) => {
      const before = await lockOwnedInvoice(tx, userId, invoiceId);
      if (!before) return false;
      const postingIds = [before.transactionId, before.paymentTransactionId].filter((id): id is string => id !== null);
      if (postingIds.length > 0) {
        // Every posting date is checked before anything is voided, so a locked period changes nothing.
        const postings = await tx
          .select({ date: transactions.date })
          .from(transactions)
          .where(and(inArray(transactions.id, postingIds), eq(transactions.userId, userId)))
          .limit(2);
        for (const posting of postings) await assertDateOpen(userId, posting.date);
        for (const postingId of postingIds) {
          if (!(await voidLiveEntry(tx, userId, postingId))) throw new InvoiceRuleError(409, 'CONFLICT', 'Invoice posting is already voided');
        }
      }
      const now = new Date();
      // Soft delete: the row and its number stay; the counter is never decremented.
      const [after] = await tx
        .update(invoices)
        .set({ status: 'voided', deletedAt: now, updatedAt: now })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
        .returning(invoiceColumns);
      await writeAudit(tx, userId, 'invoice.void', invoiceId, before, after, { reason });
      return true;
    });
  },

  async get(userId, invoiceId) {
    const [header] = await db
      .select(invoiceColumns)
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
      .limit(1);
    if (!header) return undefined;
    return { ...header, lines: await readLines(db, invoiceId) };
  },

  async list(userId, status, after, limit) {
    const today = new Date().toISOString().slice(0, 10);
    const conditions: Array<SQL | undefined> = [
      eq(invoices.userId, userId),
      // Voided invoices are soft-deleted, so they only appear when asked for by status.
      status === 'voided' ? undefined : isNull(invoices.deletedAt),
      // Overdue is never stored: it is a sent invoice past its due date.
      status === 'overdue' ? and(eq(invoices.status, 'sent'), lt(invoices.dueDate, today)) : status ? eq(invoices.status, status) : undefined,
      // A sent invoice past due shows as overdue, so the sent filter keeps only those not yet due.
      status === 'sent' ? gte(invoices.dueDate, today) : undefined,
      // The cursor keeps the database's microsecond timestamp as text so rows sharing a millisecond are neither repeated nor skipped.
      after
        ? or(
            lt(invoices.createdAt, sql`${after.createdAt}::timestamptz`),
            and(eq(invoices.createdAt, sql`${after.createdAt}::timestamptz`), lt(invoices.id, after.id)),
          )
        : undefined,
    ];
    const rows = await db
      .select({ ...invoiceColumns, cursorCreatedAt: sql<string>`${invoices.createdAt}::text` })
      .from(invoices)
      .where(and(...conditions))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(limit);
    return rows.map((row) => ({ ...row, status: deriveInvoiceStatus(row.status, row.dueDate, today) }));
  },
};
