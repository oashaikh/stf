import { and, desc, eq, gte, inArray, lte, isNull, ne } from 'drizzle-orm';
import { z } from 'zod';

import type { ApiError } from '../../src/model/types.js';
import {
  accounts,
  auditEvents,
  transactionLines,
  transactions,
  vatReturnDrafts,
  vatSubmissions,
} from '../../server/src/db/schema.js';
import { buildVatReturnFromLedger, linesForBox, type LedgerLine, type VatReturnBoxes } from '../../src/lib/vat.js';
import { db } from './db.js';

export interface Period {
  periodKey: string;
  start: string;
  end: string;
}

export type DrillLine = LedgerLine & { lineId: string; transactionId: string; description: string | null };

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
  findSubmission(userId: string, periodKey: string, sandbox: boolean): Promise<SubmissionLookup | undefined>;
  /**
   * One conditional statement: inserts a pending row, or flips a failed one back to pending.
   * Returns the submission id, or undefined when a pending or submitted row already holds the period.
   */
  claimSubmission(userId: string, periodKey: string, sandbox: boolean): Promise<string | undefined>;
  /** Marks the claim submitted and writes vat_return.submitted in one transaction. Throws if the claim is not pending. */
  recordReceipt(userId: string, submissionId: string, receipt: SubmissionReceipt, audit: SubmissionAudit, now: Date): Promise<void>;
  /** For definite HMRC rejections only: releases the claim and writes vat_return.submit_failed. Ambiguous outcomes must not call this. */
  markFailed(userId: string, submissionId: string, audit: SubmissionAudit): Promise<void>;
  /** The newest HISTORY_LIMIT returns by period end: two queries in all, never one per row. */
  listReturnHistory(userId: string): Promise<HistoryItem[]>;
}

export type HistoryStatus = 'draft' | 'confirmed' | 'submitted' | 'accepted';
export interface HistoryReceipt {
  formBundleNumber: string;
  processingDate: string;
  sandbox: boolean;
}
export interface HistoryItem extends Period {
  status: HistoryStatus;
  boxes: VatReturnBoxes;
  receipt: HistoryReceipt | null;
}

export type SubmissionStatus = 'pending' | 'submitted' | 'failed';
export interface SubmissionLookup {
  status: SubmissionStatus;
  formBundleNumber?: string | null;
  processingDate?: Date | null;
}
export interface SubmissionReceipt {
  formBundleNumber: string;
  processingDate: Date;
}
export interface SubmissionAudit {
  periodKey: string;
  sandbox: boolean;
  request: unknown;
  response: unknown;
  fraudHeaders: Record<string, string>;
}

/** The audit trail keeps the request, the HMRC body and the fraud headers, never credentials. */
export function submissionSnapshot(audit: SubmissionAudit) {
  const fraudHeaders = Object.fromEntries(
    Object.entries(audit.fraudHeaders).filter(([name]) => name.toLowerCase() !== 'authorization'),
  );
  return { ...audit, fraudHeaders };
}

// Truncating would silently understate the return, so exceeding this fails loudly instead.
export const LEDGER_LINE_LIMIT = 10000;
const DRILL_DOWN_LINES_PER_BOX = 50;

export const HISTORY_LIMIT = 40;

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

/** A live filing outranks a sandbox rehearsal; pending and failed attempts have no receipt to show. */
export function pickReceipt(live?: SubmissionLookup, sandbox?: SubmissionLookup): HistoryReceipt | null {
  const filed = [live && { ...live, sandbox: false }, sandbox && { ...sandbox, sandbox: true }].find(
    (row) => row?.status === 'submitted' && row.formBundleNumber && row.processingDate,
  );
  return filed
    ? { formBundleNumber: filed.formBundleNumber!, processingDate: filed.processingDate!.toISOString(), sandbox: filed.sandbox }
    : null;
}

/** Failed attempts are ignored, so the return falls back to its draft or confirmed status. */
export function deriveHistoryStatus(
  draftStatus: 'draft' | 'confirmed',
  attempts: SubmissionLookup[],
  receipt: HistoryReceipt | null,
): HistoryStatus {
  if (receipt) return 'accepted';
  return attempts.some((attempt) => attempt.status === 'pending') ? 'submitted' : draftStatus;
}

export async function getReturnReview(store: VatReturnStore, userId: string, period: Period) {
  const [{ lines, boxes }, draft, liveFiling, sandboxFiling] = await Promise.all([
    recompute(store, userId, period),
    store.findDraft(userId, period.periodKey),
    store.findSubmission(userId, period.periodKey, false),
    store.findSubmission(userId, period.periodKey, true),
  ]);
  const submission = pickReceipt(liveFiling, sandboxFiling);
  const boxLines = boxKeys.map((_, index) => linesForBox(lines, period, (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9));
  const drillDown = Object.fromEntries(
    boxKeys.map((key, index) => [
      key,
      boxLines[index].slice(0, DRILL_DOWN_LINES_PER_BOX).map((line) => ({
        lineId: (line as DrillLine).lineId,
        transactionId: (line as DrillLine).transactionId,
        date: line.date,
        amountPence: line.amountPence,
        vatPence: line.vatPence,
        description: (line as DrillLine).description,
      })),
    ]),
  );
  // Lets the UI say when a drill-down list is cut short and so will not sum to its box.
  const drillDownTotals = Object.fromEntries(boxKeys.map((key, index) => [key, boxLines[index].length]));
  // Counts entries, not lines, so the UI can tell an empty period from entries that net to zero.
  const entryCount = new Set(lines.map((line) => (line as DrillLine).transactionId)).size;
  const stale = draft?.status === 'confirmed' && !matchesConfirmation(draft, period, boxes);
  return { boxes, entryCount, drillDown, drillDownTotals, status: draft?.status ?? null, confirmedAt: draft?.confirmedAt ?? null, stale, submission };
}

// Only live filings lock a period: a sandbox rehearsal must never block the real one.
async function refuseIfFiledLive(store: VatReturnStore, userId: string, periodKey: string) {
  const filed = await store.findSubmission(userId, periodKey, false);
  if (filed && filed.status !== 'failed') {
    throw new VatReturnError(409, 'ALREADY_SUBMITTED', 'Return has been submitted to HMRC');
  }
}

export async function saveReturnDraft(store: VatReturnStore, userId: string, period: Period, reopen: boolean) {
  await refuseIfFiledLive(store, userId, period.periodKey);
  const existing = await store.findDraft(userId, period.periodKey);
  if (existing?.status === 'confirmed' && !reopen) {
    throw new VatReturnError(409, 'ALREADY_CONFIRMED', 'Return is already confirmed; reopen it to edit');
  }
  const { boxes } = await recompute(store, userId, period);
  await store.saveDraft(userId, period, boxes, reopen);
  return { boxes, status: 'draft' as const };
}

export async function confirmReturn(store: VatReturnStore, userId: string, period: Period, now: Date) {
  await refuseIfFiledLive(store, userId, period.periodKey);
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
        transactionId: transactions.id,
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
  async findSubmission(userId, periodKey, sandbox) {
    const [row] = await db
      .select({
        status: vatSubmissions.status,
        formBundleNumber: vatSubmissions.formBundleNumber,
        processingDate: vatSubmissions.processingDate,
      })
      .from(vatSubmissions)
      .where(
        and(eq(vatSubmissions.userId, userId), eq(vatSubmissions.periodKey, periodKey), eq(vatSubmissions.sandbox, sandbox)),
      )
      .limit(1);
    return row;
  },

  async claimSubmission(userId, periodKey, sandbox) {
    // The unique (user_id, period_key, sandbox) index makes this the only arbiter between concurrent requests.
    const [row] = await db
      .insert(vatSubmissions)
      .values({ userId, periodKey, sandbox })
      .onConflictDoUpdate({
        target: [vatSubmissions.userId, vatSubmissions.periodKey, vatSubmissions.sandbox],
        set: { status: 'pending', updatedAt: new Date() },
        setWhere: eq(vatSubmissions.status, 'failed'),
      })
      .returning({ id: vatSubmissions.id });
    return row?.id;
  },

  async recordReceipt(userId, submissionId, receipt, audit, now) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(vatSubmissions)
        .set({ ...receipt, status: 'submitted', submittedAt: now, updatedAt: now })
        .where(
          and(eq(vatSubmissions.id, submissionId), eq(vatSubmissions.userId, userId), eq(vatSubmissions.status, 'pending')),
        )
        .returning({ id: vatSubmissions.id });
      if (!row) throw new Error('No pending VAT submission to record a receipt against');
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'vat_return.submitted',
        resourceType: 'vat_submission',
        resourceId: submissionId,
        afterSnapshot: { ...submissionSnapshot(audit), receipt },
      });
    });
  },

  async listReturnHistory(userId) {
    const drafts = await db
      .select({
        periodKey: vatReturnDrafts.periodKey,
        periodStart: vatReturnDrafts.periodStart,
        periodEnd: vatReturnDrafts.periodEnd,
        status: vatReturnDrafts.status,
        box1Pence: vatReturnDrafts.box1Pence,
        box2Pence: vatReturnDrafts.box2Pence,
        box3Pence: vatReturnDrafts.box3Pence,
        box4Pence: vatReturnDrafts.box4Pence,
        box5Pence: vatReturnDrafts.box5Pence,
        box6Pence: vatReturnDrafts.box6Pence,
        box7Pence: vatReturnDrafts.box7Pence,
        box8Pence: vatReturnDrafts.box8Pence,
        box9Pence: vatReturnDrafts.box9Pence,
      })
      .from(vatReturnDrafts)
      .where(eq(vatReturnDrafts.userId, userId))
      .orderBy(desc(vatReturnDrafts.periodEnd))
      .limit(HISTORY_LIMIT);
    if (drafts.length === 0) return [];
    // At most one live and one sandbox row per period, so the limit is exact.
    const submissions = await db
      .select({
        periodKey: vatSubmissions.periodKey,
        sandbox: vatSubmissions.sandbox,
        status: vatSubmissions.status,
        formBundleNumber: vatSubmissions.formBundleNumber,
        processingDate: vatSubmissions.processingDate,
      })
      .from(vatSubmissions)
      .where(and(eq(vatSubmissions.userId, userId), inArray(vatSubmissions.periodKey, drafts.map((row) => row.periodKey))))
      .limit(drafts.length * 2);
    return drafts.map((row) => {
      const attempts = submissions.filter((submission) => submission.periodKey === row.periodKey);
      const receipt = pickReceipt(
        attempts.find((attempt) => !attempt.sandbox),
        attempts.find((attempt) => attempt.sandbox),
      );
      return {
        periodKey: row.periodKey,
        start: row.periodStart,
        end: row.periodEnd,
        status: deriveHistoryStatus(row.status, attempts, receipt),
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
        receipt,
      };
    });
  },

  async markFailed(userId, submissionId, audit) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .update(vatSubmissions)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(
          and(eq(vatSubmissions.id, submissionId), eq(vatSubmissions.userId, userId), eq(vatSubmissions.status, 'pending')),
        )
        .returning({ id: vatSubmissions.id });
      if (!row) throw new Error('No pending VAT submission to mark failed');
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'vat_return.submit_failed',
        resourceType: 'vat_submission',
        resourceId: submissionId,
        afterSnapshot: submissionSnapshot(audit),
      });
    });
  },
};
