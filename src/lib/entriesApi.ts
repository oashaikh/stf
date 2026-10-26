import { toEntryListParams, type EntryFilters } from './entryFilters';
import type { VatRate } from './vat';

export interface ApiEntry {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  status: 'draft' | 'confirmed' | 'reconciled';
  kind: 'income' | 'expense';
  grossPence: number;
  categoryAccountId: string;
  categoryName: string;
  netPence: number;
  vatPence: number;
  hasReceipt: boolean;
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

/** The period was filed with HMRC, so the server refuses changes; its message is safe to show as written. */
export class PeriodLockedError extends Error {}

export const ENTRIES_QUERY_KEY = ['entries'];

export async function fetchEntries(filters: EntryFilters, cursor?: string): Promise<{ entries: ApiEntry[]; nextCursor: string | null }> {
  const query = toEntryListParams(filters, cursor).toString();
  const response = await fetch(`/api/entries${query ? `?${query}` : ''}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load entries');
  const body = await response.json();
  return { entries: body.entries, nextCursor: body.nextCursor ?? null };
}

async function throwRefusal(response: Response): Promise<never> {
  const body = await response.json().catch(() => ({}));
  const message = body.error ?? 'Could not save the entry. Please try again.';
  if (body.code === 'PERIOD_LOCKED') throw new PeriodLockedError(message);
  throw new EntryRefusedError(message, body.fields ?? []);
}

async function sendEntryRequest(method: string, entryId: string, body?: unknown): Promise<void> {
  const response = await fetch(`/api/entries?id=${encodeURIComponent(entryId)}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) await throwRefusal(response);
}

export async function createEntry(entry: NewEntryRequest): Promise<void> {
  const response = await fetch('/api/entries', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!response.ok) await throwRefusal(response);
}

export const editEntry = (entryId: string, entry: NewEntryRequest) => sendEntryRequest('PUT', entryId, entry);
export const voidEntry = (entryId: string) => sendEntryRequest('DELETE', entryId);
export const confirmEntry = (entryId: string) => sendEntryRequest('PATCH', entryId, { status: 'confirmed' });

export async function fetchHasVatNumber(): Promise<boolean> {
  const response = await fetch('/api/settings/vat-number', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not load VAT number');
  return (await response.json()).masked !== null;
}
