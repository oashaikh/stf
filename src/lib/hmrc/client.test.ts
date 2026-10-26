import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildHmrcAuthUrl, exchangeAuthCode, HmrcError, refreshAccessToken } from './client';

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
    expect(url.searchParams.get('scope')).toBe('read:vat write:vat');
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
