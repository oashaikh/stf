import { buildFraudHeaders, vendorVersion } from '../../src/lib/hmrc/fraudHeaders.js';
import { getVatObligations, HmrcError, refreshAccessToken, submitVatReturn, withHmrcToken, type HmrcTokenSet } from '../../src/lib/hmrc/client.js';
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
 * Everything a submission needs before it touches HMRC or claims the period. Submit and the preview
 * both run this, so the body and headers the user inspects are the ones that would be sent.
 */
export async function prepareSubmission(
  { userId, period, request }: { userId: string; period: Period; request: Request },
  vatStore: VatReturnStore,
  hmrcStore: HmrcStore,
  now: () => Date,
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

  const fraudHeaders = buildFraudHeaders({
    request,
    userId,
    appVersion: vendorVersion(),
    vendorPublicIp: process.env.HMRC_VENDOR_PUBLIC_IP,
    now: now(),
  });
  const payload = boxesToHmrcPayload(boxes, period.periodKey, true);

  return { sandbox, vatNumber: credentials.vatNumber, credentials, fraudHeaders, payload };
}

/**
 * Files the confirmed return for `period` with HMRC. The boxes come from the stored,
 * server-recomputed confirmation, never from the caller. Throws VatReturnError for every refusal.
 */
export async function submitVatReturnForUser(
  { userId, period, request }: { userId: string; period: Period; request: Request },
  { vatStore = databaseStore, hmrcStore = databaseHmrcStore, fetchFn, refresh = refreshAccessToken, now = () => new Date() }: SubmitDeps = {},
) {
  const { sandbox, vatNumber, credentials, fraudHeaders, payload } = await prepareSubmission(
    { userId, period, request },
    vatStore,
    hmrcStore,
    now,
  );
  const { storedRefreshToken } = credentials;

  // Both HMRC calls share this token set, so a refresh during the obligations check is reused by the submit
  // instead of spending the rotated-away refresh token a second time.
  let tokens: HmrcTokenSet = {
    accessToken: credentials.accessToken,
    refreshToken: credentials.refreshToken,
    expiresAt: credentials.expiresAt.getTime(),
  };
  const callHmrc = <T>(operation: (accessToken: string) => Promise<T>) =>
    withHmrcToken(
      tokens,
      operation,
      // A failed save must not fail the call: the rotated token is still valid for it.
      async (refreshed) => {
        tokens = refreshed;
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

  // The client picks the period, so only HMRC's own list of this user's open obligations can authorise it.
  // Checked before the claim so a lookup failure leaves nothing pending. No status filter is sent: the
  // obligations list the user sees is unfiltered, and in the live sandbox test a status=O query for the
  // same dates did not return the period that list showed as open. Why HMRC differs is not established; status is
  // checked locally instead, which does not depend on it.
  let openObligations;
  try {
    ({ obligations: openObligations } = await callHmrc((accessToken) =>
      getVatObligations(vatNumber, accessToken, period.start, period.end, fraudHeaders, fetchFn),
    ));
  } catch (error) {
    if (!(error instanceof HmrcError)) throw error;
    console.error('HMRC obligations check failed', error.apiError.code, error.apiError.statusCode);
    throw new VatReturnError(502, error.apiError.code, 'Could not check the open HMRC obligations');
  }
  const isOpen = openObligations.some(
    (obligation) =>
      obligation.status === 'O' &&
      obligation.periodKey === period.periodKey &&
      obligation.start === period.start &&
      obligation.end === period.end,
  );
  if (!isOpen) {
    console.error(
      'HMRC obligations check refused period',
      period.periodKey,
      period.start,
      period.end,
      JSON.stringify(openObligations.map(({ periodKey, start, end, status }) => ({ periodKey, start, end, status }))),
    );
    throw new VatReturnError(409, 'PERIOD_NOT_OPEN', 'This period is not an open HMRC obligation');
  }

  const submissionId = await vatStore.claimSubmission(userId, period.periodKey, sandbox);
  if (!submissionId) throw new VatReturnError(409, 'ALREADY_SUBMITTED', 'This period has already been submitted or is being submitted');

  let hmrcReceipt: { formBundleNumber: string; processingDate: string };
  try {
    hmrcReceipt = await callHmrc((accessToken) => submitVatReturn(vatNumber, accessToken, payload, fraudHeaders, fetchFn));
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
