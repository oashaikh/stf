type FetchFn = typeof fetch;

export function describeHmrcStatus(connected: boolean, callbackOutcome: string | null) {
  if (callbackOutcome === 'error') {
    return { label: 'HMRC connection failed. Please try again.', tone: 'error' as const };
  }
  return connected
    ? { label: 'Connected to HMRC', tone: 'connected' as const }
    : { label: 'Not connected', tone: 'disconnected' as const };
}

async function getJson(path: string, token: string, fetchFn: FetchFn) {
  const response = await fetchFn(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Request to ${path} failed`);
  return response.json();
}

export async function fetchHmrcConnected(token: string, fetchFn: FetchFn = fetch): Promise<boolean> {
  return (await getJson('/api/hmrc/status', token, fetchFn)).connected === true;
}

export async function fetchHmrcConnectUrl(token: string, fetchFn: FetchFn = fetch): Promise<string> {
  return (await getJson('/api/hmrc/connect', token, fetchFn)).url;
}
