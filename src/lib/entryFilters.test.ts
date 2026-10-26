import { describe, expect, it } from 'vitest';
import { DEFAULT_ENTRY_FILTERS, taxYearRange, toEntryListParams, vatQuarterRange } from './entryFilters';

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
