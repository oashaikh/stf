import type { VatReturnBoxes } from '../vat';
import type { VatReturnPayload } from './client';

type FetchFn = typeof fetch;

export interface VatObligationRow {
  periodKey: string;
  start: string;
  end: string;
  due: string;
  status: 'O' | 'F';
  overdue: boolean;
}

export class NotConnectedError extends Error {
  constructor() {
    super('HMRC is not connected');
  }
}

export class VatNumberMissingError extends Error {
  constructor() {
    super('No VAT number is set');
  }
}

const DEVICE_ID_KEY = 'stf-device-id';

// HMRC wants a device id that stays the same across sessions on this browser.
function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function utcOffset(): string {
  const minutes = -new Date().getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

// The server forwards these to HMRC as the Gov-Client-* fraud prevention headers.
function browserFraudHeaders(): Record<string, string> {
  return {
    'x-stf-device-id': deviceId(),
    'x-stf-timezone': utcOffset(),
    'x-stf-screens': `width=${screen.width}&height=${screen.height}&scaling-factor=${window.devicePixelRatio}&colour-depth=${screen.colorDepth}`,
    'x-stf-window-size': `width=${window.innerWidth}&height=${window.innerHeight}`,
    'x-stf-js-user-agent': navigator.userAgent,
  };
}

export async function fetchVatObligations(fetchFn: FetchFn = fetch): Promise<VatObligationRow[]> {
  const response = await fetchFn('/api/vat/obligations', {
    credentials: 'same-origin',
    headers: browserFraudHeaders(),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    throw body.code === 'VAT_NUMBER_MISSING' ? new VatNumberMissingError() : new NotConnectedError();
  }
  if (!response.ok) throw new Error('Request to /api/vat/obligations failed');
  return (await response.json()).obligations;
}

export interface VatReceipt {
  formBundleNumber: string;
  processingDate: string;
  sandbox: boolean;
}

export type VatHistoryStatus = 'draft' | 'confirmed' | 'submitted' | 'accepted';

/** Mirrors HistoryItem in api/_lib/vatReturns.ts; amounts are integer pence. */
export interface VatHistoryItem {
  periodKey: string;
  start: string;
  end: string;
  status: VatHistoryStatus;
  boxes: VatReturnBoxes;
  receipt: VatReceipt | null;
}

export class SubmitVatError extends Error {
  constructor(
    /** The server's error code, e.g. OUTCOME_UNKNOWN or ALREADY_SUBMITTED. */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function submitVatReturn(
  period: { periodKey: string; start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<VatReceipt> {
  const response = await fetchFn('/api/vat/submit', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...browserFraudHeaders() },
    body: JSON.stringify({ ...period, confirm: true }),
  });
  const body = await response.json().catch(() => null);
  if (!body?.ok) throw new SubmitVatError(body?.code ?? 'REQUEST_FAILED', body?.error ?? 'Submission failed');
  return body.data;
}

export async function fetchVatHistory(fetchFn: FetchFn = fetch): Promise<VatHistoryItem[]> {
  const response = await fetchFn('/api/vat/history', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Request to /api/vat/history failed');
  return (await response.json()).data;
}

export interface VatPreview {
  endpoint: { method: string; url: string; sandbox: boolean };
  body: VatReturnPayload;
  headers: Record<string, string>;
}

export async function previewVatReturn(
  period: { periodKey: string; start: string; end: string },
  fetchFn: FetchFn = fetch,
): Promise<VatPreview> {
  const response = await fetchFn('/api/vat/preview', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...browserFraudHeaders() },
    body: JSON.stringify(period),
  });
  const body = await response.json().catch(() => null);
  if (!body?.ok) throw new SubmitVatError(body?.code ?? 'REQUEST_FAILED', body?.error ?? 'Preview failed');
  return body.data;
}
