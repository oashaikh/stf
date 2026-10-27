import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildHmrcAuthUrl,
  exchangeAuthCode,
  getVatObligations,
  HmrcError,
  refreshAccessToken,
  validateFraudHeaders,
  withHmrcToken,
  type HmrcTokenSet,
} from './client';

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
