import type { VatObligationRow } from './hmrc/vatApi';
import { currentTaxYear } from './taxBands';

export interface EntryFilters {
  from: string;
  to: string;
  kind: 'both' | 'income' | 'expense';
  categoryAccountId: string;
  status: '' | 'draft' | 'confirmed';
  search: string;
}

export const DEFAULT_ENTRY_FILTERS: EntryFilters = {
  from: '',
  to: '',
  kind: 'both',
  categoryAccountId: '',
  status: '',
  search: '',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Starting filters from links such as the dashboard's ?status=draft and the report's category links. */
export function entryFiltersFromParams(params: URLSearchParams): EntryFilters {
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  return {
    ...DEFAULT_ENTRY_FILTERS,
    from: ISO_DAY.test(from) ? from : '',
    to: ISO_DAY.test(to) ? to : '',
    categoryAccountId: params.get('categoryAccountId') ?? '',
    status: params.get('status') === 'draft' ? 'draft' : '',
  };
}

/** Query parameters for GET /api/entries; filters left at their defaults are omitted. */
export function toEntryListParams(filters: EntryFilters, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.kind !== 'both') params.set('kind', filters.kind);
  if (filters.categoryAccountId) params.set('categoryAccountId', filters.categoryAccountId);
  if (filters.status) params.set('status', filters.status);
  if (search) params.set('search', search);
  if (cursor) params.set('cursor', cursor);
  return params;
}

/** First and last day of a tax year string such as "2026-27": 6 April to the following 5 April. */
export function taxYearRange(taxYear: string = currentTaxYear()): { from: string; to: string } {
  const startYear = Number(taxYear.slice(0, 4));
  return { from: `${startYear}-04-06`, to: `${startYear + 1}-04-05` };
}

/** The VAT quarter containing `today` (ISO date), or undefined when no obligation does. */
export function vatQuarterRange(obligations: VatObligationRow[], today: string): { from: string; to: string } | undefined {
  const quarter = obligations.find((obligation) => obligation.start <= today && today <= obligation.end);
  return quarter && { from: quarter.start, to: quarter.end };
}
