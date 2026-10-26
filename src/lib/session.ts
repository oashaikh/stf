export const SESSION_QUERY_KEY = ['session'];

/** Cookie-authenticated probe: any non-OK answer (401 included) means not signed in. */
export async function fetchSignedIn(): Promise<boolean> {
  const response = await fetch('/api/me', { credentials: 'same-origin' });
  return response.ok;
}

export type LoginResult = 'ok' | 'code-required' | 'wrong-password' | 'locked' | 'error';

export async function login(password: string): Promise<LoginResult> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  }).catch(() => null);
  if (!response) return 'error';
  if (response.ok) {
    const body = await response.json().catch(() => null);
    return body?.mfaRequired === true ? 'code-required' : 'ok';
  }
  if (response.status === 401) return 'wrong-password';
  return response.status === 429 ? 'locked' : 'error';
}

export type MfaResult = 'ok' | 'wrong-code' | 'challenge-expired' | 'locked' | 'error';

/** Second login step: an authenticator code or a recovery code, sent with the challenge cookie from login. */
export async function submitMfaCode(code: string): Promise<MfaResult> {
  const response = await fetch('/api/auth/mfa', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch(() => null);
  if (!response) return 'error';
  if (response.ok) return 'ok';
  if (response.status === 401) {
    const body = await response.json().catch(() => null);
    return body?.code === 'CHALLENGE_EXPIRED' ? 'challenge-expired' : 'wrong-code';
  }
  return response.status === 429 ? 'locked' : 'error';
}

export async function signOut(): Promise<void> {
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  if (!response.ok) throw new Error('Sign out failed');
}
