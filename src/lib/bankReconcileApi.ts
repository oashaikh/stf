import type { BankLine, MatchProposal } from './bankMatching';

export type ProposalView = MatchProposal & { entryDescription: string; entryDate: string };

export interface SortData {
  lines: BankLine[];
  proposals: ProposalView[];
}

type SortAction =
  | { action: 'match'; lineId: string; entryId: string }
  | { action: 'unmatch'; lineId: string }
  | { action: 'dismiss'; lineId: string; reason: string }
  | { action: 'undismiss'; lineId: string }
  | { action: 'createEntry'; lineId: string; categoryAccountId: string };

export async function fetchReconcile(): Promise<SortData> {
  const response = await fetch('/api/bank/reconcile', { credentials: 'same-origin' }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || !Array.isArray(body?.lines) || !Array.isArray(body?.proposals)) throw new Error('Could not load your bank payments');
  return { lines: body.lines, proposals: body.proposals };
}

async function send(payload: SortAction): Promise<{ entryId?: string }> {
  const response = await fetch('/api/bank/reconcile', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) throw new Error(body?.error ?? 'Something went wrong. Please try again.');
  return body ?? {};
}

export const matchLine = async (lineId: string, entryId: string) => void (await send({ action: 'match', lineId, entryId }));
export const unmatchLine = async (lineId: string) => void (await send({ action: 'unmatch', lineId }));
export const dismissLine = async (lineId: string, reason: string) => void (await send({ action: 'dismiss', lineId, reason }));
export const undismissLine = async (lineId: string) => void (await send({ action: 'undismiss', lineId }));

export async function createDraftFromLine(lineId: string, categoryAccountId: string): Promise<string> {
  const { entryId } = await send({ action: 'createEntry', lineId, categoryAccountId });
  if (!entryId) throw new Error('Something went wrong. Please try again.');
  return entryId;
}
