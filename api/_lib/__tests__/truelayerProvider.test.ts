import { describe, expect, it, vi } from 'vitest';

import { createTrueLayerProvider } from '../truelayerProvider.js';
import { accountsResponse, tokenResponse, transactionsResponse } from './fixtures/truelayerSandbox.js';

const config = { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'http://localhost:5173/settings/bank/callback' };

function providerReturning(body: unknown, status = 200) {
  const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  return { fetchFn, provider: createTrueLayerProvider(config, fetchFn as unknown as typeof fetch) };
}

describe('TrueLayer provider (sandbox)', () => {
  it('builds a sandbox consent URL carrying the state', () => {
    const { provider } = providerReturning({});
    const url = new URL(provider.startConsent('state-123'));
    expect(url.origin).toBe('https://auth.truelayer-sandbox.com');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
  });

  it('exchanges the consent code for tokens', async () => {
    const { provider, fetchFn } = providerReturning(tokenResponse);
    const tokens = await provider.finishConsent('code-1', new Date('2026-11-01T10:00:00Z'));
    expect(tokens).toEqual({
      accessToken: 'sandbox-access-token',
      refreshToken: 'sandbox-refresh-token',
      expiresAt: new Date('2026-11-01T11:00:00Z'),
    });
    expect(fetchFn.mock.calls[0][0]).toBe('https://auth.truelayer-sandbox.com/connect/token');
  });

  it('lists only GBP accounts', async () => {
    const { provider } = providerReturning(accountsResponse);
    expect(await provider.listAccounts('token')).toEqual([
      { id: 'acc-gbp-1', name: 'Sandbox Current' },
    ]);
  });

  it('lists transactions since a date as integer pence', async () => {
    const { provider, fetchFn } = providerReturning(transactionsResponse);
    const transactions = await provider.listTransactions('token', 'acc-gbp-1', '2026-10-01');
    expect(transactions).toEqual([
      { id: 'tx-1', date: '2026-10-03', description: 'COFFEE SUPPLIES', amountPence: -1230 },
      { id: 'tx-2', date: '2026-10-04', description: 'CLIENT PAYMENT', amountPence: 150000 },
    ]);
    const requested = new URL(fetchFn.mock.calls[0][0]);
    expect(requested.pathname).toBe('/data/v1/accounts/acc-gbp-1/transactions');
    expect(requested.searchParams.get('from')).toBe('2026-10-01');
  });

  it('rejects a non-GBP transaction', async () => {
    const { provider } = providerReturning({
      results: [{ transaction_id: 't', timestamp: '2026-10-03T00:00:00+00:00', description: 'x', amount: 5, currency: 'USD' }],
    });
    await expect(provider.listTransactions('token', 'a', '2026-10-01')).rejects.toThrow(/GBP/);
  });

  it('rejects an amount with sub-penny precision', async () => {
    const { provider } = providerReturning({
      results: [{ transaction_id: 't', timestamp: '2026-10-03T00:00:00+00:00', description: 'x', amount: 1.005, currency: 'GBP' }],
    });
    await expect(provider.listTransactions('token', 'a', '2026-10-01')).rejects.toThrow(/amount/);
  });

  it('keeps tokens and secrets out of error messages', async () => {
    const { provider } = providerReturning({ error: 'invalid_grant', access_token: 'leak-me' }, 400);
    const failure = await provider.finishConsent('code-1').catch((error: Error) => error);
    expect((failure as Error).message).toBe('TrueLayer token exchange failed (400)');
    expect((failure as Error).message).not.toMatch(/leak-me|secret-1/);
  });
});
