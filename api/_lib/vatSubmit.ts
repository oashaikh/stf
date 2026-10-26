import { buildFraudHeaders } from '../../src/lib/hmrc/fraudHeaders.js';
import { HmrcError, refreshAccessToken, submitVatReturn, withHmrcToken, type HmrcTokenSet } from '../../src/lib/hmrc/client.js';
import { boxesToHmrcPayload } from '../../src/lib/vat.js';
import { databaseHmrcStore, type HmrcStore } from './hmrcStore.js';
import { databaseStore, requireConfirmedReturn, VatReturnError, type Period, type VatReturnStore } from './vatReturns.js';

export interface SubmitDeps {
  vatStore?: VatReturnStore;
  hmrcStore?: HmrcStore;
  fetchFn?: typeof fetch;
  refresh?: (refreshToken: string) => Promise<HmrcTokenSet>;
  now?: () => Date;
}

const DUPLICATE_SUBMISSION = 'DUPLICATE_SUBMISSION';

/**
 * Files the confirmed return for `period` with HMRC. The boxes come from the stored,
 * server-recomputed confirmation, never from the caller. Throws VatReturnError for every refusal.
 */
export async function submitVatReturnForUser(
  { userId, period, request }: { userId: string; period: Period; request: Request },
  { vatStore = databaseStore, hmrcStore = databaseHmrcStore, fetchFn, refresh = refreshAccessToken, now = () => new Date() }: SubmitDeps = {},
) {
  const boxes = await requireConfirmedReturn(userId, period, vatStore);

  // Live needs both switches (deployment env and the user's opt-in). Any disagreement is refused,
  // so the client's env-driven base URL can never reach production on one switch alone.
  const userSandbox = await hmrcStore.sandboxMode(userId);
  const sandbox = process.env.HMRC_SANDBOX_MODE !== 'false';
  if (userSandbox === undefined || userSandbox !== sandbox) {
    throw new VatReturnError(409, 'MODE_MISMATCH', 'HMRC mode in Settings does not match the server mode');
  }

  const credentials = await hmrcStore.credentials(userId);
  if (!credentials) throw new VatReturnError(409, 'HMRC_NOT_CONNECTED', 'HMRC is not connected');
  if (!credentials.vatNumber) throw new VatReturnError(409, 'VAT_NUMBER_MISSING', 'No VAT number is set');
  const { vatNumber, storedRefreshToken } = credentials;

  const submissionId = await vatStore.claimSubmission(userId, period.periodKey, sandbox);
  if (!submissionId) throw new VatReturnError(409, 'ALREADY_SUBMITTED', 'This period has already been submitted or is being submitted');

  const payload = boxesToHmrcPayload(boxes, period.periodKey, true);
  const fraudHeaders = buildFraudHeaders({
    request,
    userId,
    appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    vendorPublicIp: process.env.HMRC_VENDOR_PUBLIC_IP,
    now: now(),
  });

  let hmrcReceipt: { formBundleNumber: string; processingDate: string };
  try {
    hmrcReceipt = await withHmrcToken(
      {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt.getTime(),
      },
      (accessToken) => submitVatReturn(vatNumber, accessToken, payload, fraudHeaders, fetchFn),
      // A failed save must not fail the filing: the rotated token is still valid for this call.
      async (refreshed) => {
        try {
          await hmrcStore.saveRefreshedTokens(userId, storedRefreshToken, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: new Date(refreshed.expiresAt),
          });
        } catch {
          console.error('HMRC refreshed tokens could not be saved');
        }
      },
      refresh,
    );
  } catch (error) {
    const audit = { periodKey: period.periodKey, sandbox, request: payload, fraudHeaders };
    if (error instanceof HmrcError && error.apiError.code === DUPLICATE_SUBMISSION) {
      // HMRC already holds this period, so the claim stays pending to block any retry.
      throw new VatReturnError(409, DUPLICATE_SUBMISSION, 'HMRC already has a return for this period');
    }
    if (error instanceof HmrcError && error.apiError.statusCode >= 400 && error.apiError.statusCode < 500) {
      const { code, statusCode } = error.apiError;
      await vatStore.markFailed(userId, submissionId, { ...audit, response: { code, statusCode } });
      console.error('HMRC submit rejected', code, statusCode);
      throw new VatReturnError(502, code, 'HMRC rejected the return');
    }
    // 5xx or network failure: HMRC may have processed it, so the claim stays pending and blocks a retry.
    console.error('HMRC submit outcome unknown');
    throw unknownOutcome();
  }

  try {
    await vatStore.recordReceipt(
      userId,
      submissionId,
      { formBundleNumber: hmrcReceipt.formBundleNumber, processingDate: new Date(hmrcReceipt.processingDate) },
      { periodKey: period.periodKey, sandbox, request: payload, response: hmrcReceipt, fraudHeaders },
      now(),
    );
  } catch {
    // HMRC accepted the return but we could not record it; the claim stays pending so it is not filed twice.
    console.error('HMRC receipt could not be saved');
    throw unknownOutcome();
  }
  return { ...hmrcReceipt, sandbox };
}

const unknownOutcome = () =>
  new VatReturnError(502, 'OUTCOME_UNKNOWN', 'The outcome is unknown. Do not resubmit; check HMRC before trying again');
