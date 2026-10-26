export interface AuthenticatorSetup {
  qrDataUrl: string;
  secret: string;
}

export type AuthenticatorFailure = 'invalid-code' | 'locked' | 'error';

export class AuthenticatorError extends Error {
  constructor(readonly reason: AuthenticatorFailure) {
    super(`Authenticator request failed: ${reason}`);
  }
}

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...init }).catch(() => null);
  if (!response) throw new AuthenticatorError('error');
  if (response.ok) return response.json();
  throw new AuthenticatorError(response.status === 401 ? 'invalid-code' : response.status === 429 ? 'locked' : 'error');
}

const post = (action: string, body?: unknown) =>
  request(`/api/settings/authenticator?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export async function fetchAuthenticatorEnabled(): Promise<boolean> {
  return (await request('/api/settings/authenticator')).enabled === true;
}

export async function startAuthenticatorSetup(): Promise<AuthenticatorSetup> {
  const { qrDataUrl, secret } = await post('start');
  return { qrDataUrl, secret };
}

/** Returns the recovery codes, which the server shows only this once. */
export async function confirmAuthenticator(code: string): Promise<string[]> {
  return (await post('confirm', { code })).recoveryCodes;
}

export async function disableAuthenticator(code: string): Promise<void> {
  await post('disable', { code });
}
