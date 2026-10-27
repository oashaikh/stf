import { and, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { auditEvents, invoiceLines, invoices, users } from '../../server/src/db/schema.js';
import { INVOICE_VAT_RATES, invoiceTotals, lineTotals, type Totals } from '../../src/lib/invoiceMaths.js';
import type { VatRate } from '../../src/lib/vat.js';
import { db } from './db.js';
import { isoDate } from './entries.js';

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
  /** Draft invoices only. Returns undefined when the invoice is not the owner's or is voided; throws InvoiceRuleError 409 when not a draft. */
  update(userId: string, invoiceId: string, body: DraftInvoiceBody): Promise<Invoice | undefined>;
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

async function lockOwnedDraft(tx: Transaction, userId: string, invoiceId: string) {
  const [existing] = await tx
    .select(invoiceColumns)
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId), isNull(invoices.deletedAt)))
    .limit(1)
    .for('update');
  if (!existing) return undefined;
  if (existing.status !== 'draft') throw new InvoiceRuleError(409, 'CONFLICT', 'Only draft invoices can be changed');
  return existing;
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
      const before = await lockOwnedDraft(tx, userId, invoiceId);
      if (!before) return false;
      const now = new Date();
      // Soft delete: the row and its number stay; the counter is never decremented.
      const [after] = await tx
        .update(invoices)
        .set({ status: 'voided', deletedAt: now, updatedAt: now })
        .where(and(eq(invoices.id, invoiceId), eq(invoices.userId, userId)))
        .returning(invoiceColumns);
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'invoice.void',
        resourceType: 'invoice',
        resourceId: invoiceId,
        beforeSnapshot: auditSnapshot(before),
        afterSnapshot: auditSnapshot(after),
        metadata: { reason },
      });
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
    const conditions: Array<SQL | undefined> = [
      eq(invoices.userId, userId),
      // Voided invoices are soft-deleted, so they only appear when asked for by status.
      status === 'voided' ? undefined : isNull(invoices.deletedAt),
      status ? eq(invoices.status, status) : undefined,
      // The cursor keeps the database's microsecond timestamp as text so rows sharing a millisecond are neither repeated nor skipped.
      after
        ? or(
            lt(invoices.createdAt, sql`${after.createdAt}::timestamptz`),
            and(eq(invoices.createdAt, sql`${after.createdAt}::timestamptz`), lt(invoices.id, after.id)),
          )
        : undefined,
    ];
    return db
      .select({ ...invoiceColumns, cursorCreatedAt: sql<string>`${invoices.createdAt}::text` })
      .from(invoices)
      .where(and(...conditions))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(limit);
  },
};
