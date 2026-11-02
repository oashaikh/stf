import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHmrcAuthUrl,
  exchangeAuthCode,
  getItsFinalDeclarationObligations,
  getItsIncomeAndExpenditureObligations,
  getTaxCalculation,
  INDIVIDUAL_CALCULATIONS_API_ACCEPT,
  poundsToPence,
  submitFinalDeclaration,
  triggerTaxCalculation,
  getVatObligations,
  HmrcError,
  refreshAccessToken,
  SELF_EMPLOYMENT_API_ACCEPT,
  submitAnnualSubmission,
  submitCumulativePeriodSummary,
  validateFraudHeaders,
  withHmrcToken,
  type HmrcTokenSet,
} from './client';
import itsObligations from './fixtures/itsObligations.json';

const NOW = 1_700_000_000_000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.stubEnv('HMRC_CLIENT_ID', 'test-client-id');
  vi.stubEnv('HMRC_CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('buildHmrcAuthUrl', () => {
  it('uses the test-www host in sandbox mode with scope, state and redirect_uri', () => {
    const url = new URL(buildHmrcAuthUrl('https://app.test/cb', 'state-1'));
    expect(url.origin).toBe('https://test-www.tax.service.gov.uk');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('scope')).toBe(
      'read:vat write:vat read:self-assessment write:self-assessment',
    );
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/cb');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('uses the live host only when HMRC_SANDBOX_MODE is false', () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    expect(buildHmrcAuthUrl('https://app.test/cb', 's')).toMatch(
      /^https:\/\/www\.tax\.service\.gov\.uk\/oauth\/authorize\?/,
    );
    vi.stubEnv('HMRC_SANDBOX_MODE', '');
    expect(buildHmrcAuthUrl('https://app.test/cb', 's')).toMatch(/test-www/);
  });
});

describe('token calls', () => {
  const tokenBody = { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 14400 };

  it('exchangeAuthCode posts form data and returns a token set', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, tokenBody));
    const tokens = await exchangeAuthCode('the-code', 'https://app.test/cb', fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://test-api.service.hmrc.gov.uk/oauth/token');
    expect(init.method).toBe('POST');
    const form = new URLSearchParams(init.body as string);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      code: 'the-code',
      redirect_uri: 'https://app.test/cb',
    });
    expect(tokens).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: NOW + 14400 * 1000,
    });
  });

  it('returns the scope HMRC granted, and leaves it undefined when omitted', async () => {
    const scoped = vi.fn().mockResolvedValue(jsonResponse(200, { ...tokenBody, scope: 'read:vat write:vat' }));
    expect((await exchangeAuthCode('c', 'https://app.test/cb', scoped)).scope).toBe('read:vat write:vat');
    const unscoped = vi.fn().mockResolvedValue(jsonResponse(200, tokenBody));
    expect((await refreshAccessToken('r', unscoped)).scope).toBeUndefined();
  });

  it('refreshAccessToken posts the refresh grant', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, tokenBody));
    await refreshAccessToken('old-refresh', fetchFn);
    const form = new URLSearchParams(fetchFn.mock.calls[0][1].body as string);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'refresh_token',
      client_id: 'test-client-id',
      client_secret: 'test-client-secret',
      refresh_token: 'old-refresh',
    });
  });

  it('throws HmrcError without token or secret on invalid_grant', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_grant', error_description: 'bad old-refresh' }));
    const error = await refreshAccessToken('old-refresh', fetchFn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HmrcError);
    const hmrcError = error as HmrcError;
    expect(hmrcError.apiError.code).toBe('invalid_grant');
    expect(hmrcError.apiError.statusCode).toBe(400);
    const text = `${hmrcError.message} ${JSON.stringify(hmrcError.apiError)}`;
    expect(text).not.toContain('old-refresh');
    expect(text).not.toContain('test-client-secret');
  });

  it('fails clearly when credentials are missing', async () => {
    vi.stubEnv('HMRC_CLIENT_SECRET', '');
    await expect(refreshAccessToken('r', vi.fn())).rejects.toThrow(/HMRC_CLIENT_SECRET/);
  });
});

describe('getVatObligations', () => {
  it('sends the supplied fraud headers and bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { obligations: [] }));
    await getVatObligations('123456789', 'tok', '2026-01-01', '2026-12-31', { 'Gov-Client-Timezone': 'UTC+00:00' }, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://test-api.service.hmrc.gov.uk/organisations/vat/123456789/obligations?from=2026-01-01&to=2026-12-31',
    );
    expect(init.headers['Gov-Client-Timezone']).toBe('UTC+00:00');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });
});

describe('ITSA obligations', () => {
  const fraud = { 'Gov-Client-Timezone': 'UTC+00:00' };
  const nino = 'AA123456A';

  it('asks for self-employment quarterly updates with Accept 3.0 and fraud headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, itsObligations.incomeAndExpenditure));
    const result = await getItsIncomeAndExpenditureObligations(
      nino, 'XAIS12345678901', '2026-04-06', '2027-04-05', 'tok', fraud, fetchFn,
    );
    const [url, init] = fetchFn.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://test-api.service.hmrc.gov.uk/obligations/details/AA123456A/income-and-expenditure',
    );
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      typeOfBusiness: 'self-employment',
      businessId: 'XAIS12345678901',
      fromDate: '2026-04-06',
      toDate: '2027-04-05',
    });
    expect(init.headers.Accept).toBe('application/vnd.hmrc.3.0+json');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Gov-Client-Timezone']).toBe('UTC+00:00');
    expect(result.obligations[0].obligationDetails[1].status).toBe('Open');
  });

  it('passes the status filter on quarterly updates', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { obligations: [] }));
    await getItsIncomeAndExpenditureObligations(nino, 'B1', '2026-04-06', '2027-04-05', 'tok', fraud, fetchFn, 'Open');
    expect(new URL(fetchFn.mock.calls[0][0]).searchParams.get('status')).toBe('Open');
  });

  it('asks for the final declaration with Accept 3.0 and no business id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, itsObligations.finalDeclaration));
    const result = await getItsFinalDeclarationObligations(
      nino, '2026-04-06', '2027-04-05', 'tok', fraud, fetchFn, 'Fulfilled',
    );
    const [url, init] = fetchFn.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/obligations/details/AA123456A/crystallisation');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      fromDate: '2026-04-06',
      toDate: '2027-04-05',
      status: 'Fulfilled',
    });
    expect(init.headers.Accept).toBe('application/vnd.hmrc.3.0+json');
    expect(init.headers['Gov-Client-Timezone']).toBe('UTC+00:00');
    expect(result.obligations[0].dueDate).toBe('2028-01-31');
  });

  it('maps an HMRC error body to HmrcError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(400, itsObligations.ruleDateRangeInvalid));
    const error = await getItsFinalDeclarationObligations(nino, '2026-04-06', '2030-04-05', 'tok', fraud, fetchFn)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HmrcError);
    expect((error as HmrcError).apiError).toEqual({
      code: 'RULE_DATE_RANGE_INVALID',
      message: 'The date range is invalid',
      statusCode: 400,
    });
  });
});

describe('withHmrcToken', () => {
  const tokens: HmrcTokenSet = { accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: NOW + 60_000 };
  const fresh: HmrcTokenSet = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: NOW + 14_400_000 };
  const unauthorised = () =>
    new HmrcError({ code: 'INVALID_CREDENTIALS', message: 'Invalid Authentication information provided', statusCode: 401 });

  it('refreshes, persists and retries once after a 401', async () => {
    const operation = vi.fn().mockRejectedValueOnce(unauthorised()).mockResolvedValueOnce('ok');
    const refresh = vi.fn().mockResolvedValue(fresh);
    const persist = vi.fn().mockResolvedValue(undefined);
    await expect(withHmrcToken(tokens, operation, persist, refresh)).resolves.toBe('ok');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith('old-refresh');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(fresh);
    expect(operation.mock.calls.map(([token]) => token)).toEqual(['old-access', 'new-access']);
  });

  it('refreshes up front when the token has already expired', async () => {
    const operation = vi.fn().mockResolvedValue('ok');
    const refresh = vi.fn().mockResolvedValue(fresh);
    await withHmrcToken({ ...tokens, expiresAt: NOW - 1 }, operation, vi.fn(), refresh);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith('new-access');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second 401', async () => {
    const operation = vi.fn().mockRejectedValue(unauthorised());
    const refresh = vi.fn().mockResolvedValue(fresh);
    await expect(withHmrcToken(tokens, operation, vi.fn(), refresh)).rejects.toBeInstanceOf(HmrcError);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on non-401 errors', async () => {
    const serverError = new HmrcError({ code: 'SERVER_ERROR', message: 'boom', statusCode: 500 });
    const operation = vi.fn().mockRejectedValue(serverError);
    const refresh = vi.fn();
    await expect(withHmrcToken(tokens, operation, vi.fn(), refresh)).rejects.toBe(serverError);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces a refresh failure without leaking a token', async () => {
    const operation = vi.fn().mockRejectedValue(unauthorised());
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_grant', error_description: 'bad old-refresh' }));
    const error = (await withHmrcToken(
      tokens,
      operation,
      vi.fn(),
      (refreshToken) => refreshAccessToken(refreshToken, fetchFn),
    ).catch((e: unknown) => e)) as HmrcError;
    expect(error).toBeInstanceOf(HmrcError);
    expect(error.apiError.code).toBe('invalid_grant');
    expect(`${error.message} ${JSON.stringify(error.apiError)}`).not.toMatch(/old-refresh|old-access/);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

describe('validateFraudHeaders', () => {
  const SECRET_TOKEN = 'app-token-do-not-leak';
  const headers = { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' };

  function fakeHmrc(validation: Response) {
    return vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/oauth/token')
        ? jsonResponse(200, { access_token: SECRET_TOKEN, expires_in: 14400 })
        : validation.clone(),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  }

  it('uses a client_credentials token and the sandbox endpoint even when live mode is set', async () => {
    vi.stubEnv('HMRC_SANDBOX_MODE', 'false');
    const fetchFn = fakeHmrc(jsonResponse(200, { code: 'VALID_HEADERS', message: 'ok' }));
    const result = await validateFraudHeaders(headers, fetchFn);
    expect(result).toEqual({ code: 'VALID_HEADERS', message: 'ok', errors: [], warnings: [] });
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe('https://test-api.service.hmrc.gov.uk/oauth/token');
    expect(String(calls[0][1].body)).toContain('grant_type=client_credentials');
    expect(calls[1][0]).toBe('https://test-api.service.hmrc.gov.uk/test/fraud-prevention-headers/validate');
    expect(calls[1][1].headers.Authorization).toBe(`Bearer ${SECRET_TOKEN}`);
    expect(calls[1][1].headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
  });

  it('returns warnings with their header names', async () => {
    const result = await validateFraudHeaders(headers, fakeHmrc(jsonResponse(200, {
      code: 'POTENTIALLY_INVALID_HEADERS',
      message: 'Some headers may be wrong',
      warnings: [{ code: 'INVALID_HEADER', message: 'Check it', headers: ['Gov-Client-Multi-Factor'] }],
    })));
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ headers: ['Gov-Client-Multi-Factor'], message: 'Check it' }]);
  });

  it('treats a 400 body with errors as a result', async () => {
    const result = await validateFraudHeaders(headers, fakeHmrc(jsonResponse(400, {
      code: 'INVALID_HEADERS',
      message: 'bad',
      errors: [{ code: 'MISSING_HEADER', message: 'Missing', headers: ['Gov-Vendor-License-IDs'] }],
      warnings: [{ message: 'w', headers: ['Gov-Client-Timezone'] }],
    })));
    expect(result.code).toBe('INVALID_HEADERS');
    expect(result.errors).toEqual([{ headers: ['Gov-Vendor-License-IDs'], message: 'Missing' }]);
    expect(result.warnings).toHaveLength(1);
  });

  it.each([401, 403, 500, 503])('throws on HMRC %i without leaking the token or body', async (status) => {
    const error = await validateFraudHeaders(headers, fakeHmrc(jsonResponse(status, { code: 'X', message: SECRET_TOKEN })))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HmrcError);
    expect(JSON.stringify(error)).not.toContain(SECRET_TOKEN);
    expect((error as Error).message).not.toContain(SECRET_TOKEN);
  });

  it('throws without echoing the response when the token request is rejected', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { error: 'invalid_client', error_description: SECRET_TOKEN }));
    const error = await validateFraudHeaders(headers, fetchFn as unknown as typeof fetch).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HmrcError);
    expect((error as Error).message).not.toContain(SECRET_TOKEN);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('keeps the token out of the returned value', async () => {
    const result = await validateFraudHeaders(headers, fakeHmrc(jsonResponse(200, { code: 'VALID_HEADERS', message: 'ok' })));
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
  });
});

describe('submitCumulativePeriodSummary', () => {
  const payload = {
    periodDates: { periodStartDate: '2026-04-06', periodEndDate: '2026-07-05' },
    periodIncome: { turnover: '1000.00', other: '0.00' },
  };
  const fraudHeaders = { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' };

  it('PUTs the payload to the cumulative path with the API accept header and fraud headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await submitCumulativePeriodSummary('AA123456A', 'biz1', '2026-27', payload, 'tok', fraudHeaders, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/AA123456A/biz1/cumulative/2026-27',
    );
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify(payload));
    expect(init.headers.Accept).toBe(SELF_EMPLOYMENT_API_ACCEPT);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
  });

  it('maps a 4xx to HmrcError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(422, { code: 'RULE_X', message: 'nope' }));
    await expect(
      submitCumulativePeriodSummary('AA123456A', 'biz1', '2026-27', payload, 'tok', fraudHeaders, fetchFn),
    ).rejects.toMatchObject({ apiError: { code: 'RULE_X', statusCode: 422 } });
  });

  it('resolves on an empty 2xx body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    await expect(
      submitCumulativePeriodSummary('AA123456A', 'biz1', '2026-27', payload, 'tok', fraudHeaders, fetchFn),
    ).resolves.toBeUndefined();
  });
});

describe('submitAnnualSubmission', () => {
  const payload = { allowances: { tradingIncomeAllowance: '1000.00' } };
  const fraudHeaders = { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' };

  it('PUTs the body to the annual path with the API accept header and fraud headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await submitAnnualSubmission('AA123456A', 'biz1', '2026-27', payload, 'tok', fraudHeaders, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      'https://test-api.service.hmrc.gov.uk/individuals/business/self-employment/AA123456A/biz1/annual/2026-27',
    );
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify(payload));
    expect(init.headers.Accept).toBe(SELF_EMPLOYMENT_API_ACCEPT);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Gov-Client-Connection-Method']).toBe('WEB_APP_VIA_SERVER');
  });

  it('maps a 4xx to HmrcError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(422, { code: 'RULE_X', message: 'nope' }));
    await expect(
      submitAnnualSubmission('AA123456A', 'biz1', '2026-27', payload, 'tok', fraudHeaders, fetchFn),
    ).rejects.toMatchObject({ apiError: { code: 'RULE_X', statusCode: 422 } });
  });
});

describe('poundsToPence', () => {
  it.each([
    [1234.5, 123450],
    [0.07, 7],
    [0, 0],
    ['19.99', 1999],
    [-3.1, -310],
  ])('converts %s pounds to %s pence without floating point', (pounds, pence) => {
    expect(poundsToPence(pounds as number | string)).toBe(pence);
  });

  it('rejects a value that is not a money amount', () => {
    expect(() => poundsToPence('abc')).toThrow();
    expect(() => poundsToPence(undefined as unknown as number)).toThrow();
  });
});

describe('final declaration calls', () => {
  const nino = 'AA123456A';
  const fraud = { 'Gov-Client-Timezone': 'UTC+00:00' };
  const base = `/individuals/calculations/${nino}/self-assessment/2026-27`;

  it('triggers a final-declaration calculation with the version header and fraud headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { calculationId: 'calc-1' }));
    const result = await triggerTaxCalculation(nino, '2026-27', 'tok', fraud, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(new URL(url).pathname).toBe(`${base}/trigger/intent-to-finalise`);
    expect(init.method).toBe('POST');
    expect(init.headers.Accept).toBe(INDIVIDUAL_CALCULATIONS_API_ACCEPT);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['Gov-Client-Timezone']).toBe('UTC+00:00');
    expect(result).toEqual({ calculationId: 'calc-1' });
  });

  it('fetches a calculation and returns integer pence only', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      calculation: { taxCalculation: {
        incomeTax: { incomeTaxCharged: 1234.5 },
        nics: { class2Nics: { amount: 0.07 }, class4Nics: { totalClass4Charge: 500 } },
        totalIncomeTaxAndNicsDue: 1735.57,
      } },
    }));
    const result = await getTaxCalculation(nino, '2026-27', 'calc-1', 'tok', fraud, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(new URL(url).pathname).toBe(`${base}/calc-1`);
    expect(init.method ?? 'GET').toBe('GET');
    expect(init.headers.Accept).toBe(INDIVIDUAL_CALCULATIONS_API_ACCEPT);
    expect(init.headers['Gov-Client-Timezone']).toBe('UTC+00:00');
    expect(result).toEqual({
      incomeTaxPence: 123450, class2NicPence: 7, class4NicPence: 50000, totalPence: 173557,
    });
  });

  it('treats a missing Class 2 charge as zero', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      calculation: { taxCalculation: {
        incomeTax: { incomeTaxCharged: 10 },
        nics: { class4Nics: { totalClass4Charge: 5 } },
        totalIncomeTaxAndNicsDue: 15,
      } },
    }));
    const result = await getTaxCalculation(nino, '2026-27', 'calc-1', 'tok', fraud, fetchFn);
    expect(result.class2NicPence).toBe(0);
  });

  it('submits the final declaration for a calculation id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(submitFinalDeclaration(nino, '2026-27', 'calc-1', 'tok', fraud, fetchFn)).resolves.toBeUndefined();
    const [url, init] = fetchFn.mock.calls[0];
    expect(new URL(url).pathname).toBe(`${base}/calc-1/final-declaration`);
    expect(init.method).toBe('POST');
    expect(init.headers.Accept).toBe(INDIVIDUAL_CALCULATIONS_API_ACCEPT);
    expect(init.headers['Gov-Client-Timezone']).toBe('UTC+00:00');
  });

  it('maps an HMRC rejection of the declaration to HmrcError', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { code: 'RULE_FINAL_DECLARATION_RECEIVED', message: 'Already received' }));
    await expect(submitFinalDeclaration(nino, '2026-27', 'calc-1', 'tok', fraud, fetchFn))
      .rejects.toMatchObject({ apiError: { code: 'RULE_FINAL_DECLARATION_RECEIVED', statusCode: 403 } });
  });
});
