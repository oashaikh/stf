import { buildFraudHeaders, vendorVersion } from '../../src/lib/hmrc/fraudHeaders.js';
import { HmrcError, refreshAccessToken, withHmrcToken, type HmrcTokenSet } from '../../src/lib/hmrc/client.js';
import { readSecondFactor } from './ownerSession.js';
import type { HmrcCredentials, HmrcStore } from './hmrcStore.js';

/** The one place the fraud-header inputs are assembled, so submit, preview, obligations and the check send the same set. */
export function requestFraudHeaders(request: Request, userId: string, now: Date): Record<string, string> {
  const secondFactor = readSecondFactor(request, now);
  return buildFraudHeaders({
    request,
    userId,
    appVersion: vendorVersion(),
    vendorPublicIp: process.env.HMRC_VENDOR_PUBLIC_IP,
    vendorLicenseId: process.env.HMRC_VENDOR_LICENSE_ID,
    now,
    secondFactor: secondFactor
      ? { type: secondFactor.type, time: secondFactor.authenticatedAt, uniqueReference: secondFactor.referenceHash }
      : undefined,
  });
}

export interface HmrcCallDeps {
  refresh?: (refreshToken: string) => Promise<HmrcTokenSet>;
  now?: () => Date;
}

/**
 * Runs one HMRC call for the signed-in owner with fraud headers, token refresh and the saved rotated tokens.
 * An HMRC failure becomes a 502 carrying only HMRC's code and status; anything else is rethrown.
 */
export async function callHmrcAsUser(
  options: {
    request: Request;
    userId: string;
    credentials: HmrcCredentials;
    store: HmrcStore;
    label: string;
    call: (accessToken: string, fraudHeaders: Record<string, string>) => Promise<Response>;
  },
  { refresh = refreshAccessToken, now = () => new Date() }: HmrcCallDeps = {},
): Promise<Response> {
  const { request, userId, credentials, store, label, call } = options;
  const { storedRefreshToken } = credentials;
  const fraudHeaders = requestFraudHeaders(request, userId, now());

  try {
    return await withHmrcToken(
      {
        accessToken: credentials.accessToken,
        refreshToken: credentials.refreshToken,
        expiresAt: credentials.expiresAt.getTime(),
      },
      (accessToken) => call(accessToken, fraudHeaders),
      // A lost compare-and-swap means a concurrent request already rotated the stored tokens; ours still serve this retry.
      // A failed save must not fail the request: the rotated token is still valid for this call.
      async (refreshed) => {
        try {
          await store.saveRefreshedTokens(userId, storedRefreshToken, {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: new Date(refreshed.expiresAt),
          });
        } catch {
          // The error text can echo tokens, so log a fixed message only. The user may need to reconnect HMRC.
          console.error('HMRC refreshed tokens could not be saved');
        }
      },
      refresh,
    );
  } catch (error) {
    if (!(error instanceof HmrcError)) throw error;
    // Log the HMRC code and status only: its message can echo tokens or the VAT number.
    console.error(`HMRC ${label} error`, error.apiError.code, error.apiError.statusCode);
    return Response.json(
      { ok: false, error: 'HMRC request failed', code: error.apiError.code, hmrcStatus: error.apiError.statusCode },
      { status: 502 },
    );
  }
}
