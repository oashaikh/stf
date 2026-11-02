import { describe, expect, it } from 'vitest';
import { buildFraudHeaders } from './fraudHeaders';
import {
  getItsIncomeAndExpenditureObligations,
  getTaxCalculation,
  getVatObligations,
  HmrcError,
  listItsPropertyBusinesses,
  listItsSelfEmploymentBusinesses,
  refreshAccessToken,
  submitAnnualSubmission,
  triggerTaxCalculation,
  submitCumulativePeriodSummary,
  submitPropertyCumulativeSummary,
  submitVatReturn,
  withHmrcToken,
  type CumulativePeriodSummary,
  type HmrcTokenSet,
  type PropertyCumulativeSummary,
  type VatReturnPayload,
} from './client';

// Live calls to the HMRC test API, run only when sandbox credentials are present
// (CI secrets). See docs/runbooks/hmrc-sandbox-integration.md.
const clientId = process.env.HMRC_CLIENT_ID;
const clientSecret = process.env.HMRC_CLIENT_SECRET;
const refreshToken = process.env.HMRC_SANDBOX_REFRESH_TOKEN;
const vrn = process.env.HMRC_SANDBOX_VRN;
const nino = process.env.HMRC_SANDBOX_NINO;
const hasCredentials = Boolean(clientId && clientSecret && refreshToken && vrn && nino);

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

  it('fetches self-employment businesses with a valid token', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const { businessDetails } = await listItsSelfEmploymentBusinesses(
      nino!, tokens.accessToken, fraudHeaders(),
    );
    expect(businessDetails).toBeTruthy();
    expect(Array.isArray(businessDetails)).toBe(true);
    if (businessDetails.length > 0) {
      expect(businessDetails[0]).toHaveProperty('businessId');
      expect(businessDetails[0]).toHaveProperty('typeOfBusiness');
    }
  });

  it('submits a cumulative period summary for a self-employment business', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const { businessDetails } = await listItsSelfEmploymentBusinesses(nino!, tokens.accessToken, fraudHeaders());
    expect(businessDetails.length).toBeGreaterThan(0);
    const businessId = businessDetails[0]!.businessId;
    const payload: CumulativePeriodSummary = {
      periodDates: { periodStartDate: '2024-04-06', periodEndDate: '2024-07-05' },
      periodIncome: { turnover: '5000.00', other: '100.00' },
      periodExpenses: {
        costOfGoods: '250.00',
        carVanTravelExpenses: '150.00',
      },
    };
    await expect(submitCumulativePeriodSummary(
      nino!, businessId, '2024-25', payload, tokens.accessToken, fraudHeaders(),
    )).resolves.not.toThrow();
  });

  it('submits annual allowances for a self-employment business', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const { businessDetails } = await listItsSelfEmploymentBusinesses(nino!, tokens.accessToken, fraudHeaders());
    expect(businessDetails.length).toBeGreaterThan(0);
    await expect(submitAnnualSubmission(
      nino!, businessDetails[0]!.businessId, '2024-25',
      { allowances: { tradingIncomeAllowance: '1000.00' } }, tokens.accessToken, fraudHeaders(),
    )).resolves.toBeUndefined();
  });

  it('triggers a final-declaration calculation and reads it back in pence', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const { calculationId } = await triggerTaxCalculation(nino!, '2024-25', tokens.accessToken, fraudHeaders());
    expect(calculationId).toBeTruthy();
    const calculation = await getTaxCalculation(nino!, '2024-25', calculationId, tokens.accessToken, fraudHeaders());
    for (const pence of Object.values(calculation)) expect(Number.isInteger(pence)).toBe(true);
  });

  it('lists the UK property business, if the test user has one', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const businesses = await listItsPropertyBusinesses(nino!, tokens.accessToken, fraudHeaders());
    expect(businesses.length).toBeLessThanOrEqual(1);
    for (const business of businesses) expect(business.typeOfBusiness).toBe('uk-property');
  });

  it('fetches UK property quarterly obligations', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const [property] = await listItsPropertyBusinesses(nino!, tokens.accessToken, fraudHeaders());
    expect(property).toBeDefined();
    const { obligations } = await getItsIncomeAndExpenditureObligations(
      nino!, property!.businessId, '2024-04-06', '2025-04-05', tokens.accessToken, fraudHeaders(),
      undefined, undefined, 'uk-property',
    );
    expect(Array.isArray(obligations)).toBe(true);
  });

  it('submits a cumulative UK property summary', async () => {
    const tokens = await refreshAccessToken(refreshToken!);
    const [property] = await listItsPropertyBusinesses(nino!, tokens.accessToken, fraudHeaders());
    expect(property).toBeDefined();
    const payload: PropertyCumulativeSummary = {
      fromDate: '2024-04-06',
      toDate: '2024-07-05',
      ukProperty: {
        income: { periodAmount: 2400.5 },
        expenses: { repairsAndMaintenance: 120.25, premisesRunningCosts: 80 },
      },
    };
    await expect(submitPropertyCumulativeSummary(
      nino!, property!.businessId, '2024-25', payload, tokens.accessToken, fraudHeaders(),
    )).resolves.toBeUndefined();
  });
});
