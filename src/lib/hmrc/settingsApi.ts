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

export async function fetchHmrcConnected(fetchFn: FetchFn = fetch): Promise<boolean> {
  return (await getJson('/api/hmrc/status', fetchFn)).connected === true;
}

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
