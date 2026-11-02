import { quarterEndDate } from '../itsCumulativeUpdate';
import type { CumulativePeriodSummary } from './client';
import type { ItsObligationRow } from './itsObligationsApi';
import { browserFraudHeaders } from './vatApi';

export type Quarter = 1 | 2 | 3 | 4;

/** The quarter whose standard end date is this obligation's period end, or null for a non-standard period. */
export function quarterOf(obligation: ItsObligationRow): Quarter | null {
  if (obligation.kind !== 'quarterly') return null;
  return ([1, 2, 3, 4] as const).find((quarter) => quarterEndDate(obligation.taxYear, quarter) === obligation.periodEnd) ?? null;
}

export interface ItsUpdatePreview {
  endpoint: { method: string; url: string; sandbox: boolean };
  body: CumulativePeriodSummary;
  headers: Record<string, string>;
}

/** Carries the server's plain-word message and code so the screen can pick the right advice. */
export class ItsUpdateError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export async function post(route: string, payload: object): Promise<{ ok: true; data: unknown }> {
  const response = await fetch(`/api/hmrc/${route}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...browserFraudHeaders() },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!body?.ok) throw new ItsUpdateError(body?.code ?? 'REQUEST_FAILED', body?.error ?? 'Request failed');
  return body;
}

export async function previewItsUpdate(taxYear: string, quarter: Quarter): Promise<ItsUpdatePreview> {
  return (await post('its-cumulative-preview', { taxYear, quarter })).data as ItsUpdatePreview;
}

/** Records the declaration on the server; submit then sends exactly what was confirmed. */
export async function confirmItsUpdate(taxYear: string, quarter: Quarter): Promise<void> {
  await post('its-cumulative-confirm', { taxYear, quarter, declaration: true });
}

export async function submitItsUpdate(taxYear: string, quarter: Quarter): Promise<{ sandbox: boolean }> {
  return (await post('its-cumulative-submit', { taxYear, quarter, confirm: true })).data as { sandbox: boolean };
}
