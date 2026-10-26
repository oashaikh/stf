import { and, eq, gte, inArray, lte, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import type { ApiError } from '../../src/model/types';
import { accounts, auditEvents, transactionLines, transactions, vatReturnDrafts } from '../../server/src/db/schema.js';
import { buildVatReturnFromLedger, linesForBox, type LedgerLine, type VatReturnBoxes } from '../../src/lib/vat';
import { db } from './db';

export interface Period {
  periodKey: string;
  start: string;
  end: string;
}

export type DrillLine = LedgerLine & { lineId: string; description: string | null };

export interface SavedDraft {
  status: 'draft' | 'confirmed';
  periodStart: string;
  periodEnd: string;
  boxes: VatReturnBoxes;
  confirmedAt: string | null;
}

// Injected like AuthDeps so tests never touch a database. Every method is scoped by userId.
export interface VatReturnStore {
  /** Lines that could count toward the period, one joined query. Throws if over LEDGER_LINE_LIMIT. */
  loadLedgerLines(userId: string, period: Period): Promise<DrillLine[]>;
  findDraft(userId: string, periodKey: string): Promise<SavedDraft | undefined>;
  /** One conditional upsert: a confirmed row is left alone unless `reopen` is set. */
  saveDraft(userId: string, period: Period, boxes: VatReturnBoxes, reopen: boolean): Promise<void>;
  /** Stores the snapshot as confirmed and writes the audit event in one transaction. */
  confirm(userId: string, period: Period, boxes: VatReturnBoxes, now: Date): Promise<void>;
}

// Truncating would silently understate the return, so exceeding this fails loudly instead.
export const LEDGER_LINE_LIMIT = 10000;
const DRILL_DOWN_LINES_PER_BOX = 50;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const periodSchema = z
  .object({ periodKey: z.string().min(1).max(20), start: isoDate, end: isoDate })
  .refine((period) => period.start <= period.end, { message: 'start after end' });

export const saveBodySchema = z.object({ reopen: z.boolean().optional() });
// Boxes in a body are deliberately not part of any schema: the server always recomputes.
export const confirmBodySchema = z.object({ declaration: z.literal(true) });

export class VatReturnError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function vatErrorResponse(status: number, code: string, error: string): Response {
  const body: ApiError = { ok: false, error, code };
  return Response.json(body, { status });
}

export function periodFromQuery(url: URL): Period {
  const parsed = periodSchema.safeParse({
    periodKey: url.searchParams.get('periodKey'),
    start: url.searchParams.get('start'),
    end: url.searchParams.get('end'),
  });
  if (!parsed.success) throw new VatReturnError(400, 'BAD_REQUEST', 'Invalid period');
  return parsed.data;
}

const boxKeys = ['box1', 'box2', 'box3', 'box4', 'box5', 'box6', 'box7', 'box8', 'box9'] as const;
const sameBoxes = (a: VatReturnBoxes, b: VatReturnBoxes) => boxKeys.every((key) => a[key] === b[key]);

function matchesConfirmation(draft: SavedDraft, period: Period, boxes: VatReturnBoxes) {
  return draft.periodStart === period.start && draft.periodEnd === period.end && sameBoxes(boxes, draft.boxes);
}

async function recompute(store: VatReturnStore, userId: string, period: Period) {
  const lines = await store.loadLedgerLines(userId, period);
  return { lines, boxes: buildVatReturnFromLedger(lines, period) };
}

export async function getReturnReview(store: VatReturnStore, userId: string, period: Period) {
  const [{ lines, boxes }, draft] = await Promise.all([
    recompute(store, userId, period),
    store.findDraft(userId, period.periodKey),
  ]);
  const boxLines = boxKeys.map((_, index) => linesForBox(lines, period, (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9));
  const drillDown = Object.fromEntries(
    boxKeys.map((key, index) => [
      key,
      boxLines[index].slice(0, DRILL_DOWN_LINES_PER_BOX).map((line) => ({
        lineId: (line as DrillLine).lineId,
        date: line.date,
        amountPence: line.amountPence,
        vatPence: line.vatPence,
        description: (line as DrillLine).description,
      })),
    ]),
  );
  // Lets the UI say when a drill-down list is cut short and so will not sum to its box.
  const drillDownTotals = Object.fromEntries(boxKeys.map((key, index) => [key, boxLines[index].length]));
  const stale = draft?.status === 'confirmed' && !matchesConfirmation(draft, period, boxes);
  return { boxes, drillDown, drillDownTotals, status: draft?.status ?? null, confirmedAt: draft?.confirmedAt ?? null, stale };
}

export async function saveReturnDraft(store: VatReturnStore, userId: string, period: Period, reopen: boolean) {
  const existing = await store.findDraft(userId, period.periodKey);
  if (existing?.status === 'confirmed' && !reopen) {
    throw new VatReturnError(409, 'ALREADY_CONFIRMED', 'Return is already confirmed; reopen it to edit');
  }
  const { boxes } = await recompute(store, userId, period);
  await store.saveDraft(userId, period, boxes, reopen);
  return { boxes, status: 'draft' as const };
}

export async function confirmReturn(store: VatReturnStore, userId: string, period: Period, now: Date) {
  const { boxes } = await recompute(store, userId, period);
  await store.confirm(userId, period, boxes, now);
  return { boxes, status: 'confirmed' as const };
}

/**
 * The submit gate STF-19 must call before any HMRC submission. Throws unless the stored
 * return is confirmed and the ledger still produces exactly the confirmed boxes.
 */
export async function requireConfirmedReturn(
  userId: string,
  period: Period,
  store: VatReturnStore = databaseStore,
): Promise<VatReturnBoxes> {
  const draft = await store.findDraft(userId, period.periodKey);
  if (draft?.status !== 'confirmed') {
    throw new VatReturnError(409, 'NOT_CONFIRMED', 'VAT return has not been confirmed');
  }
  const { boxes } = await recompute(store, userId, period);
  if (!matchesConfirmation(draft, period, boxes)) {
    throw new VatReturnError(409, 'STALE_CONFIRMATION', 'Ledger or period changed since confirmation; confirm again');
  }
  return draft.boxes;
}

function boxColumns(boxes: VatReturnBoxes) {
  return {
    box1Pence: boxes.box1,
    box2Pence: boxes.box2,
    box3Pence: boxes.box3,
    box4Pence: boxes.box4,
    box5Pence: boxes.box5,
    box6Pence: boxes.box6,
    box7Pence: boxes.box7,
    box8Pence: boxes.box8,
    box9Pence: boxes.box9,
  };
}

export const databaseStore: VatReturnStore = {
  async loadLedgerLines(userId, period) {
    // Filters on transactions.user_id and date; accounts are matched on the same user too.
    const rows = await db
      .select({
        lineId: transactionLines.id,
        date: transactions.date,
        accountType: accounts.accountType,
        amountPence: transactionLines.amountPence,
        vatPence: transactionLines.vatPence,
        status: transactions.status,
        deletedAt: transactions.deletedAt,
        description: transactionLines.description,
      })
      .from(transactionLines)
      .innerJoin(transactions, eq(transactionLines.transactionId, transactions.id))
      .innerJoin(accounts, and(eq(transactionLines.accountId, accounts.id), eq(accounts.userId, userId)))
      .where(
        and(
          eq(transactions.userId, userId),
          isNull(transactions.deletedAt),
          inArray(transactions.status, ['confirmed', 'reconciled']),
          gte(transactions.date, period.start),
          lte(transactions.date, period.end),
        ),
      )
      .limit(LEDGER_LINE_LIMIT + 1);
    if (rows.length > LEDGER_LINE_LIMIT) throw new Error('Ledger too large for one VAT return');
    return rows.map((row) => ({ ...row, deletedAt: row.deletedAt?.toISOString() ?? null }));
  },

  async findDraft(userId, periodKey) {
    const [row] = await db
      .select()
      .from(vatReturnDrafts)
      .where(and(eq(vatReturnDrafts.userId, userId), eq(vatReturnDrafts.periodKey, periodKey)))
      .limit(1);
    if (!row) return undefined;
    return {
      status: row.status,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      boxes: {
        box1: row.box1Pence,
        box2: row.box2Pence,
        box3: row.box3Pence,
        box4: row.box4Pence,
        box5: row.box5Pence,
        box6: row.box6Pence,
        box7: row.box7Pence,
        box8: row.box8Pence,
        box9: row.box9Pence,
      },
    };
  },

  async saveDraft(userId, period, boxes, reopen) {
    const values = {
      ...boxColumns(boxes),
      periodStart: period.start,
      periodEnd: period.end,
      status: 'draft' as const,
      declarationAcceptedAt: null,
      confirmedAt: null,
      updatedAt: new Date(),
    };
    await db
      .insert(vatReturnDrafts)
      .values({ userId, periodKey: period.periodKey, ...values })
      .onConflictDoUpdate({
        target: [vatReturnDrafts.userId, vatReturnDrafts.periodKey],
        set: values,
        setWhere: reopen ? undefined : ne(vatReturnDrafts.status, 'confirmed'),
      });
  },

  async confirm(userId, period, boxes, now) {
    const values = {
      ...boxColumns(boxes),
      periodStart: period.start,
      periodEnd: period.end,
      status: 'confirmed' as const,
      declarationAcceptedAt: now,
      confirmedAt: now,
      updatedAt: now,
    };
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(vatReturnDrafts)
        .values({ userId, periodKey: period.periodKey, ...values })
        .onConflictDoUpdate({ target: [vatReturnDrafts.userId, vatReturnDrafts.periodKey], set: values })
        .returning({ id: vatReturnDrafts.id });
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'vat_return.confirmed',
        resourceType: 'vat_return_draft',
        resourceId: row.id,
        afterSnapshot: { periodKey: period.periodKey, boxes },
      });
    });
  },
};
