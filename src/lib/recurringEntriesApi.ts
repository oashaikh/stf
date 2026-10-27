export type RecurringSchedule = 'monthly' | 'yearly';

/** Mirrors the Template the API returns (api/_lib/recurringEntries.ts). */
export interface ApiTemplate {
  id: string;
  kind: 'income' | 'expense';
  categoryAccountId: string;
  amountPence: number;
  amountIs: 'gross' | 'net';
  vatRatePercent: number;
  description: string;
  schedule: RecurringSchedule;
  nextDate: string;
  paused: boolean;
}

export type NewTemplateRequest = Omit<ApiTemplate, 'id' | 'paused'>;
export type TemplateChange = Partial<Pick<ApiTemplate, 'amountPence' | 'amountIs' | 'vatRatePercent' | 'description' | 'nextDate' | 'paused'>>;

export const RECURRING_QUERY_KEY = ['recurring-entries'];

async function send(method: string, id: string | null, fallback: string, body?: unknown): Promise<Response> {
  const response = await fetch(`/api/recurring-entries${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const refusal = await response.json().catch(() => ({}));
    throw new Error(typeof refusal.error === 'string' ? refusal.error : fallback);
  }
  return response;
}

export async function fetchTemplates(): Promise<ApiTemplate[]> {
  return (await (await send('GET', null, 'Could not load recurring entries')).json()).templates;
}

export const createTemplate = (template: NewTemplateRequest) =>
  send('POST', null, 'Could not save the recurring entry. Please try again.', template);

export const updateTemplate = (id: string, change: TemplateChange) =>
  send('PATCH', id, 'Could not update the recurring entry. Please try again.', change);

export const deleteTemplate = (id: string) => send('DELETE', id, 'Could not delete the recurring entry. Please try again.');
