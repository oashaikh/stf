import { validateFraudHeaders, HmrcError, type FraudHeaderValidation } from '../../src/lib/hmrc/client.js';
import { auditEvents } from '../../server/src/db/schema.js';
import { db } from './db.js';
import { requestFraudHeaders } from './hmrcCall.js';
import { VatReturnError } from './vatReturns.js';

export interface FraudCheckResult extends FraudHeaderValidation {
  outcome: 'pass' | 'fail';
}

export interface FraudCheckDeps {
  validate?: (headers: Record<string, string>) => Promise<FraudHeaderValidation>;
  recordAudit?: (userId: string, snapshot: object) => Promise<void>;
  now?: () => Date;
}

async function insertAuditEvent(userId: string, snapshot: object): Promise<void> {
  await db.insert(auditEvents).values({
    userId,
    actorType: 'user',
    action: 'hmrc.fraud_headers.validated',
    resourceType: 'hmrc_fraud_validation',
    afterSnapshot: snapshot,
  });
}

/**
 * Sends the headers a real submission would send to HMRC's sandbox validator and records the result.
 * The audit keeps header names only: the values hold the user's IP and device id (DP-8).
 */
export async function runFraudHeadersCheck(
  { userId, request }: { userId: string; request: Request },
  { validate = (headers) => validateFraudHeaders(headers), recordAudit = insertAuditEvent, now = () => new Date() }: FraudCheckDeps = {},
): Promise<FraudCheckResult> {
  const headers = requestFraudHeaders(request, userId, now());
  let validation: FraudHeaderValidation;
  try {
    validation = await validate(headers);
  } catch (error) {
    if (error instanceof HmrcError) {
      throw new VatReturnError(502, 'HMRC_VALIDATION_FAILED', `HMRC header validation failed (${error.apiError.statusCode})`);
    }
    throw error;
  }
  const outcome = validation.errors.length === 0 && validation.warnings.length === 0 ? 'pass' : 'fail';
  try {
    await recordAudit(userId, {
      outcome,
      code: validation.code,
      errors: validation.errors,
      warnings: validation.warnings,
      sentHeaderNames: Object.keys(headers),
    });
  } catch {
    throw new VatReturnError(500, 'AUDIT_FAILED', 'The check ran but its result could not be recorded');
  }
  return { ...validation, outcome };
}
