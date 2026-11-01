import { poundsToPence, type BankFeedProvider } from './bankFeed.js';

// Sandbox hosts only: going live is a deliberate change of these two constants plus live credentials.
const AUTH_BASE = 'https://auth.truelayer-sandbox.com';
const API_BASE = 'https://api.truelayer-sandbox.com/data/v1';

export interface TrueLayerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function trueLayerConfigFromEnv(): TrueLayerConfig {
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
  const redirectUri = process.env.TRUELAYER_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) throw new Error('TrueLayer is not configured');
  return { clientId, clientSecret, redirectUri };
}

interface TrueLayerAccount {
  account_id: string;
  display_name: string;
  currency: string;
}

interface TrueLayerTransaction {
  transaction_id: string;
  timestamp: string;
  description: string;
  amount: number;
  currency: string;
}

export function createTrueLayerProvider(config: TrueLayerConfig, fetchFn: typeof fetch = fetch): BankFeedProvider {
  // Errors carry the status only: response bodies and headers can hold tokens.
  async function getResults<T>(accessToken: string, path: string): Promise<T[]> {
    const response = await fetchFn(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error(`TrueLayer request failed (${response.status})`);
    return ((await response.json()) as { results: T[] }).results;
  }

  return {
    startConsent(state) {
      const url = new URL(AUTH_BASE);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        scope: 'accounts transactions offline_access',
        redirect_uri: config.redirectUri,
        providers: 'uk-cs-mock',
        state,
      }).toString();
      return url.toString();
    },

    async finishConsent(code, now = new Date()) {
      const response = await fetchFn(`${AUTH_BASE}/connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          code,
        }).toString(),
      });
      if (!response.ok) throw new Error(`TrueLayer token exchange failed (${response.status})`);
      const body = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
      return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: new Date(now.getTime() + body.expires_in * 1000),
      };
    },

    async listAccounts(accessToken) {
      const accounts = await getResults<TrueLayerAccount>(accessToken, '/accounts');
      return accounts.filter((account) => account.currency === 'GBP').map((account) => ({
        id: account.account_id,
        name: account.display_name,
      }));
    },

    async listTransactions(accessToken, accountId, sinceDate) {
      const query = new URLSearchParams({ from: sinceDate });
      const transactions = await getResults<TrueLayerTransaction>(
        accessToken,
        `/accounts/${encodeURIComponent(accountId)}/transactions?${query.toString()}`,
      );
      return transactions.map((transaction) => {
        if (transaction.currency !== 'GBP') throw new Error('Bank transaction is not in GBP');
        return {
          id: transaction.transaction_id,
          date: transaction.timestamp.slice(0, 10),
          description: transaction.description,
          amountPence: poundsToPence(transaction.amount),
        };
      });
    },
  };
}
