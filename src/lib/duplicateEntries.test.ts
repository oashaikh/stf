import { describe, expect, it } from 'vitest';
import { findDuplicateEntries, type DuplicateCandidate } from './duplicateEntries';

const entry = (id: string, date: string, grossPence: number, supplier = 'Screwfix'): DuplicateCandidate => ({
  id, date, grossPence, reference: supplier, description: 'Tools',
});

describe('findDuplicateEntries', () => {
  const base = entry('a', '2026-10-10', 1250);

  it.each([[0, 1], [3, 1], [4, 0]])('same amount and supplier %i days apart gives %i flag', (days, flags) => {
    const other = entry('b', `2026-10-${String(10 + days).padStart(2, '0')}`, 1250);
    expect(findDuplicateEntries([base, other])).toHaveLength(flags);
  });

  it('ignores a different amount', () => {
    expect(findDuplicateEntries([base, entry('b', '2026-10-10', 1251)])).toEqual([]);
  });

  it('ignores a different supplier', () => {
    expect(findDuplicateEntries([base, entry('b', '2026-10-10', 1250, 'Toolstation')])).toEqual([]);
  });

  it('ignores case and extra spaces in the supplier', () => {
    expect(findDuplicateEntries([base, entry('b', '2026-10-10', 1250, '  SCREWFIX  ')])).toHaveLength(1);
  });

  it('falls back to the description when there is no reference', () => {
    const one = { ...entry('a', '2026-10-10', 500, ''), description: 'Parking' };
    const two = { ...entry('b', '2026-10-11', 500, ''), description: 'parking' };
    expect(findDuplicateEntries([one, two])).toHaveLength(1);
  });

  it('never matches an entry with itself', () => {
    expect(findDuplicateEntries([base])).toEqual([]);
  });

  it('gives the same stable key whatever the input order', () => {
    const other = entry('b', '2026-10-11', 1250);
    const [forward] = findDuplicateEntries([base, other]);
    const [backward] = findDuplicateEntries([other, base]);
    expect(forward.key).toBe(backward.key);
    expect(forward.entryIds).toEqual(['a', 'b']);
  });

  it('gives a new entry with a different date or amount a different key against the same saved entry', () => {
    const first = findDuplicateEntries([base, entry('new', '2026-10-11', 1250)])[0];
    const otherDate = findDuplicateEntries([base, entry('new', '2026-10-12', 1250)])[0];
    expect(otherDate.key).not.toBe(first.key);
    expect(findDuplicateEntries([base, entry('new', '2026-10-11', 1250)])[0].key).toBe(first.key);
  });
});
