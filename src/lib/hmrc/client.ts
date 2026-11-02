import type { AnnualSubmission } from '../itsAnnualSubmission.js';
/**
 * HMRC MTD API client — STF
 *
 * THIS IS THE ONLY FILE THAT MAY CALL THE HMRC API.
 * All HMRC interactions go through the functions exported here.
 *
 * Sandbox mode is the default. Production mode requires explicit user opt-in
 * in Settings plus HMRC_SANDBOX_MODE=false in the server environment.
 *
 * OAuth 2.0 token refresh is handled transparently by withHmrcToken().
 * All submissions require user confirmation before being called.
 *
 * Fraud prevention headers are mandatory for all MTD calls; callers build them
 * server-side (see fraudHeaders.ts) and pass them in.
 * See: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
 */

// Read at call time so importing this module touches no browser or build-time globals.
// Anything other than the literal string 'false' stays on the sandbox.
export function hmrcApiBase(): string {
  return process.env.HMRC_SANDBOX_MODE === 'false'
    ? 'https://api.service.hmrc.gov.uk'
    : 'https://test-api.service.hmrc.gov.uk';
}

export const HMRC_JSON_HEADERS = {
  'Accept': 'application/vnd.hmrc.1.0+json',
  'Content-Type': 'application/json',
};

export const vatReturnsPath = (vrn: string) => `/organisations/vat/${vrn}/returns`;

export type HmrcTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
  scope?: string; // as granted by HMRC; refresh responses may omit it
};

export type HmrcApiError = {
  code: string;
  message: string;
  statusCode: number;
};

export class HmrcError extends Error {
  constructor(
    public readonly apiError: HmrcApiError,
    message?: string,
  ) {
    super(message ?? `HMRC API error ${apiError.statusCode}: ${apiError.message}`);
    this.name = 'HmrcError';
  }
}

/**
 * Core fetch wrapper: attaches auth + fraud prevention headers, parses errors.
 */
async function hmrcFetch<T>(
  path: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  options: RequestInit = {},
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  const url = `${hmrcApiBase()}${path}`;
  const response = await fetchFn(url, {
    ...options,
    headers: {
      ...HMRC_JSON_HEADERS,
      'Authorization': `Bearer ${accessToken}`,
      ...fraudHeaders,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let apiError: HmrcApiError;
    try {
      const body = await response.json();
      apiError = {
        code: body.code ?? 'UNKNOWN',
        message: body.message ?? response.statusText,
        statusCode: response.status,
      };
    } catch {
      apiError = {
        code: 'PARSE_ERROR',
        message: response.statusText,
        statusCode: response.status,
      };
    }
    throw new HmrcError(apiError);
  }

  // Some HMRC writes answer 204 or 200 with no body; response.json() would throw on those.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ─── Income Tax: Self Employment Business API ────────────────────────────────

// Cumulative period summary, from the 2025-26 tax year. Field names follow HMRC's Self Employment
// Business API v5.0 (PUT .../cumulative/{taxYear}). They were written from the published spec
// without live access to the docs page at build time: recheck against
// https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/self-employment-business-api
// before the first sandbox submission.
export const SELF_EMPLOYMENT_API_ACCEPT = 'application/vnd.hmrc.5.0+json';

export const selfEmploymentCumulativePath = (nino: string, businessId: string, taxYear: string) =>
  `/individuals/business/self-employment/${nino}/${businessId}/cumulative/${taxYear}`;

/** Every amount is a pounds string with two decimals. */
export type CumulativePeriodSummary = {
  periodDates: { periodStartDate: string; periodEndDate: string };
  periodIncome: { turnover: string; other: string };
  /** Omitted when the trading allowance is claimed: HMRC rejects both. */
  periodExpenses?: Partial<Record<
    | 'costOfGoods' | 'carVanTravelExpenses' | 'premisesRunningCosts' | 'adminCosts'
    | 'advertisingCosts' | 'professionalFees' | 'financeCharges' | 'otherExpenses',
    string
  >>;
  periodAllowances?: { tradingIncomeAllowance: string };
};

/** Submit a cumulative update. MUST only be called after user explicitly confirms. HMRC may reply with no body. */
export async function submitCumulativePeriodSummary(
  nino: string,
  businessId: string,
  taxYear: string,
  payload: CumulativePeriodSummary,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<void> {
  await hmrcFetch<void>(
    selfEmploymentCumulativePath(nino, businessId, taxYear),
    accessToken,
    fraudHeaders,
    {
      method: 'PUT',
      headers: { Accept: SELF_EMPLOYMENT_API_ACCEPT },
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
}

export const selfEmploymentAnnualPath = (nino: string, businessId: string, taxYear: string) =>
  `/individuals/business/self-employment/${nino}/${businessId}/annual/${taxYear}`;

/**
 * Submit the year's allowances and adjustments. MUST only be called after user explicitly confirms.
 * Endpoint and field names were not checked against live HMRC docs: recheck them (same page as the
 * cumulative call above) before the first sandbox submission. HMRC may reply with no body.
 */
export async function submitAnnualSubmission(
  nino: string,
  businessId: string,
  taxYear: string,
  payload: AnnualSubmission,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<void> {
  await hmrcFetch<void>(
    selfEmploymentAnnualPath(nino, businessId, taxYear),
    accessToken,
    fraudHeaders,
    {
      method: 'PUT',
      headers: { Accept: SELF_EMPLOYMENT_API_ACCEPT },
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
}

// ─── Individual Calculations (final declaration) ─────────────────────────────

// Individual Calculations API v8.0. Version, paths and field names were written from the published
// spec without live access to the docs page at build time: recheck against
// https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/individual-calculations-api
// before the first sandbox call.
export const INDIVIDUAL_CALCULATIONS_API_ACCEPT = 'application/vnd.hmrc.8.0+json';

export const individualCalculationsPath = (nino: string, taxYear: string) =>
  `/individuals/calculations/${nino}/self-assessment/${taxYear}`;

/**
 * Pounds as HMRC returns them (a JSON number or string) to integer pence, by string maths.
 * String(number) is the shortest round-trip form, so 1234.5 and 0.07 stay exact.
 */
export function poundsToPence(pounds: number | string): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(pounds));
  if (!match) throw new Error(`Not a money amount: ${String(pounds)}`);
  const [, sign, whole, fraction = ''] = match;
  const pence = Number(whole + fraction.padEnd(2, '0').slice(0, 2));
  return sign ? -pence : pence;
}

export type TaxCalculationResult = {
  incomeTaxPence: number;
  class2NicPence: number;
  class4NicPence: number;
  totalPence: number;
};

/** Ask HMRC to calculate the year's liability ahead of the final declaration. */
export function triggerTaxCalculation(
  nino: string,
  taxYear: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<{ calculationId: string }> {
  return hmrcFetch(
    `${individualCalculationsPath(nino, taxYear)}/trigger/intent-to-finalise`,
    accessToken,
    fraudHeaders,
    { method: 'POST', headers: { Accept: INDIVIDUAL_CALCULATIONS_API_ACCEPT } },
    fetchFn,
  );
}

type RawTaxCalculation = {
  calculation: {
    taxCalculation: {
      incomeTax: { incomeTaxCharged: number | string };
      nics?: {
        class2Nics?: { amount?: number | string };
        class4Nics?: { totalClass4Charge?: number | string };
      };
      totalIncomeTaxAndNicsDue: number | string;
    };
  };
};

export async function getTaxCalculation(
  nino: string,
  taxYear: string,
  calculationId: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<TaxCalculationResult> {
  const raw = await hmrcFetch<RawTaxCalculation>(
    `${individualCalculationsPath(nino, taxYear)}/${encodeURIComponent(calculationId)}`,
    accessToken,
    fraudHeaders,
    { headers: { Accept: INDIVIDUAL_CALCULATIONS_API_ACCEPT } },
    fetchFn,
  );
  const { incomeTax, nics, totalIncomeTaxAndNicsDue } = raw.calculation.taxCalculation;
  return {
    incomeTaxPence: poundsToPence(incomeTax.incomeTaxCharged),
    class2NicPence: poundsToPence(nics?.class2Nics?.amount ?? 0),
    class4NicPence: poundsToPence(nics?.class4Nics?.totalClass4Charge ?? 0),
    totalPence: poundsToPence(totalIncomeTaxAndNicsDue),
  };
}

/** Submit the final declaration. MUST only be called after the owner ticks HMRC's declaration wording. */
export async function submitFinalDeclaration(
  nino: string,
  taxYear: string,
  calculationId: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<void> {
  await hmrcFetch<void>(
    `${individualCalculationsPath(nino, taxYear)}/${encodeURIComponent(calculationId)}/final-declaration`,
    accessToken,
    fraudHeaders,
    { method: 'POST', headers: { Accept: INDIVIDUAL_CALCULATIONS_API_ACCEPT } },
    fetchFn,
  );
}

// ─── VAT ──────────────────────────────────────────────────────────────────────

export type VatObligation = {
  start: string;  // YYYY-MM-DD
  end: string;
  due: string;
  status: 'O' | 'F'; // Open | Fulfilled
  periodKey: string;
  received?: string;
};

export async function getVatObligations(
  vrn: string,
  accessToken: string,
  from: string,
  to: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
  status?: VatObligation['status'],
): Promise<{ obligations: VatObligation[] }> {
  return hmrcFetch(
    `/organisations/vat/${vrn}/obligations?from=${from}&to=${to}${status ? `&status=${status}` : ''}`,
    accessToken,
    fraudHeaders,
    {},
    fetchFn,
  );
}

export type VatReturnPayload = {
  periodKey: string;
  vatDueSales: number;
  vatDueAcquisitions: number;
  totalVatDue: number;
  vatReclaimedCurrPeriod: number;
  netVatDue: number;
  totalValueSalesExVAT: number;
  totalValuePurchasesExVAT: number;
  totalValueGoodsSuppliedExVAT: number;
  totalAcquisitionsExVAT: number;
  finalised: boolean;
};

/** Submit a VAT return. MUST only be called after user explicitly confirms. */
export async function submitVatReturn(
  vrn: string,
  accessToken: string,
  payload: VatReturnPayload,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<{ formBundleNumber: string; processingDate: string }> {
  return hmrcFetch(
    vatReturnsPath(vrn),
    accessToken,
    fraudHeaders,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
}

/** A return as HMRC holds it; money is in pounds, as HMRC sends it. */
export type FiledVatReturn = Omit<VatReturnPayload, 'finalised'>;

export async function getVatReturn(
  vrn: string,
  periodKey: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<FiledVatReturn> {
  // Period keys such as "#001" contain characters that need escaping in a path.
  return hmrcFetch(`${vatReturnsPath(vrn)}/${encodeURIComponent(periodKey)}`, accessToken, fraudHeaders, {}, fetchFn);
}

// ─── Income Tax Self-Assessment (ITSA) ────────────────────────────────────────

export type ItsBusiness = {
  businessId: string;
  typeOfBusiness: string;
  tradingName?: string;
};

export async function listItsSelfEmploymentBusinesses(
  nino: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<{ businessDetails: ItsBusiness[] }> {
  return hmrcFetch(
    `/individuals/business/details/${nino}/list`,
    accessToken,
    fraudHeaders,
    {},
    fetchFn,
  );
}

/** Businesses of type uk-property only; HMRC allows one, so the list is empty or has a single entry. */
export async function listItsPropertyBusinesses(
  nino: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<ItsBusiness[]> {
  const { businessDetails } = await listItsSelfEmploymentBusinesses(nino, accessToken, fraudHeaders, fetchFn);
  return businessDetails.filter((business) => business.typeOfBusiness === 'uk-property');
}

// ─── Income Tax: Property Business API ───────────────────────────────────────

// Cumulative UK property summary, Property Business API v6.0
// (PUT /individuals/business/property/uk/{nino}/{businessId}/cumulative/{taxYear}). Written from the
// published spec without live access to the docs page at build time: recheck the path, accept header
// and field names against
// https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/property-business-api
// before the first sandbox submission.
export const PROPERTY_BUSINESS_API_ACCEPT = 'application/vnd.hmrc.6.0+json';

export const propertyCumulativePath = (nino: string, businessId: string, taxYear: string) =>
  `/individuals/business/property/uk/${nino}/${businessId}/cumulative/${taxYear}`;

/** Amounts are JSON numbers in pounds, as the Property Business API expects (unlike the self-employment strings). */
export type PropertyCumulativeSummary = {
  fromDate: string;
  toDate: string;
  ukProperty: {
    income?: Partial<Record<
      'premiumsOfLeaseGrant' | 'reversePremiums' | 'periodAmount' | 'taxDeducted' | 'otherIncome',
      number
    >>;
    expenses?: Partial<Record<
      | 'premisesRunningCosts' | 'repairsAndMaintenance' | 'financialCosts' | 'professionalFees'
      | 'costOfServices' | 'other' | 'travelCosts',
      number
    >>;
  };
};

/** Submit a cumulative property update. MUST only be called after user explicitly confirms. HMRC may reply with no body. */
export async function submitPropertyCumulativeSummary(
  nino: string,
  businessId: string,
  taxYear: string,
  payload: PropertyCumulativeSummary,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<void> {
  await hmrcFetch<void>(
    propertyCumulativePath(nino, businessId, taxYear),
    accessToken,
    fraudHeaders,
    {
      method: 'PUT',
      headers: { Accept: PROPERTY_BUSINESS_API_ACCEPT },
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
}

export const propertyAnnualPath = (nino: string, businessId: string, taxYear: string) =>
  `/individuals/business/property/uk/${nino}/${businessId}/annual/${taxYear}`;

/** Amounts are JSON numbers in pounds. STF records no adjustments, so only the allowance is sent. */
export type PropertyAnnualSubmission = {
  ukProperty: { allowances?: { propertyIncomeAllowance: number } };
};

/** Submit the annual property allowances. MUST only be called after user explicitly confirms. */
export async function submitPropertyAnnualSubmission(
  nino: string,
  businessId: string,
  taxYear: string,
  payload: PropertyAnnualSubmission,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
): Promise<void> {
  await hmrcFetch<void>(
    propertyAnnualPath(nino, businessId, taxYear),
    accessToken,
    fraudHeaders,
    {
      method: 'PUT',
      headers: { Accept: PROPERTY_BUSINESS_API_ACCEPT },
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
}

export type ItsObligationStatus = 'Open' | 'Fulfilled';

export type ItsObligationDetail = {
  periodStartDate: string; // YYYY-MM-DD
  periodEndDate: string;
  dueDate: string;
  status: ItsObligationStatus;
  receivedDate?: string;
};

export type ItsIncomeAndExpenditureObligations = {
  obligations: {
    typeOfBusiness: string;
    businessId: string;
    obligationDetails: ItsObligationDetail[];
  }[];
};

export type ItsFinalDeclarationObligations = { obligations: ItsObligationDetail[] };

// The Obligations API is only served at version 3.0, unlike the 1.0 default.
const ITS_OBLIGATIONS_HEADERS = { Accept: 'application/vnd.hmrc.3.0+json' };

const itsObligationsPath = (nino: string, kind: 'income-and-expenditure' | 'crystallisation') =>
  `/obligations/details/${encodeURIComponent(nino)}/${kind}`;

/** Quarterly update obligations for one self-employment business. */
export async function getItsIncomeAndExpenditureObligations(
  nino: string,
  businessId: string,
  fromDate: string,
  toDate: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
  status?: ItsObligationStatus,
  typeOfBusiness: 'self-employment' | 'uk-property' = 'self-employment',
): Promise<ItsIncomeAndExpenditureObligations> {
  const query = new URLSearchParams({ typeOfBusiness, businessId, fromDate, toDate });
  if (status) query.set('status', status);
  return hmrcFetch(
    `${itsObligationsPath(nino, 'income-and-expenditure')}?${query}`,
    accessToken,
    fraudHeaders,
    { headers: ITS_OBLIGATIONS_HEADERS },
    fetchFn,
  );
}

/** Final declaration (crystallisation) obligations; these are per taxpayer, not per business. */
export async function getItsFinalDeclarationObligations(
  nino: string,
  fromDate: string,
  toDate: string,
  accessToken: string,
  fraudHeaders: Record<string, string>,
  fetchFn?: typeof fetch,
  status?: ItsObligationStatus,
): Promise<ItsFinalDeclarationObligations> {
  const query = new URLSearchParams({ fromDate, toDate });
  if (status) query.set('status', status);
  return hmrcFetch(
    `${itsObligationsPath(nino, 'crystallisation')}?${query}`,
    accessToken,
    fraudHeaders,
    { headers: ITS_OBLIGATIONS_HEADERS },
    fetchFn,
  );
}

// ─── OAuth helpers (called server-side only) ──────────────────────────────────

const HMRC_VAT_SCOPE = 'read:vat write:vat';
const HMRC_ITSA_SCOPE = 'read:self-assessment write:self-assessment';

function requireEnv(name: 'HMRC_CLIENT_ID' | 'HMRC_CLIENT_SECRET'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Build the HMRC OAuth 2.0 authorization URL. */
export function buildHmrcAuthUrl(redirectUri: string, state: string): string {
  const authorizeHost = process.env.HMRC_SANDBOX_MODE === 'false'
    ? 'https://www.tax.service.gov.uk'
    : 'https://test-www.tax.service.gov.uk';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('HMRC_CLIENT_ID'),
    scope: `${HMRC_VAT_SCOPE} ${HMRC_ITSA_SCOPE}`,
    redirect_uri: redirectUri,
    state,
  });
  return `${authorizeHost}/oauth/authorize?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; scope?: string };

/**
 * The error carries only HMRC's error code and status, never its description,
 * which can echo back the submitted code or refresh token.
 */
async function postTokenRequest(
  grantFields: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<HmrcTokenSet> {
  const body = new URLSearchParams({
    ...grantFields,
    client_id: requireEnv('HMRC_CLIENT_ID'),
    client_secret: requireEnv('HMRC_CLIENT_SECRET'),
  });
  const response = await fetchFn(`${hmrcApiBase()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as { error?: unknown };
    const code = typeof errorBody.error === 'string' ? errorBody.error : 'UNKNOWN';
    throw new HmrcError(
      { code, message: 'HMRC token request rejected', statusCode: response.status },
      `HMRC token request failed (${response.status} ${code})`,
    );
  }

  const tokens = (await response.json()) as TokenResponse;
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
  };
}

export function exchangeAuthCode(
  code: string,
  redirectUri: string,
  fetchFn: typeof fetch = fetch,
): Promise<HmrcTokenSet> {
  return postTokenRequest(
    { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    fetchFn,
  );
}

export function refreshAccessToken(
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<HmrcTokenSet> {
  return postTokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, fetchFn);
}

// ─── Transparent token refresh ────────────────────────────────────────────────

/**
 * Run an HMRC call with the stored access token. Refreshes first if the token
 * has expired, and once more if HMRC answers 401. The new tokens are persisted
 * before the retry so a refresh token HMRC has rotated is never lost. A second
 * 401 or a failed refresh is rethrown as is; HmrcError messages never carry tokens.
 */
export async function withHmrcToken<T>(
  tokens: HmrcTokenSet,
  operation: (accessToken: string) => Promise<T>,
  persist: (refreshed: HmrcTokenSet) => Promise<void>,
  refresh: (refreshToken: string) => Promise<HmrcTokenSet> = refreshAccessToken,
): Promise<T> {
  const renew = async (): Promise<HmrcTokenSet> => {
    const refreshed = await refresh(tokens.refreshToken);
    await persist(refreshed);
    return refreshed;
  };

  if (tokens.expiresAt <= Date.now()) {
    return operation((await renew()).accessToken);
  }
  try {
    return await operation(tokens.accessToken);
  } catch (error) {
    if (!(error instanceof HmrcError) || error.apiError.statusCode !== 401) throw error;
    return operation((await renew()).accessToken);
  }
}

// ─── Test Fraud Prevention Headers (sandbox only) ─────────────────────────────

// Always the sandbox: the validator does not exist on the live API, and a check
// must never touch live filing whatever HMRC_SANDBOX_MODE says.
const HMRC_SANDBOX_API_BASE = 'https://test-api.service.hmrc.gov.uk';

export type FraudHeaderFinding = { headers: string[]; message: string };

export type FraudHeaderValidation = {
  code: string;
  message: string;
  errors: FraudHeaderFinding[];
  warnings: FraudHeaderFinding[];
};

/**
 * The validator is application-restricted, so it takes a client_credentials
 * token for the app rather than a user's token. Callers hold it only for the
 * duration of one check.
 */
export async function getApplicationToken(fetchFn: typeof fetch = fetch): Promise<string> {
  const response = await fetchFn(`${HMRC_SANDBOX_API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: requireEnv('HMRC_CLIENT_ID'),
      client_secret: requireEnv('HMRC_CLIENT_SECRET'),
    }).toString(),
  });
  if (!response.ok) {
    throw new HmrcError(
      { code: 'TOKEN_REQUEST_FAILED', message: 'HMRC application token request rejected', statusCode: response.status },
      `HMRC application token request failed (${response.status})`,
    );
  }
  const { access_token } = (await response.json()) as { access_token?: string };
  if (!access_token) {
    throw new HmrcError({ code: 'TOKEN_REQUEST_FAILED', message: 'HMRC returned no access token', statusCode: 502 });
  }
  return access_token;
}

function toFindings(entries: unknown): FraudHeaderFinding[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry: { headers?: unknown; message?: unknown }) => ({
    headers: Array.isArray(entry.headers) ? entry.headers.filter((h): h is string => typeof h === 'string') : [],
    message: typeof entry.message === 'string' ? entry.message : '',
  }));
}

/**
 * Ask HMRC to check the given fraud headers. HMRC answers 400 with the same
 * body shape when it finds errors, so a body carrying a code is a result, not
 * a failure; anything else non-2xx throws without echoing the response.
 */
export async function validateFraudHeaders(
  fraudHeaders: Record<string, string>,
  fetchFn: typeof fetch = fetch,
): Promise<FraudHeaderValidation> {
  const accessToken = await getApplicationToken(fetchFn);
  const response = await fetchFn(`${HMRC_SANDBOX_API_BASE}/test/fraud-prevention-headers/validate`, {
    headers: {
      Accept: HMRC_JSON_HEADERS.Accept,
      Authorization: `Bearer ${accessToken}`,
      ...fraudHeaders,
    },
  });
  const body = (await response.json().catch(() => null)) as
    | { code?: unknown; message?: unknown; errors?: unknown; warnings?: unknown }
    | null;
  const isResult = typeof body?.code === 'string' && (response.ok || response.status === 400);
  if (!isResult) {
    throw new HmrcError(
      { code: 'VALIDATION_REQUEST_FAILED', message: 'HMRC header validation request failed', statusCode: response.status },
      `HMRC fraud header validation failed (${response.status})`,
    );
  }
  return {
    code: body.code as string,
    message: typeof body.message === 'string' ? body.message : '',
    errors: toFindings(body.errors),
    warnings: toFindings(body.warnings),
  };
}
