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
function hmrcApiBase(): string {
  return process.env.HMRC_SANDBOX_MODE === 'false'
    ? 'https://api.service.hmrc.gov.uk'
    : 'https://test-api.service.hmrc.gov.uk';
}

export type HmrcTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp ms
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
      'Accept': 'application/vnd.hmrc.1.0+json',
      'Content-Type': 'application/json',
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

  return response.json() as Promise<T>;
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
): Promise<{ obligations: VatObligation[] }> {
  return hmrcFetch(
    `/organisations/vat/${vrn}/obligations?from=${from}&to=${to}`,
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
    `/organisations/vat/${vrn}/returns`,
    accessToken,
    fraudHeaders,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    fetchFn,
  );
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

// ─── OAuth helpers (called server-side only) ──────────────────────────────────

const HMRC_SCOPE = 'read:vat write:vat';

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
    scope: HMRC_SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${authorizeHost}/oauth/authorize?${params.toString()}`;
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number };

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
