import { quarterEndDate } from '../itsCumulativeUpdate';
import type { CumulativePeriodSummary, PropertyCumulativeSummary } from './client';
import type { ItsObligationRow } from './itsObligationsApi';
import { browserFraudHeaders } from './vatApi';

export type Quarter = 1 | 2 | 3 | 4;

/** The quarter whose standard end date is this obligation's period end, or null for a non-standard period. */
export function quarterOf(obligation: ItsObligationRow): Quarter | null {
  if (obligation.kind !== 'quarterly') return null;
  return ([1, 2, 3, 4] as const).find((quarter) => quarterEndDate(obligation.taxYear, quarter) === obligation.periodEnd) ?? null;
}

export interface ItsUpdatePreview<Body = CumulativePeriodSummary> {
  endpoint: { method: string; url: string; sandbox: boolean };
  body: Body;
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

export async function previewItsPropertyUpdate(taxYear: string, quarter: Quarter): Promise<ItsUpdatePreview<PropertyCumulativeSummary>> {
  return (await post('its-property-preview', { taxYear, quarter })).data as ItsUpdatePreview<PropertyCumulativeSummary>;
}

type Business = ItsObligationRow['business'];

// The property routes run the same gate against the rental property business.
const routeStem = (business: Business) => (business === 'uk-property' ? 'its-property' : 'its-cumulative');

/** Records the declaration on the server; submit then sends exactly what was confirmed. */
export async function confirmItsUpdate(taxYear: string, quarter: Quarter, business: Business = 'self-employment'): Promise<void> {
  await post(`${routeStem(business)}-confirm`, { taxYear, quarter, declaration: true });
}

export async function submitItsUpdate(taxYear: string, quarter: Quarter, business: Business = 'self-employment'): Promise<{ sandbox: boolean }> {
  return (await post(`${routeStem(business)}-submit`, { taxYear, quarter, confirm: true })).data as { sandbox: boolean };
}
