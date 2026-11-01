export interface BankStatus {
  connected: boolean;
  displayName: string | null;
  maskedAccountNumber: string | null;
  consentExpiresAt: string | null;
}

export type ConsentState = 'active' | 'expiring' | 'expired';

const EXPIRING_SOON_DAYS = 14;
const DAY_MS = 86_400_000;

export function consentState(consentExpiresAt: string, now: Date = new Date()): ConsentState {
  const msLeft = new Date(consentExpiresAt).getTime() - now.getTime();
  if (msLeft <= 0) return 'expired';
  return msLeft <= EXPIRING_SOON_DAYS * DAY_MS ? 'expiring' : 'active';
}

export async function fetchBankStatus(): Promise<BankStatus> {
  const response = await fetch('/api/bank/status', { credentials: 'same-origin' }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || typeof body?.connected !== 'boolean') throw new Error('Could not load your bank connection');
  return {
    connected: body.connected,
    displayName: body.displayName ?? null,
    maskedAccountNumber: body.maskedAccountNumber ?? null,
    consentExpiresAt: body.consentExpiresAt ?? null,
  };
}

export async function fetchBankConnectUrl(): Promise<string> {
  const response = await fetch('/api/bank/connect', { credentials: 'same-origin' }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || !body?.url) throw new Error(body?.error ?? 'Could not start the bank connection');
  return body.url;
}

export async function disconnectBank(): Promise<void> {
  const response = await fetch('/api/bank/disconnect', { method: 'POST', credentials: 'same-origin' }).catch(() => null);
  if (!response?.ok) throw new Error('Could not disconnect your bank');
}
