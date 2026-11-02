import { isDeepStrictEqual } from 'node:util';

import { and, eq, inArray } from 'drizzle-orm';

import { auditEvents, itsSubmissions } from '../../server/src/db/schema.js';
import {
  HmrcError,
  refreshAccessToken,
  submitCumulativePeriodSummary,
  submitPropertyCumulativeSummary,
  type CumulativePeriodSummary,
  type HmrcTokenSet,
  type PropertyCumulativeSummary,
} from '../../src/lib/hmrc/client.js';
import { buildCumulativePeriodSummary, quarterEndDate } from '../../src/lib/itsCumulativeUpdate.js';
import { buildPropertyCumulativeSummary } from '../../src/lib/itsPropertyUpdate.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { db } from './db.js';
import { requestFraudHeaders, withUserTokens } from './hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from './hmrcStore.js';
import { checkItsReadiness, type ItsCumulativePreviewInput } from './itsCumulativePreview.js';
import { databaseTaxIdentifiersStore, type TaxIdentifiersStore } from './taxIdentifiers.js';
import { databaseTaxYearSummaryStore, getPropertySummary, getTaxYearSummary, type TaxYearSummaryStore } from './taxYearSummary.js';
import { submissionSnapshot, VatReturnError, type SubmissionAudit } from './vatReturns.js';

export type ItsSubmissionStatus = 'confirmed' | 'pending' | 'submitted' | 'rejected';
export type ItsBusinessKind = 'self-employment' | 'uk-property';
export type ItsPeriod = ItsCumulativePreviewInput & { sandbox: boolean; kind: ItsBusinessKind };
type ItsUpdateBody = CumulativePeriodSummary | PropertyCumulativeSummary;

/**
 * Every method takes the session user id and touches at most one row, found by the unique key
 * (user_id, tax_year, quarter, sandbox, business_kind) or by the primary key plus user_id. Audit rows are written in the
 * same transaction as the status change; no HMRC call ever runs inside one.
 */
export interface ItsSubmissionStore {
  find(userId: string, period: ItsPeriod): Promise<{ id: string; status: ItsSubmissionStatus; confirmedPayload: unknown } | undefined>;
  /** Stores a fresh confirmation. False when the period is already pending or submitted. */
  saveConfirmed(userId: string, period: ItsPeriod, payload: ItsUpdateBody, now: Date, audit: SubmissionAudit): Promise<boolean>;
  /** Atomic confirmed to pending. False when another request got there first. This is the idempotency lock. */
  claim(userId: string, id: string): Promise<boolean>;
  /** Releases the lock: the owner has to confirm again before another submit. */
  markRejected(userId: string, id: string, audit: SubmissionAudit): Promise<void>;
  recordReceipt(userId: string, id: string, now: Date, audit: SubmissionAudit): Promise<void>;
}

export interface ItsSubmitDeps {
  submissions?: ItsSubmissionStore;
  hmrcStore?: HmrcStore;
  identifiers?: TaxIdentifiersStore;
  summaryStore?: TaxYearSummaryStore;
  fetchFn?: typeof fetch;
  refresh?: (refreshToken: string) => Promise<HmrcTokenSet>;
  now?: () => Date;
}

const periodKey = ({ taxYear, quarter }: ItsCumulativePreviewInput, kind: ItsBusinessKind) =>
  kind === 'uk-property' ? `property-${taxYear}-Q${quarter}` : `${taxYear}-Q${quarter}`;

// Each status change below filters on the primary key and user_id, and returns at most that one row.
const databaseSubmissionStore: ItsSubmissionStore = {
  async find(userId, { taxYear, quarter, sandbox, kind }) {
    const [row] = await db
      .select({ id: itsSubmissions.id, status: itsSubmissions.status, confirmedPayload: itsSubmissions.confirmedPayload })
      .from(itsSubmissions)
      .where(
        and(
          eq(itsSubmissions.userId, userId),
          eq(itsSubmissions.taxYear, taxYear),
          eq(itsSubmissions.quarter, quarter),
          eq(itsSubmissions.sandbox, sandbox),
          eq(itsSubmissions.businessKind, kind),
        ),
      )
      .limit(1);
    return row;
  },

  async saveConfirmed(userId, { taxYear, quarter, sandbox, kind }, payload, now, audit) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(itsSubmissions)
        .values({ userId, taxYear, quarter, sandbox, businessKind: kind, status: 'confirmed', confirmedPayload: payload, confirmedAt: now })
        .onConflictDoUpdate({
          target: [itsSubmissions.userId, itsSubmissions.taxYear, itsSubmissions.quarter, itsSubmissions.sandbox, itsSubmissions.businessKind],
          set: { status: 'confirmed', confirmedPayload: payload, confirmedAt: now, updatedAt: now },
          setWhere: inArray(itsSubmissions.status, ['confirmed', 'rejected']),
        })
        .returning({ id: itsSubmissions.id });
      if (!row) return false;
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'its_update.confirmed',
        resourceType: 'its_submission',
        resourceId: row.id,
        afterSnapshot: submissionSnapshot(audit),
      });
      return true;
    });
  },

  async claim(userId, id) {
    const claimed = await db
      .update(itsSubmissions)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(and(eq(itsSubmissions.id, id), eq(itsSubmissions.userId, userId), eq(itsSubmissions.status, 'confirmed')))
      .returning({ id: itsSubmissions.id });
    return claimed.length > 0;
  },

  async markRejected(userId, id, audit) {
    await finishPending(userId, id, { status: 'rejected' }, 'its_update.rejected', audit);
  },

  async recordReceipt(userId, id, now, audit) {
    await finishPending(userId, id, { status: 'submitted', submittedAt: now }, 'its_update.submitted', audit);
  },
};

async function finishPending(
  userId: string,
  id: string,
  change: { status: 'rejected' } | { status: 'submitted'; submittedAt: Date },
  action: string,
  audit: SubmissionAudit,
) {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(itsSubmissions)
      .set({ ...change, updatedAt: new Date() })
      .where(and(eq(itsSubmissions.id, id), eq(itsSubmissions.userId, userId), eq(itsSubmissions.status, 'pending')))
      .returning({ id: itsSubmissions.id });
    if (!row) throw new Error('No pending Income Tax submission to update');
    await tx.insert(auditEvents).values({
      userId,
      actorType: 'user',
      action,
      resourceType: 'its_submission',
      resourceId: id,
      afterSnapshot: submissionSnapshot(audit),
    });
  });
}

/** The body HMRC would receive now, plus the gates shared with the preview. Throws VatReturnError on a refusal. */
async function prepare(
  userId: string,
  { taxYear, quarter }: ItsCumulativePreviewInput,
  { hmrcStore = databaseHmrcStore, identifiers = databaseTaxIdentifiersStore, summaryStore = databaseTaxYearSummaryStore }: ItsSubmitDeps,
  kind: ItsBusinessKind,
) {
  const readiness = await checkItsReadiness(userId, hmrcStore, identifiers, kind === 'uk-property' ? 'property' : 'self-employment');
  if (!readiness.ok) throw new VatReturnError(readiness.status, readiness.code, readiness.error);
  const period = { start: taxYearPeriod(taxYear)!.start, end: quarterEndDate(taxYear, quarter) };
  const payload: ItsUpdateBody =
    kind === 'uk-property'
      ? buildPropertyCumulativeSummary(await getPropertySummary(summaryStore, userId, period))
      : buildCumulativePeriodSummary(await getTaxYearSummary(summaryStore, userId, period));
  return { ...readiness, payload };
}

/**
 * Stores a server-recomputed snapshot of the update the owner has just reviewed. The body is never
 * taken from the caller. Re-confirming replaces an earlier confirmation or a rejected attempt.
 */
export async function confirmItsUpdateForUser(
  { userId, taxYear, quarter, declaration, request, kind = 'self-employment' }: { userId: string; declaration: boolean; request: Request; kind?: ItsBusinessKind } & ItsCumulativePreviewInput,
  deps: ItsSubmitDeps = {},
) {
  if (!declaration) throw new VatReturnError(400, 'DECLARATION_REQUIRED', 'Tick the declaration to confirm');
  const { submissions = databaseSubmissionStore, now = () => new Date() } = deps;
  const { sandbox, payload } = await prepare(userId, { taxYear, quarter }, deps, kind);

  const saved = await submissions.saveConfirmed(userId, { taxYear, quarter, sandbox, kind }, payload, now(), {
    periodKey: periodKey({ taxYear, quarter }, kind),
    sandbox,
    request: payload,
    response: null,
    fraudHeaders: requestFraudHeaders(request, userId, now()),
  });
  if (!saved) throw alreadySubmitted();
  return { sandbox, body: payload };
}

/**
 * Sends the confirmed update to HMRC. Refuses unless the stored confirmation still matches the ledger.
 * Throws VatReturnError for every refusal and failure.
 */
export async function submitItsUpdateForUser(
  { userId, taxYear, quarter, request, kind = 'self-employment' }: { userId: string; request: Request; kind?: ItsBusinessKind } & ItsCumulativePreviewInput,
  deps: ItsSubmitDeps = {},
) {
  const { submissions = databaseSubmissionStore, hmrcStore = databaseHmrcStore, fetchFn, refresh = refreshAccessToken, now = () => new Date() } = deps;
  const { sandbox, nino, businessId, credentials, payload } = await prepare(userId, { taxYear, quarter }, deps, kind);
  const period: ItsPeriod = { taxYear, quarter, sandbox, kind };

  const confirmation = await submissions.find(userId, period);
  if (!confirmation || confirmation.status === 'rejected') throw new VatReturnError(409, 'NOT_CONFIRMED', 'Confirm this update before submitting');
  if (confirmation.status !== 'confirmed') throw alreadySubmitted();
  if (!isDeepStrictEqual(confirmation.confirmedPayload, payload)) {
    throw new VatReturnError(409, 'STALE_CONFIRMATION', 'Your records changed since you confirmed. Review and confirm again');
  }
  if (!(await submissions.claim(userId, confirmation.id))) throw alreadySubmitted();

  const fraudHeaders = requestFraudHeaders(request, userId, now());
  const audit = { periodKey: periodKey({ taxYear, quarter }, kind), sandbox, request: payload, fraudHeaders };
  try {
    await withUserTokens(userId, credentials, hmrcStore, refresh, (accessToken) =>
      kind === 'uk-property'
        ? submitPropertyCumulativeSummary(nino, businessId, taxYear, payload as PropertyCumulativeSummary, accessToken, fraudHeaders, fetchFn)
        : submitCumulativePeriodSummary(nino, businessId, taxYear, payload as CumulativePeriodSummary, accessToken, fraudHeaders, fetchFn),
    );
  } catch (error) {
    if (error instanceof HmrcError && error.apiError.statusCode >= 400 && error.apiError.statusCode < 500) {
      const { code, statusCode } = error.apiError;
      await submissions.markRejected(userId, confirmation.id, { ...audit, response: { code, statusCode } });
      console.error('HMRC Income Tax update rejected', code, statusCode);
      throw new VatReturnError(502, code, 'HMRC rejected the update');
    }
    // 5xx or network failure: HMRC may have processed it, so the claim stays pending and blocks a retry.
    console.error('HMRC Income Tax update outcome unknown');
    throw unknownOutcome();
  }

  try {
    await submissions.recordReceipt(userId, confirmation.id, now(), { ...audit, response: { accepted: true } });
  } catch {
    // HMRC accepted the update but we could not record it; the claim stays pending so it is not filed twice.
    console.error('HMRC Income Tax receipt could not be saved');
    throw unknownOutcome();
  }
  return { sandbox };
}

const alreadySubmitted = () => new VatReturnError(409, 'ALREADY_SUBMITTED', 'This update has already been submitted or is being submitted');

const unknownOutcome = () =>
  new VatReturnError(502, 'OUTCOME_UNKNOWN', 'The outcome is unknown. Do not resubmit; check HMRC before trying again');
