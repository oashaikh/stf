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

export async function fetchVatObligations(token: string, fetchFn: FetchFn = fetch): Promise<VatObligationRow[]> {
  const response = await fetchFn('/api/vat/obligations', {
    headers: { Authorization: `Bearer ${token}`, ...browserFraudHeaders() },
  });
  if (response.status === 409) throw new NotConnectedError();
  if (!response.ok) throw new Error('Request to /api/vat/obligations failed');
  return (await response.json()).obligations;
}
