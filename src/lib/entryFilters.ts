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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inverse of toEntryListParams for the page URL; values the API would refuse fall back to the default. */
export function filtersFromParams(params: URLSearchParams): EntryFilters {
  const date = (name: string) => {
    const value = params.get(name) ?? '';
    return ISO_DATE.test(value) ? value : '';
  };
  const kind = params.get('kind');
  const status = params.get('status');
  return {
    from: date('from'),
    to: date('to'),
    kind: kind === 'income' || kind === 'expense' ? kind : 'both',
    categoryAccountId: params.get('categoryAccountId') ?? '',
    status: status === 'draft' || status === 'confirmed' ? status : '',
    search: (params.get('search') ?? '').slice(0, 100),
  };
}

/** Filters behind the phone Filters button: the date range counts once, search has its own box. */
export function activeFilterCount(filters: EntryFilters): number {
  return [filters.from || filters.to, filters.kind !== 'both', filters.categoryAccountId, filters.status].filter(Boolean).length;
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
