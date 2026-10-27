import { describe, expect, it } from 'vitest';
import { activeFilterCount, DEFAULT_ENTRY_FILTERS, filtersFromParams, taxYearRange, toEntryListParams, vatQuarterRange, type EntryFilters } from './entryFilters';

const obligation = (start: string, end: string) => ({ periodKey: start, start, end, due: end, status: 'O' as const, overdue: false });

describe('toEntryListParams', () => {
  it('leaves out empty filters', () => {
    expect(toEntryListParams(DEFAULT_ENTRY_FILTERS).toString()).toBe('');
  });

  it('includes set filters, a trimmed search and the cursor', () => {
    const params = toEntryListParams(
      { from: '2026-04-06', to: '2026-07-05', kind: 'expense', categoryAccountId: 'abc', status: 'draft', search: ' paper ' },
      'next',
    );
    expect(Object.fromEntries(params)).toEqual({
      from: '2026-04-06', to: '2026-07-05', kind: 'expense', categoryAccountId: 'abc', status: 'draft', search: 'paper', cursor: 'next',
    });
  });
});

describe('taxYearRange', () => {
  it('runs 6 April to the following 5 April', () => {
    expect(taxYearRange('2026-27')).toEqual({ from: '2026-04-06', to: '2027-04-05' });
  });

  it('puts 5 April in the previous tax year and 6 April in the new one', () => {
    expect(taxYearRange().from <= '2099-01-01').toBe(true);
    expect(taxYearRange('2025-26').to).toBe('2026-04-05');
    expect(taxYearRange('2026-27').from).toBe('2026-04-06');
  });
});

describe('vatQuarterRange', () => {
  const obligations = [obligation('2026-04-01', '2026-06-30'), obligation('2026-07-01', '2026-09-30'), obligation('2026-10-01', '2026-12-31')];

  it('picks the obligation containing today, bounds included', () => {
    expect(vatQuarterRange(obligations, '2026-10-26')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(vatQuarterRange(obligations, '2026-09-30')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('returns undefined when no obligation contains today', () => {
    expect(vatQuarterRange(obligations, '2027-01-01')).toBeUndefined();
  });
});

describe('filtersFromParams', () => {
  it('reads the range, category and draft status from a link', () => {
    expect(filtersFromParams(new URLSearchParams('from=2026-04-06&to=2027-04-05&categoryAccountId=a2&status=draft'))).toEqual({
      ...DEFAULT_ENTRY_FILTERS,
      from: '2026-04-06',
      to: '2027-04-05',
      categoryAccountId: 'a2',
      status: 'draft',
    });
  });

  it('ignores malformed dates and unknown statuses', () => {
    expect(filtersFromParams(new URLSearchParams('from=yesterday&to=2027-4-5&status=void'))).toEqual(DEFAULT_ENTRY_FILTERS);
  });
});

describe('entry filters in the page URL', () => {
  it('round-trips every filter through the query string', () => {
    const filters: EntryFilters = {
      from: '2026-04-06', to: '2026-07-05', kind: 'expense', categoryAccountId: 'a2', status: 'draft', search: 'Consulting & design',
    };
    expect(filtersFromParams(toEntryListParams(filters))).toEqual(filters);
  });

  it('reads a VAT drill-down link and ignores unknown or malformed values', () => {
    expect(filtersFromParams(new URLSearchParams('from=2026-08-15&to=2026-08-15&search=Consulting+%26+design'))).toEqual({
      ...DEFAULT_ENTRY_FILTERS, from: '2026-08-15', to: '2026-08-15', search: 'Consulting & design',
    });
    expect(filtersFromParams(new URLSearchParams('from=yesterday&kind=bogus&status=void'))).toEqual(DEFAULT_ENTRY_FILTERS);
  });

  it('counts the date range as one active filter and leaves search out', () => {
    expect(activeFilterCount(DEFAULT_ENTRY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_ENTRY_FILTERS, from: '2026-04-06', to: '2026-07-05', search: 'x' })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_ENTRY_FILTERS, to: '2026-07-05', kind: 'income', categoryAccountId: 'a1', status: 'draft' })).toBe(4);
  });
});
