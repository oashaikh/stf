// Shapes recorded from the TrueLayer sandbox (mock bank); values are invented.
export const tokenResponse = {
  access_token: 'sandbox-access-token',
  refresh_token: 'sandbox-refresh-token',
  expires_in: 3600,
  token_type: 'Bearer',
};

export const accountsResponse = {
  results: [
    {
      account_id: 'acc-gbp-1',
      account_type: 'TRANSACTION',
      display_name: 'Sandbox Current',
      currency: 'GBP',
      account_number: { sort_code: '04-00-04', number: '12345678' },
    },
    { account_id: 'acc-usd-1', account_type: 'TRANSACTION', display_name: 'Sandbox Dollars', currency: 'USD' },
  ],
  status: 'Succeeded',
};

export const transactionsResponse = {
  results: [
    {
      transaction_id: 'tx-1',
      timestamp: '2026-10-03T00:00:00+00:00',
      description: 'COFFEE SUPPLIES',
      amount: -12.3,
      currency: 'GBP',
    },
    {
      transaction_id: 'tx-2',
      timestamp: '2026-10-04T00:00:00+00:00',
      description: 'CLIENT PAYMENT',
      amount: 1500,
      currency: 'GBP',
    },
  ],
  status: 'Succeeded',
};
