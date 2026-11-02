import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { auditEvents, itsAnnualSubmissions, itsFinalDeclarations } from '../../server/src/db/schema.js';
import { getTaxCalculation, HmrcError, refreshAccessToken, submitFinalDeclaration, triggerTaxCalculation, type HmrcTokenSet, type TaxCalculationResult } from '../../src/lib/hmrc/client.js';
import { compareWithHmrc, FINAL_DECLARATION_WORDING } from '../../src/lib/finalDeclaration.js';
import { TAX_BANDS } from '../../src/lib/taxBands.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { db } from './db.js';
import { requestFraudHeaders, withUserTokens } from './hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from './hmrcStore.js';
import { checkItsReadiness } from './itsCumulativePreview.js';
import type { ItsAnnualBusiness, ItsAnnualPeriod, ItsAnnualStatus } from './itsAnnualSubmit.js';
import { databaseTaxIdentifiersStore, type TaxIdentifiersStore } from './taxIdentifiers.js';
import { getTaxEstimate } from './taxEstimate.js';
import { databaseTaxYearSummaryStore, type TaxYearSummaryStore } from './taxYearSummary.js';
import { submissionSnapshot, VatReturnError, type SubmissionAudit } from './vatReturns.js';

const taxYearField = z.string().refine((value) => value in TAX_BANDS && taxYearPeriod(value) !== null);

// The NINO and the figures are never input: the owner names the year, and the calculation HMRC made for it.
export const itsFinalInputSchema = z.object({ taxYear: taxYearField }).strict();
export const itsFinalConfirmSchema = z
  .object({ taxYear: taxYearField, calculationId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/), declaration: z.literal(true) })
  .strict();
// Filing is irreversible, so the caller must say so; the calculation id comes from the stored confirmation.
export const itsFinalSubmitSchema = z.object({ taxYear: taxYearField, confirm: z.literal(true) }).strict();

/**
 * Every method takes the session user id and touches at most one row, found by the unique key
 * (user_id, tax_year, sandbox) or by the primary key plus user_id. Audit rows are written in the
 * same transaction as the status change; no HMRC call ever runs inside one.
 */
export interface ItsFinalStore {
  find(userId: string, period: ItsAnnualPeriod): Promise<{ id: string; status: ItsAnnualStatus; calculationId: string } | undefined>;
  /** Businesses whose annual figures HMRC has accepted for the year. One query on the unique key's prefix, at most two rows. */
  submittedAnnualBusinesses(userId: string, period: ItsAnnualPeriod): Promise<ItsAnnualBusiness[]>;
  /** Stores the calculation the owner agreed to. False when the year is already pending or submitted. */
  saveConfirmed(
    userId: string,
    period: ItsAnnualPeriod,
    calculation: TaxCalculationResult & { calculationId: string },
    now: Date,
    audit: SubmissionAudit,
  ): Promise<boolean>;
  /** Atomic confirmed to pending. False when another request got there first. This is the idempotency lock. */
  claim(userId: string, id: string): Promise<boolean>;
  /** Releases the lock: the owner has to confirm again before another submit. */
  markRejected(userId: string, id: string, audit: SubmissionAudit): Promise<void>;
  recordReceipt(userId: string, id: string, now: Date, audit: SubmissionAudit): Promise<void>;
}

export interface ItsFinalDeps {
  submissions?: ItsFinalStore;
  hmrcStore?: HmrcStore;
  identifiers?: TaxIdentifiersStore;
  summaryStore?: TaxYearSummaryStore;
  fetchFn?: typeof fetch;
  refresh?: (refreshToken: string) => Promise<HmrcTokenSet>;
  now?: () => Date;
}

const databaseFinalStore: ItsFinalStore = {
  async find(userId, { taxYear, sandbox }) {
    const [row] = await db
      .select({ id: itsFinalDeclarations.id, status: itsFinalDeclarations.status, calculationId: itsFinalDeclarations.hmrcCalculationId })
      .from(itsFinalDeclarations)
      .where(and(eq(itsFinalDeclarations.userId, userId), eq(itsFinalDeclarations.taxYear, taxYear), eq(itsFinalDeclarations.sandbox, sandbox)))
      .limit(1);
    return row;
  },

  async submittedAnnualBusinesses(userId, { taxYear, sandbox }) {
    const rows = await db
      .select({ businessKind: itsAnnualSubmissions.businessKind })
      .from(itsAnnualSubmissions)
      .where(
        and(
          eq(itsAnnualSubmissions.userId, userId),
          eq(itsAnnualSubmissions.taxYear, taxYear),
          eq(itsAnnualSubmissions.sandbox, sandbox),
          eq(itsAnnualSubmissions.status, 'submitted'),
        ),
      )
      .limit(2);
    return rows.map((row) => row.businessKind as ItsAnnualBusiness);
  },

  async saveConfirmed(userId, { taxYear, sandbox }, calculation, now, audit) {
    const figures = {
      hmrcCalculationId: calculation.calculationId,
      incomeTaxPence: calculation.incomeTaxPence,
      class2NicPence: calculation.class2NicPence,
      class4NicPence: calculation.class4NicPence,
      totalPence: calculation.totalPence,
      declarationConfirmedAt: now,
    };
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(itsFinalDeclarations)
        .values({ userId, taxYear, sandbox, status: 'confirmed', ...figures })
        .onConflictDoUpdate({
          target: [itsFinalDeclarations.userId, itsFinalDeclarations.taxYear, itsFinalDeclarations.sandbox],
          set: { status: 'confirmed', ...figures, updatedAt: now },
          setWhere: inArray(itsFinalDeclarations.status, ['confirmed', 'rejected']),
        })
        .returning({ id: itsFinalDeclarations.id });
      if (!row) return false;
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'user',
        action: 'its_final.confirmed',
        resourceType: 'its_final_declaration',
        resourceId: row.id,
        afterSnapshot: submissionSnapshot(audit),
      });
      return true;
    });
  },

  async claim(userId, id) {
    const claimed = await db
      .update(itsFinalDeclarations)
      .set({ status: 'pending', updatedAt: new Date() })
      .where(and(eq(itsFinalDeclarations.id, id), eq(itsFinalDeclarations.userId, userId), eq(itsFinalDeclarations.status, 'confirmed')))
      .returning({ id: itsFinalDeclarations.id });
    return claimed.length > 0;
  },

  async markRejected(userId, id, audit) {
    await finishPending(userId, id, { status: 'rejected' }, 'its_final.rejected', audit);
  },

  async recordReceipt(userId, id, now, audit) {
    await finishPending(userId, id, { status: 'submitted', submittedAt: now }, 'its_final.submitted', audit);
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
      .update(itsFinalDeclarations)
      .set({ ...change, updatedAt: new Date() })
      .where(and(eq(itsFinalDeclarations.id, id), eq(itsFinalDeclarations.userId, userId), eq(itsFinalDeclarations.status, 'pending')))
      .returning({ id: itsFinalDeclarations.id });
    if (!row) throw new Error('No pending final declaration to update');
    await tx.insert(auditEvents).values({
      userId,
      actorType: 'user',
      action,
      resourceType: 'its_final_declaration',
      resourceId: id,
      afterSnapshot: submissionSnapshot(audit),
    });
  });
}

const BUSINESS_NAMES: Record<ItsAnnualBusiness, string> = { 'self-employment': 'self-employment', 'uk-property': 'UK property' };

/**
 * The readiness gates, then the yearly-figures gate. HMRC will not calculate a year until every
 * business has its annual figures in, so preview, confirm and submit all stop here first.
 */
async function ready(userId: string, taxYear: string, deps: ItsFinalDeps) {
  const { hmrcStore = databaseHmrcStore, identifiers = databaseTaxIdentifiersStore, submissions = databaseFinalStore } = deps;
  const { itsBusinessId, itsPropertyBusinessId } = await hmrcStore.status(userId);
  const businesses: ItsAnnualBusiness[] = [];
  if (itsBusinessId) businesses.push('self-employment');
  if (itsPropertyBusinessId) businesses.push('uk-property');
  // A property-only owner has no self-employment id, so readiness is checked against the business they do have.
  const readiness = await checkItsReadiness(userId, hmrcStore, identifiers, !itsBusinessId && itsPropertyBusinessId ? 'property' : 'self-employment');
  if (!readiness.ok) throw new VatReturnError(readiness.status, readiness.code, readiness.error);
  const submitted = await submissions.submittedAnnualBusinesses(userId, { taxYear, sandbox: readiness.sandbox });
  const missing = businesses.find((business) => !submitted.includes(business));
  if (missing) {
    throw new VatReturnError(
      409,
      'ANNUAL_FIGURES_MISSING',
      `Your ${BUSINESS_NAMES[missing]} yearly figures are not sent yet. Nothing has been sent to HMRC. Go to Year end, finish the yearly figures step for ${BUSINESS_NAMES[missing]}, then come back.`,
    );
  }
  return readiness;
}

const hmrcFailure = () => new VatReturnError(502, 'HMRC_UNAVAILABLE', 'HMRC could not calculate your tax. Try again shortly');

/**
 * Asks HMRC to calculate the year, then returns its figures beside STF's estimate. Writes nothing.
 * The HMRC calls run before any database write, so none sits inside a transaction.
 */
export async function previewItsFinalForUser({ userId, taxYear, request }: { userId: string; taxYear: string; request: Request }, deps: ItsFinalDeps = {}) {
  const { hmrcStore = databaseHmrcStore, summaryStore = databaseTaxYearSummaryStore, fetchFn, refresh = refreshAccessToken, now = () => new Date() } = deps;
  const { sandbox, nino, credentials } = await ready(userId, taxYear, deps);
  const fraudHeaders = requestFraudHeaders(request, userId, now());
  let calculationId: string;
  let hmrc: TaxCalculationResult;
  try {
    ({ calculationId, hmrc } = await withUserTokens(userId, credentials, hmrcStore, refresh, async (accessToken) => {
      const triggered = await triggerTaxCalculation(nino, taxYear, accessToken, fraudHeaders, fetchFn);
      return { calculationId: triggered.calculationId, hmrc: await getTaxCalculation(nino, taxYear, triggered.calculationId, accessToken, fraudHeaders, fetchFn) };
    }));
  } catch (error) {
    console.error('HMRC tax calculation failed', error instanceof HmrcError ? error.apiError.statusCode : 'network');
    throw hmrcFailure();
  }
  const estimate = await getTaxEstimate(summaryStore, userId, taxYear);
  return {
    sandbox,
    calculationId,
    hmrc,
    stfEstimate: {
      incomeTaxPence: estimate.incomeTaxPence,
      class2NicPence: estimate.class2NicPence,
      class4NicPence: estimate.class4NicPence,
      totalPence: estimate.totalTaxPence,
    },
    comparison: compareWithHmrc(estimate, hmrc),
    declarationWording: FINAL_DECLARATION_WORDING,
  };
}

/**
 * Stores the calculation the owner ticked the declaration for. The figures are re-read from HMRC by
 * id, never taken from the caller. Re-confirming replaces an earlier confirmation or a rejected attempt.
 */
export async function confirmItsFinalForUser(
  { userId, taxYear, calculationId, declaration, request }: { userId: string; taxYear: string; calculationId: string; declaration: boolean; request: Request },
  deps: ItsFinalDeps = {},
) {
  if (!declaration) throw new VatReturnError(400, 'DECLARATION_REQUIRED', 'Tick the declaration to confirm');
  const { submissions = databaseFinalStore, hmrcStore = databaseHmrcStore, fetchFn, refresh = refreshAccessToken, now = () => new Date() } = deps;
  const { sandbox, nino, credentials } = await ready(userId, taxYear, deps);
  const fraudHeaders = requestFraudHeaders(request, userId, now());

  let hmrc: TaxCalculationResult;
  try {
    hmrc = await withUserTokens(userId, credentials, hmrcStore, refresh, (accessToken) =>
      getTaxCalculation(nino, taxYear, calculationId, accessToken, fraudHeaders, fetchFn),
    );
  } catch (error) {
    console.error('HMRC tax calculation failed', error instanceof HmrcError ? error.apiError.statusCode : 'network');
    throw hmrcFailure();
  }

  const saved = await submissions.saveConfirmed(userId, { taxYear, sandbox }, { ...hmrc, calculationId }, now(), {
    periodKey: taxYear,
    sandbox,
    request: { calculationId },
    response: hmrc,
    fraudHeaders,
  });
  if (!saved) throw alreadySubmitted();
  return { sandbox, hmrc };
}

/** Sends the final declaration for the stored calculation. Throws VatReturnError for every refusal and failure. */
export async function submitItsFinalForUser(
  { userId, taxYear, request }: { userId: string; taxYear: string; request: Request },
  deps: ItsFinalDeps = {},
) {
  const { submissions = databaseFinalStore, hmrcStore = databaseHmrcStore, fetchFn, refresh = refreshAccessToken, now = () => new Date() } = deps;
  const { sandbox, nino, credentials } = await ready(userId, taxYear, deps);

  const confirmation = await submissions.find(userId, { taxYear, sandbox });
  if (!confirmation || confirmation.status === 'rejected') throw new VatReturnError(409, 'NOT_CONFIRMED', 'Confirm your figures before declaring');
  if (confirmation.status !== 'confirmed') throw alreadySubmitted();
  // Built before the claim so a failure here cannot leave the year pending.
  const fraudHeaders = requestFraudHeaders(request, userId, now());
  if (!(await submissions.claim(userId, confirmation.id))) throw alreadySubmitted();

  const audit = { periodKey: taxYear, sandbox, request: { calculationId: confirmation.calculationId }, fraudHeaders };
  let requestStarted = false;
  try {
    await withUserTokens(userId, credentials, hmrcStore, refresh, (accessToken) => {
      requestStarted = true;
      return submitFinalDeclaration(nino, taxYear, confirmation.calculationId, accessToken, fraudHeaders, fetchFn);
    });
  } catch (error) {
    if (!requestStarted) {
      // The token refresh failed before anything reached HMRC, so release the claim and let the owner retry.
      await submissions.markRejected(userId, confirmation.id, { ...audit, response: { code: 'NOT_SENT', statusCode: 0 } });
      console.error('HMRC final declaration not sent: token refresh failed');
      throw new VatReturnError(502, 'HMRC_UNAVAILABLE', 'We could not reach HMRC, so nothing was sent. Tick the declaration again to retry');
    }
    if (error instanceof HmrcError && error.apiError.statusCode >= 400 && error.apiError.statusCode < 500) {
      const { code, statusCode } = error.apiError;
      await submissions.markRejected(userId, confirmation.id, { ...audit, response: { code, statusCode } });
      console.error('HMRC final declaration rejected', code, statusCode);
      throw new VatReturnError(502, code, 'HMRC rejected the declaration');
    }
    // 5xx or network failure: HMRC may have processed it, so the claim stays pending and blocks a retry.
    console.error('HMRC final declaration outcome unknown');
    throw unknownOutcome();
  }

  try {
    await submissions.recordReceipt(userId, confirmation.id, now(), { ...audit, response: { accepted: true } });
  } catch {
    // HMRC accepted the declaration but we could not record it; the claim stays pending so it is not filed twice.
    console.error('HMRC final declaration receipt could not be saved');
    throw unknownOutcome();
  }
  return { sandbox };
}

const alreadySubmitted = () => new VatReturnError(409, 'ALREADY_SUBMITTED', 'This declaration has already been sent or is being sent');

const unknownOutcome = () =>
  new VatReturnError(502, 'OUTCOME_UNKNOWN', 'The outcome is unknown. Do not resend; check HMRC before trying again');
