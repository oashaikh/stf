import { browserFraudHeaders } from './vatApi';

type FetchFn = typeof fetch;

export function describeHmrcStatus(connected: boolean, callbackOutcome: string | null) {
  if (callbackOutcome === 'error') {
    return { label: 'HMRC connection failed. Please try again.', tone: 'error' as const };
  }
  return connected
    ? { label: 'Connected to HMRC', tone: 'connected' as const }
    : { label: 'Not connected', tone: 'disconnected' as const };
}

async function getJson(path: string, fetchFn: FetchFn) {
  const response = await fetchFn(path, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Request to ${path} failed`);
  return response.json();
}

export interface HmrcStatus {
  connected: boolean;
  needsItsReconnect: boolean;
  itsBusinessId: string | null;
}

export async function fetchHmrcStatus(fetchFn: FetchFn = fetch): Promise<HmrcStatus> {
  const body = await getJson('/api/hmrc/status', fetchFn);
  return {
    connected: body.connected === true,
    needsItsReconnect: body.needsItsReconnect === true,
    itsBusinessId: body.itsBusinessId ?? null,
  };
}

export interface ItsBusinessOption {
  businessId: string;
  tradingName: string | null;
}

export interface ItsBusinessesState {
  businesses: ItsBusinessOption[];
  selectedBusinessId: string | null;
}

async function itsBusinessesRequest(fetchFn: FetchFn, init: RequestInit = {}): Promise<ItsBusinessesState> {
  const response = await fetchFn('/api/hmrc/its-businesses', { ...init, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Request to /api/hmrc/its-businesses failed');
  const { businesses, selectedBusinessId } = await response.json();
  return { businesses, selectedBusinessId: selectedBusinessId ?? null };
}

export const fetchItsBusinesses = (fetchFn: FetchFn = fetch) => itsBusinessesRequest(fetchFn);

export const saveItsBusiness = (businessId: string, fetchFn: FetchFn = fetch) =>
  itsBusinessesRequest(fetchFn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId }),
  });

export async function fetchHmrcConnectUrl(fetchFn: FetchFn = fetch): Promise<string> {
  return (await getJson('/api/hmrc/connect', fetchFn)).url;
}

export interface HmrcModeState {
  /** The user's own opt-in to live filing. */
  live: boolean;
  /** Whether the server is in production mode. */
  envLive: boolean;
}

export const isEffectivelyLive = (mode: HmrcModeState) => mode.live && mode.envLive;

async function modeRequest(fetchFn: FetchFn, init: RequestInit = {}): Promise<HmrcModeState> {
  const response = await fetchFn('/api/hmrc/mode', {
    ...init,
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Request to /api/hmrc/mode failed');
  const { live, envLive } = await response.json();
  return { live: live === true, envLive: envLive === true };
}

export const fetchHmrcMode = (fetchFn: FetchFn = fetch) => modeRequest(fetchFn);

export const saveHmrcLiveOptIn = (live: boolean, fetchFn: FetchFn = fetch) =>
  modeRequest(fetchFn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ live }),
  });

/** The saved VAT number as the server shows it: masked, or null when none is saved. */
export async function fetchVatNumberMask(fetchFn: FetchFn = fetch): Promise<string | null> {
  return (await getJson('/api/settings/vat-number', fetchFn)).masked ?? null;
}

export class VatNumberRefusedError extends Error {
  constructor(readonly code: string) {
    super('VAT number refused');
  }
}

export async function saveVatNumber(vatNumber: string, fetchFn: FetchFn = fetch): Promise<string | null> {
  const response = await fetchFn('/api/settings/vat-number', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vatNumber }),
  });
  const body = await response.json();
  if (!response.ok) throw new VatNumberRefusedError(body.code);
  return body.masked ?? null;
}

export interface FraudHeaderFinding {
  headers: string[];
  message: string;
}

export interface FraudCheckOutcome {
  outcome: 'pass' | 'fail';
  message: string;
  errors: FraudHeaderFinding[];
  warnings: FraudHeaderFinding[];
}

export async function runFraudHeadersCheck(fetchFn: FetchFn = fetch): Promise<FraudCheckOutcome> {
  const response = await fetchFn('/api/vat/fraud-headers-check', {
    method: 'POST',
    credentials: 'same-origin',
    headers: browserFraudHeaders(),
  });
  if (!response.ok) throw new Error('Request to /api/vat/fraud-headers-check failed');
  const { data } = await response.json();
  return data;
}
