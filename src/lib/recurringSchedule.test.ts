import { describe, expect, it } from 'vitest';
import { dueDates, nextOccurrence } from './recurringSchedule';

describe('nextOccurrence', () => {
  it('clamps 31 Jan monthly to 28 Feb then returns to 31 Mar', () => {
    const feb = nextOccurrence('2027-01-31', 'monthly', 31);
    expect(feb).toBe('2027-02-28');
    expect(nextOccurrence(feb, 'monthly', 31)).toBe('2027-03-31');
  });

  it('clamps to 29 Feb in a leap year', () => {
    expect(nextOccurrence('2028-01-31', 'monthly', 31)).toBe('2028-02-29');
  });

  it('rolls over the year', () => {
    expect(nextOccurrence('2026-12-15', 'monthly', 15)).toBe('2027-01-15');
  });

  it('moves 29 Feb yearly to 28 Feb, then back to 29 Feb in the next leap year', () => {
    let date = nextOccurrence('2024-02-29', 'yearly', 29);
    expect(date).toBe('2025-02-28');
    date = nextOccurrence(date, 'yearly', 29);
    date = nextOccurrence(date, 'yearly', 29);
    expect(date).toBe('2027-02-28');
    expect(nextOccurrence('2027-02-28', 'yearly', 29)).toBe('2028-02-29');
  });
});

describe('dueDates', () => {
  it('returns nothing due when next date is in the future', () => {
    expect(dueDates('2026-11-01', 'monthly', 1, '2026-10-27', 10)).toEqual({
      dates: [],
      next: '2026-11-01',
    });
  });

  it('includes a date due today', () => {
    expect(dueDates('2026-10-27', 'monthly', 27, '2026-10-27', 10)).toEqual({
      dates: ['2026-10-27'],
      next: '2026-11-27',
    });
  });

  it('catches up every missed period', () => {
    expect(dueDates('2026-07-31', 'monthly', 31, '2026-10-27', 10)).toEqual({
      dates: ['2026-07-31', '2026-08-31', '2026-09-30'],
      next: '2026-10-31',
    });
  });

  it('never returns more than the cap and keeps the rest for the next run', () => {
    expect(dueDates('2026-01-01', 'monthly', 1, '2026-10-27', 2)).toEqual({
      dates: ['2026-01-01', '2026-02-01'],
      next: '2026-03-01',
    });
  });
});
