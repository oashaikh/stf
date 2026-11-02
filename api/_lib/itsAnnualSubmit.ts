import { isDeepStrictEqual } from 'node:util';

import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { auditEvents, itsAnnualSubmissions } from '../../server/src/db/schema.js';
import { hmrcApiBase, HMRC_JSON_HEADERS, HmrcError, PROPERTY_BUSINESS_API_ACCEPT, propertyAnnualPath, refreshAccessToken, SELF_EMPLOYMENT_API_ACCEPT, selfEmploymentAnnualPath, submitAnnualSubmission, submitPropertyAnnualSubmission, type HmrcTokenSet, type PropertyAnnualSubmission } from '../../src/lib/hmrc/client.js';
import { buildAnnualSubmission, buildPropertyAnnualSubmission, type AnnualSubmission } from '../../src/lib/itsAnnualSubmission.js';
import { TAX_BANDS } from '../../src/lib/taxBands.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { db } from './db.js';
import { requestFraudHeaders, withUserTokens } from './hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from './hmrcStore.js';
import { checkItsReadiness } from './itsCumulativePreview.js';
import { databaseTaxIdentifiersStore, maskNino, type TaxIdentifiersStore } from './taxIdentifiers.js';
import { databaseTaxYearSummaryStore, getPropertySummary, getTaxYearSummary, type TaxYearSummaryStore } from './taxYearSummary.js';
import { submissionSnapshot, VatReturnError, type SubmissionAudit } from './vatReturns.js';

export type ItsAnnualStatus = 'confirmed' | 'pending' | 'submitted' | 'rejected';
export type ItsAnnualBusiness = 'self-employment' | 'uk-property';
export type ItsAnnualPeriod = { taxYear: string; sandbox: boolean; businessKind?: ItsAnnualBusiness };

// The NINO, business id and body are never input: only the year, the business and the property choice are named.
const itsAnnualFields = z.object({
  taxYear: z.string().refine((value) => value in TAX_BANDS && taxYearPeriod(value) !== null),
  business: z.enum(['self-employment', 'uk-property']).default('self-employment'),
  choice: z.enum(['allowance', 'actual']).optional(),
});

/** Strict body schema; `extra` adds the route's own flag (declaration, confirm). The choice belongs to uk-property alone. */
export const itsAnnualBodySchema = <Extra extends z.ZodRawShape = Record<never, never>>(extra?: Extra) =>
  itsAnnualFields
    .extend(extra ?? {})
    .strict()
    .refine(({ business, choice }) => (business === 'uk-property') === (choice !== undefined), { message: 'choice is for uk-property only' });

// Callers inside the server may leave the business out: it means self-employment.
type ItsAnnualInput = { taxYear: string; business?: ItsAnnualBusiness; choice?: 'allowance' | 'actual' };
type AnnualBody = AnnualSubmission | PropertyAnnualSubmission;

/**
 * Every method takes the session user id and touches at most one row, found by the unique key
 * (user_id, tax_year, sandbox) or by the primary key plus user_id. Audit rows are written in the
 * same transaction as the status change; no HMRC call ever runs inside one.
 */
export interface ItsAnnualStore {
  find(userId: string, period: ItsAnnualPeriod): Promise<{ id: string; status: ItsAnnualStatus; confirmedPayload: unknown } | undefined>;
  /** Stores a fresh confirmation. False when the year is already pending or submitted. */
  saveConfirmed(userId: string, period: ItsAnnualPeriod, payload: AnnualBody, now: Date, audit: SubmissionAudit): Promise<boolean>;
  /** Atomic confirmed to pending. False when another request got there first. This is the idempotency lock. */
  claim(userId: string, id: string, businessKind?: ItsAnnualBusiness): Promise<boolean>;
  /** Releases the lock: the owner has to confirm again before another submit. */
  markRejected(userId: string, id: string, audit: SubmissionAudit): Promise<void>;
  recordReceipt(userId: string, id: string, now: Date, audit: SubmissionAudit): Promise<void>;
}

export interface ItsAnnualDeps {
  submissions?: ItsAnnualStore;
  hmrcStore?: HmrcStore;
  identifiers?: TaxIdentifiersStore;
  summaryStore?: TaxYearSummaryStore;
  fetchFn?: typeof fetch;
  refresh?: (refreshToken: string) => Promise<HmrcTokenSet>;
  now?: () => Date;
  recordPreview?: (userId: string, metadata: { taxYear: string; sandbox: boolean; businessKind: ItsAnnualBusiness }) => Promise<void>;
}

// Each status change below filters on the primary key and user_id, and returns at most that one row.
const databaseAnnualStore: ItsAnnualStore = {
  async find(userId, { taxYear, sandbox, businessKind = 'self-employment' }) {
    const [row] = await db
      .select({ id: itsAnnualSubmissions.id, status: itsAnnualSubmissions.status, confirmedPayload: itsAnnualSubmissions.confirmedPayload })
      .from(itsAnnualSubmissions)
      .where(and(eq(itsAnnualSubmissions.userId, userId), eq(itsAnnualSubmissions.taxYear, taxYear), eq(itsAnnualSubmissions.sandbox, sandbox), eq(itsAnnualSubmissions.businessKind, businessKind)))
      .limit(1);
    return row;
  },

  async saveConfirmed(userId, { taxYear, sandbox, businessKind = 'self-employment' }, payload, now, audit) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(itsAnnualSubmissions)
        .values({ userId, taxYear, sandbox, businessKind, status: 'confirmed', confirmedPayload: payload, confirmedAt: now })
        .onConflictDoUpdate({
          target: [itsAnnualSubmissions.userId, itsAnnualSubmissions.taxYear, itsAnnualSubmissions.sandbox, itsAnnualSubmissions.businessKind],
          set: { status: 'confirmed', confirmedPayload: payload, confirmedAt: now, updatedAt: now },
          setWhere: inArray(itsAnnualSubmissions.status, ['confirmed', 'rejected']),
        })
        .returning({ id: itsAnnualSubmissions.id });
      if (!row) return false;
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'its_annual.confirmed',
        resourceType: 'its_annual_submission',
        resourceId: row.id,
        afterSnapshot: submissionSnapshot(audit),
      });
      return true;
    });
  },

  async claim(userId, id, businessKind = 'self-employment') {
    const claimed = await db
      .update(itsAnnualSubmissions)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(and(eq(itsAnnualSubmissions.id, id), eq(itsAnnualSubmissions.userId, userId), eq(itsAnnualSubmissions.businessKind, businessKind), eq(itsAnnualSubmissions.status, 'confirmed')))
      .returning({ id: itsAnnualSubmissions.id });
    return claimed.length > 0;
  },

  async markRejected(userId, id, audit) {
    await finishPending(userId, id, { status: 'rejected' }, 'its_annual.rejected', audit);
  },

  async recordReceipt(userId, id, now, audit) {
    await finishPending(userId, id, { status: 'submitted', submittedAt: now }, 'its_annual.submitted', audit);
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
      .update(itsAnnualSubmissions)
      .set({ ...change, updatedAt: new Date() })
      .where(and(eq(itsAnnualSubmissions.id, id), eq(itsAnnualSubmissions.userId, userId), eq(itsAnnualSubmissions.status, 'pending')))
      .returning({ id: itsAnnualSubmissions.id });
    if (!row) throw new Error('No pending annual submission to update');
    await tx.insert(auditEvents).values({
      userId,
      actorType: 'user',
      action,
      resourceType: 'its_annual_submission',
      resourceId: id,
      afterSnapshot: submissionSnapshot(audit),
    });
  });
}

const recordPreviewInDatabase: NonNullable<ItsAnnualDeps['recordPreview']> = async (userId, metadata) => {
  await db.insert(auditEvents).values({
    userId,
    actorType: 'user',
    action: 'its_annual.previewed',
    resourceType: 'its_annual_submission',
    metadata,
  });
};

/** The body HMRC would receive now, plus the gates shared by preview, confirm and submit. Throws VatReturnError on a refusal. */
async function prepare(
  userId: string,
  { taxYear, business = 'self-employment', choice }: ItsAnnualInput,
  { hmrcStore = databaseHmrcStore, identifiers = databaseTaxIdentifiersStore, summaryStore = databaseTaxYearSummaryStore }: ItsAnnualDeps,
) {
  const readiness = await checkItsReadiness(userId, hmrcStore, identifiers, business === 'uk-property' ? 'property' : 'self-employment');
  if (!readiness.ok) throw new VatReturnError(readiness.status, readiness.code, readiness.error);
  const period = taxYearPeriod(taxYear)!;
  const payload: AnnualBody =
    business === 'uk-property'
      ? buildPropertyAnnualSubmission(await getPropertySummary(summaryStore, userId, period), choice!, taxYear)
      : buildAnnualSubmission(await getTaxYearSummary(summaryStore, userId, period));
  return { ...readiness, payload };
}

/** Shows what the annual submission would send, without calling HMRC. The only write is the audit event. */
export async function previewItsAnnualForUser({ userId, ...input }: { userId: string } & ItsAnnualInput, deps: ItsAnnualDeps = {}) {
  const { recordPreview = recordPreviewInDatabase } = deps;
  const { sandbox, nino, businessId, payload } = await prepare(userId, input, deps);
  await recordPreview(userId, { taxYear: input.taxYear, sandbox, businessKind: input.business ?? 'self-employment' });
  const property = input.business === 'uk-property';
  const path = property ? propertyAnnualPath : selfEmploymentAnnualPath;
  return {
    endpoint: { method: 'PUT', url: `${hmrcApiBase()}${path(maskNino(nino), maskNino(businessId), input.taxYear)}`, sandbox },
    body: payload,
    headers: { ...HMRC_JSON_HEADERS, Accept: property ? PROPERTY_BUSINESS_API_ACCEPT : SELF_EMPLOYMENT_API_ACCEPT, Authorization: 'Bearer (hidden)' } as Record<string, string>,
  };
}

/**
 * Stores a server-recomputed snapshot of the submission the owner has just reviewed. The body is never
 * taken from the caller. Re-confirming replaces an earlier confirmation or a rejected attempt.
 */
export async function confirmItsAnnualForUser(
  { userId, declaration, request, ...input }: { userId: string; declaration: boolean; request: Request } & ItsAnnualInput,
  deps: ItsAnnualDeps = {},
) {
  if (!declaration) throw new VatReturnError(400, 'DECLARATION_REQUIRED', 'Tick the declaration to confirm');
  const { submissions = databaseAnnualStore, now = () => new Date() } = deps;
  const { sandbox, payload } = await prepare(userId, input, deps);

  const saved = await submissions.saveConfirmed(userId, { taxYear: input.taxYear, sandbox, businessKind: input.business ?? 'self-employment' }, payload, now(), {
    periodKey: input.taxYear,
    sandbox,
    request: payload,
    response: null,
    fraudHeaders: requestFraudHeaders(request, userId, now()),
  });
  if (!saved) throw alreadySubmitted();
  return { sandbox, body: payload };
}

/**
 * Sends the confirmed submission to HMRC. Refuses unless the stored confirmation still matches the ledger.
 * Throws VatReturnError for every refusal and failure.
 */
export async function submitItsAnnualForUser(
  { userId, request, ...input }: { userId: string; request: Request } & ItsAnnualInput,
  deps: ItsAnnualDeps = {},
) {
  const { submissions = databaseAnnualStore, hmrcStore = databaseHmrcStore, fetchFn, refresh = refreshAccessToken, now = () => new Date() } = deps;
  const { taxYear, business = 'self-employment' } = input;
  const { sandbox, nino, businessId, credentials, payload } = await prepare(userId, input, deps);

  const confirmation = await submissions.find(userId, { taxYear, sandbox, businessKind: business });
  if (!confirmation || confirmation.status === 'rejected') throw new VatReturnError(409, 'NOT_CONFIRMED', 'Confirm this submission before sending it');
  if (confirmation.status !== 'confirmed') throw alreadySubmitted();
  if (!isDeepStrictEqual(confirmation.confirmedPayload, payload)) {
    throw new VatReturnError(409, 'STALE_CONFIRMATION', 'Your records changed since you confirmed. Review and confirm again');
  }
  if (!(await submissions.claim(userId, confirmation.id, business))) throw alreadySubmitted();

  const fraudHeaders = requestFraudHeaders(request, userId, now());
  const audit = { periodKey: taxYear, sandbox, request: payload, fraudHeaders };
  try {
    // The stored snapshot is what is sent; it was just checked equal to the recomputed body.
    await withUserTokens(userId, credentials, hmrcStore, refresh, (accessToken) =>
      business === 'uk-property'
        ? submitPropertyAnnualSubmission(nino, businessId, taxYear, confirmation.confirmedPayload as PropertyAnnualSubmission, accessToken, fraudHeaders, fetchFn)
        : submitAnnualSubmission(nino, businessId, taxYear, confirmation.confirmedPayload as AnnualSubmission, accessToken, fraudHeaders, fetchFn),
    );
  } catch (error) {
    if (error instanceof HmrcError && error.apiError.statusCode >= 400 && error.apiError.statusCode < 500) {
      const { code, statusCode } = error.apiError;
      await submissions.markRejected(userId, confirmation.id, { ...audit, response: { code, statusCode } });
      console.error('HMRC annual submission rejected', code, statusCode);
      throw new VatReturnError(502, code, 'HMRC rejected the submission');
    }
    // 5xx or network failure: HMRC may have processed it, so the claim stays pending and blocks a retry.
    console.error('HMRC annual submission outcome unknown');
    throw unknownOutcome();
  }

  try {
    await submissions.recordReceipt(userId, confirmation.id, now(), { ...audit, response: { accepted: true } });
  } catch {
    // HMRC accepted the submission but we could not record it; the claim stays pending so it is not filed twice.
    console.error('HMRC annual submission receipt could not be saved');
    throw unknownOutcome();
  }
  return { sandbox };
}

const alreadySubmitted = () => new VatReturnError(409, 'ALREADY_SUBMITTED', 'This submission has already been sent or is being sent');

const unknownOutcome = () =>
  new VatReturnError(502, 'OUTCOME_UNKNOWN', 'The outcome is unknown. Do not resend; check HMRC before trying again');
