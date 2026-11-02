export interface CategorySuggestion {
  lineId: string;
  accountId: string;
  /** Integer percent, 0 to 100. */
  confidence: number;
}

export interface SuggestOutcome {
  /** 'skipped' means suggestions are switched off, so no call was made. */
  status: 'suggested' | 'skipped';
  suggestions: CategorySuggestion[];
}

// The server caps one request at this many payments.
export const MAX_SUGGEST_LINES = 25;

export async function suggestCategories(lineIds: string[]): Promise<SuggestOutcome> {
  const response = await fetch('/api/bank/categorise', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineIds }),
  }).catch(() => null);
  const body = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || !Array.isArray(body?.suggestions)) {
    throw new Error(body?.error ?? 'We could not get suggestions just now. You can sort these payments by hand.');
  }
  return { status: body.status === 'skipped' ? 'skipped' : 'suggested', suggestions: body.suggestions };
}
