import type { VatRate } from './vat';

export interface ApiEntry {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  status: 'draft' | 'confirmed';
  lines: Array<{ accountId: string; amountPence: number }>;
}

export interface NewEntryRequest {
  date: string;
  description: string;
  reference?: string;
  kind: 'income' | 'expense';
  categoryAccountId: string;
  amountPence: number;
  amountIs: 'gross' | 'net';
  vatRatePercent: VatRate;
  status: 'draft';
}

/** `fields` names the request fields the server refused, so the form can show the message beside them. */
export class EntryRefusedError extends Error {
  constructor(
    message: string,
    readonly fields: string[],
  ) {
    super(message);
  }
}

export const ENTRIES_QUERY_KEY = ['entries'];

/** The bank line closes every entry: money in debits it, money out credits it. */
export function entryAmount(entry: ApiEntry): { kind: 'income' | 'expense'; grossPence: number } {
  const bankLine = entry.lines[entry.lines.length - 1];
  return { kind: bankLine.amountPence > 0 ? 'income' : 'expense', grossPence: Math.abs(bankLine.amountPence) };
}

export async function fetchEntries(): Promise<ApiEntry[]> {
  const response = await fetch('/api/entries', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load entries');
  return (await response.json()).entries;
}

export async function createEntry(entry: NewEntryRequest): Promise<void> {
  const response = await fetch('/api/entries', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  throw new EntryRefusedError(body.error ?? 'Could not save the entry. Please try again.', body.fields ?? []);
}

export async function fetchHasVatNumber(): Promise<boolean> {
  const response = await fetch('/api/settings/vat-number', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load VAT number');
  return (await response.json()).masked !== null;
}
