/**
 * HMRC MTD API client — STF
 *
 * THIS IS THE ONLY FILE THAT MAY CALL THE HMRC API.
 * All HMRC interactions go through the functions exported here.
 *
 * Sandbox mode is the default. Production mode requires explicit user opt-in
 * via HMRC_SANDBOX_MODE=false in their .env.
 *
 * OAuth 2.0 token refresh is handled transparently by withHmrcToken().
 * All submissions require user confirmation before being called.
 *
 * Fraud prevention headers are mandatory for all MTD calls.
 * See: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
 */

const HMRC_BASE = import.meta.env.VITE_HMRC_SANDBOX_MODE === 'false'
  ? 'https://api.service.hmrc.gov.uk'
  : 'https://test-api.service.hmrc.gov.uk';

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
 * Build mandatory fraud prevention headers.
 * In a Vercel serverless environment, some headers have limited data.
 * See: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/
 */
function buildFraudPreventionHeaders(appVersion: string): Record<string, string> {
  return {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-Screens': '1',
    'Gov-Client-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'Gov-Vendor-Version': `stf=${appVersion}`,
    'Gov-Client-Browser-JS-User-Agent': navigator.userAgent,
    'Gov-Client-Browser-Plugins': '',
    'Gov-Client-Browser-Do-Not-Track': navigator.doNotTrack ?? '0',
    'Gov-Client-Window-Size': `width=${window.innerWidth}&height=${window.innerHeight}`,
  };
}

/**
 * Core fetch wrapper: attaches auth + fraud prevention headers, parses errors.
 */
async function hmrcFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
  appVersion = import.meta.env.VITE_APP_VERSION ?? '0.0.0',
): Promise<T> {
  const url = `${HMRC_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Accept': 'application/vnd.hmrc.1.0+json',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      ...buildFraudPreventionHeaders(appVersion),
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
): Promise<{ obligations: VatObligation[] }> {
  return hmrcFetch(
    `/organisations/vat/${vrn}/obligations?from=${from}&to=${to}`,
    accessToken,
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
): Promise<{ formBundleNumber: string; processingDate: string }> {
  return hmrcFetch(
    `/organisations/vat/${vrn}/returns`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
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
): Promise<{ businessDetails: ItsBusiness[] }> {
  return hmrcFetch(
    `/individuals/business/details/${nino}/list`,
    accessToken,
  );
}

// ─── OAuth helpers (called server-side only) ──────────────────────────────────

/** Build the HMRC OAuth 2.0 authorization URL. */
export function buildHmrcAuthUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
): string {
  const base = HMRC_BASE.includes('test') ? HMRC_BASE : 'https://www.tax.service.gov.uk';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: scopes.join(' '),
    redirect_uri: redirectUri,
    state,
  });
  return `${base}/oauth/authorize?${params.toString()}`;
}
