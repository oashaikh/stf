import { describe, expect, it } from 'vitest';
import { formatDate } from './dates';

describe('formatDate', () => {
  it('shows an ISO date as a UK date', () => {
    expect(formatDate('2017-04-01')).toBe('1 Apr 2017');
    expect(formatDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('uses the date part of a timestamp without shifting it', () => {
    expect(formatDate('2026-10-26T23:30:00.000Z')).toBe('26 Oct 2026');
  });

  it('returns unparseable input unchanged', () => {
    expect(formatDate('soon')).toBe('soon');
  });
});
