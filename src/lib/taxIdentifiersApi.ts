/** The server only ever returns masked forms; the full values cannot be read back. */
export interface MaskedTaxIdentifiers {
  nino: string | null;
  utr: string | null;
}

async function request(init?: RequestInit): Promise<MaskedTaxIdentifiers> {
  const response = await fetch('/api/settings/tax-identifiers', { credentials: 'same-origin', ...init }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || !body?.ok) throw new Error(body?.error ?? 'Tax identifiers request failed');
  return { nino: body.nino, utr: body.utr };
}

export const fetchTaxIdentifiers = () => request();

/** Only the fields present are changed. */
export const saveTaxIdentifiers = (changes: { nino?: string; utr?: string }) =>
  request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
