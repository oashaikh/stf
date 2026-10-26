type FetchFn = typeof fetch;

export type AccountType = 'income' | 'expense' | 'asset' | 'liability' | 'equity';

export interface ApiAccount {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  taxCategory: string | null;
  isSystem: boolean;
}

export const ACCOUNT_TYPE_GROUPS: ReadonlyArray<{ type: AccountType; label: string }> = [
  { type: 'income', label: 'Income' },
  { type: 'expense', label: 'Expenses' },
  { type: 'asset', label: 'Assets' },
  { type: 'liability', label: 'Liabilities' },
  { type: 'equity', label: 'Equity' },
];

// Slugs are the HMRC self-employment boxes the default chart already uses (src/lib/chartOfAccounts.ts).
export const TAX_CATEGORIES: Record<'income' | 'expense', ReadonlyArray<{ slug: string; label: string }>> = {
  income: [
    { slug: 'turnover', label: 'Turnover' },
    { slug: 'other-income', label: 'Other income' },
  ],
  expense: [
    { slug: 'cost-of-goods', label: 'Cost of goods' },
    { slug: 'travel', label: 'Travel' },
    { slug: 'premises', label: 'Premises' },
    { slug: 'admin-office', label: 'Admin and office' },
    { slug: 'advertising', label: 'Advertising' },
    { slug: 'professional-fees', label: 'Professional fees' },
    { slug: 'finance-costs', label: 'Finance costs' },
    { slug: 'other-allowable', label: 'Other allowable expenses' },
    { slug: 'disallowable', label: 'Disallowable expenses' },
  ],
};

export class AccountRefusedError extends Error {
  constructor(readonly code: string) {
    super('Account change refused');
  }
}

/** Plain-words messages for the refusals the accounts route can send. */
export function describeAccountRefusal(error: unknown): string {
  const code = error instanceof AccountRefusedError ? error.code : '';
  if (code === 'DUPLICATE_CODE') return 'That code is already used by another account. Pick a different code.';
  if (code === 'SYSTEM_ACCOUNT') return 'System accounts cannot be archived.';
  if (code === 'BAD_REQUEST') return 'Check the code (letters, numbers and dashes, up to 10) and the name (up to 100 characters).';
  return 'Something went wrong. Please try again.';
}

async function accountRequest(init: RequestInit, fetchFn: FetchFn, query = '') {
  const response = await fetchFn(`/api/accounts${query}`, { ...init, credentials: 'same-origin' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccountRefusedError(body.code ?? '');
  return body;
}

const send = (method: string, payload: unknown, fetchFn: FetchFn) =>
  accountRequest({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, fetchFn);

export async function fetchAccounts(archived: boolean, fetchFn: FetchFn = fetch): Promise<ApiAccount[]> {
  return (await accountRequest({}, fetchFn, archived ? '?archived=true' : '')).accounts;
}

export const createAccount = (
  account: { code: string; name: string; accountType: 'income' | 'expense'; taxCategory: string },
  fetchFn: FetchFn = fetch,
) => send('POST', account, fetchFn);

export const renameAccount = (id: string, name: string, fetchFn: FetchFn = fetch) => send('PATCH', { id, name }, fetchFn);

export const setAccountArchived = (id: string, archived: boolean, fetchFn: FetchFn = fetch) =>
  send('PATCH', { id, archived }, fetchFn);
