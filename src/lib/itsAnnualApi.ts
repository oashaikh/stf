import type { AnnualSubmission } from './itsAnnualSubmission';
import { post } from './hmrc/itsUpdateApi';

export interface ItsAnnualPreview {
  endpoint: { method: string; url: string; sandbox: boolean };
  body: AnnualSubmission;
  headers: Record<string, string>;
}

export async function previewItsAnnual(taxYear: string): Promise<ItsAnnualPreview> {
  return (await post('its-annual-preview', { taxYear })).data as ItsAnnualPreview;
}

/** Records the declaration on the server; submit then sends exactly what was confirmed. */
export async function confirmItsAnnual(taxYear: string): Promise<void> {
  await post('its-annual-confirm', { taxYear, declaration: true });
}

export async function submitItsAnnual(taxYear: string): Promise<{ sandbox: boolean }> {
  return (await post('its-annual-submit', { taxYear, confirm: true })).data as { sandbox: boolean };
}
