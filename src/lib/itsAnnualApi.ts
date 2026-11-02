import type { AnnualSubmission } from './itsAnnualSubmission';
import { post } from './hmrc/itsUpdateApi';

export interface ItsAnnualPreview<Body = AnnualSubmission> {
  endpoint: { method: string; url: string; sandbox: boolean };
  body: Body;
  headers: Record<string, string>;
}

/** Property annual calls name the business and the allowance choice; omitted, the self-employment flow is used. */
export type ItsAnnualTarget = { taxYear: string; business: 'uk-property'; choice: 'allowance' | 'actual' };
const targetBody = (target: string | ItsAnnualTarget) => (typeof target === 'string' ? { taxYear: target } : target);

export async function previewItsAnnual<Body = AnnualSubmission>(target: string | ItsAnnualTarget): Promise<ItsAnnualPreview<Body>> {
  return (await post('its-annual-preview', targetBody(target))).data as ItsAnnualPreview<Body>;
}

/** Records the declaration on the server; submit then sends exactly what was confirmed. */
export async function confirmItsAnnual(target: string | ItsAnnualTarget): Promise<void> {
  await post('its-annual-confirm', { ...targetBody(target), declaration: true });
}

export async function submitItsAnnual(target: string | ItsAnnualTarget): Promise<{ sandbox: boolean }> {
  return (await post('its-annual-submit', { ...targetBody(target), confirm: true })).data as { sandbox: boolean };
}
