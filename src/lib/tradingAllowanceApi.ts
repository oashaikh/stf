import type { ExpenseMethod } from './taxYearSummary';

export async function saveExpenseMethod(taxYear: string, method: ExpenseMethod): Promise<ExpenseMethod> {
  const response = await fetch('/api/settings/trading-allowance', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taxYear, method }),
  }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || !body?.method) throw new Error(body?.error ?? 'Could not save your choice');
  return body.method;
}
