import { describe, expect, it } from 'vitest';
import { buildFraudHeaders } from './fraudHeaders';
import {
  getVatObligations,
  HmrcError,
  refreshAccessToken,
  submitVatReturn,
  withHmrcToken,
  type HmrcTokenSet,
  type VatReturnPayload,
} from './client';

// Live calls to the HMRC test API, run only when sandbox credentials are present
// (CI secrets). See docs/runbooks/hmrc-sandbox-integration.md.
const clientId = process.env.HMRC_CLIENT_ID;
const clientSecret = process.env.HMRC_CLIENT_SECRET;
const refreshToken = process.env.HMRC_SANDBOX_REFRESH_TOKEN;
const vrn = process.env.HMRC_SANDBOX_VRN;
const hasCredentials = Boolean(clientId && clientSecret && refreshToken && vrn);

// Never let this suite reach production, whatever the shell has exported.
const sandboxOnly = process.env.HMRC_SANDBOX_MODE !== 'false';

const payload: VatReturnPayload = {
  periodKey: '18A1',
  vatDueSales: 100.0,
  vatDueAcquisitions: 0,
  totalVatDue: 100.0,
  vatReclaimedCurrPeriod: 20.0,
  netVatDue: 80.0,
  totalValueSalesExVAT: 500,
  totalValuePurchasesExVAT: 100,
  totalValueGoodsSuppliedExVAT: 0,
  totalAcquisitionsExVAT: 0,
  finalised: true,
};

function fraudHeaders(testScenario?: string): Record<string, string> {
  const headers = buildFraudHeaders({
    request: new Request('https://stf.invalid/api/vat/submit'),
    userId: 'integration-test-user',
    appVersion: 'integration-test',
    now: new Date(),
  });
  return testScenario ? { ...headers, 'Gov-Test-Scenario': testScenario } : headers;
}

describe.skipIf(!hasCredentials || !sandboxOnly)('HMRC sandbox integration', () => {
  it('exchanges a refresh token for a fresh access token', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it('fetches VAT obligations with a valid token', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const { obligations } = await getVatObligations(
      vrn!, tokens.accessToken, '2017-04-06', '2017-12-31', fraudHeaders(),
    );
    expect(obligations.length).toBeGreaterThan(0);
    expect(obligations[0]).toHaveProperty('periodKey');
  });

  it('refreshes an expired token before the call and persists the new one', async () => {
    const expired: HmrcTokenSet = { accessToken: 'expired', refreshToken: refreshToken!, expiresAt: Date.now() - 1000 };
    const persisted: HmrcTokenSet[] = [];
    const { obligations } = await withHmrcToken(
      expired,
      (accessToken) => getVatObligations(vrn!, accessToken, '2017-04-06', '2017-12-31', fraudHeaders()),
      async (refreshed) => { persisted.push(refreshed); },
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0].accessToken).not.toBe('expired');
    expect(obligations.length).toBeGreaterThan(0);
  });

  it('accepts a VAT return submission', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const receipt = await submitVatReturn(vrn!, tokens.accessToken, payload, fraudHeaders());
    expect(receipt.formBundleNumber).toBeTruthy();
  });

  it('rejects a duplicate submission', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const attempt = submitVatReturn(vrn!, tokens.accessToken, payload, fraudHeaders('DUPLICATE_SUBMISSION'));
    await expect(attempt).rejects.toBeInstanceOf(HmrcError);
    await expect(attempt).rejects.toMatchObject({ apiError: { code: 'DUPLICATE_SUBMISSION', statusCode: 403 } });
  });
});
