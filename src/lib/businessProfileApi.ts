export interface BusinessProfile {
  businessName: string | null;
  businessAddress: string | null;
  paymentBankName: string | null;
  paymentSortCode: string | null;
  paymentAccountNumber: string | null;
  invoicePrefix: string;
  nextInvoiceNumber: number;
}

async function request(init?: RequestInit): Promise<BusinessProfile> {
  const response = await fetch('/api/settings/business-profile', { credentials: 'same-origin', ...init }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || !body?.profile) throw new Error(body?.error ?? 'Business profile request failed');
  return body.profile;
}

export const fetchBusinessProfile = () => request();

export const saveBusinessProfile = (profile: BusinessProfile) =>
  request({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });

/** Shows only the last 4 digits, for the read-only view. */
export const maskAccountNumber = (accountNumber: string) => `${'•'.repeat(Math.max(accountNumber.length - 4, 0))}${accountNumber.slice(-4)}`;
