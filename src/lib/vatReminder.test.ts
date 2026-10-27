import { describe, expect, it } from 'vitest';
import { getObligationDueWithin, type VatObligation } from './vatReminder.js';

const today = '2026-10-27';

const obligation = (overrides: Partial<VatObligation>): VatObligation => ({
  periodKey: '26Q3',
  start: '2026-07-01',
  end: '2026-09-30',
  due: '2026-10-31',
  status: 'O',
  ...overrides,
});

describe('getObligationDueWithin', () => {
  it('returns undefined for empty input', () => {
    expect(getObligationDueWithin([], today, 14)).toBeUndefined();
  });

  it('returns an obligation due inside the window', () => {
    const due = obligation({ due: '2026-11-05' }); // 9 days away
    expect(getObligationDueWithin([due], today, 14)).toEqual(due);
  });

  it('ignores an obligation due outside the window', () => {
    const due = obligation({ due: '2026-11-20' }); // 24 days away
    expect(getObligationDueWithin([due], today, 14)).toBeUndefined();
  });

  it('includes an overdue obligation (due date in the past)', () => {
    const overdue = obligation({ due: '2026-10-15' }); // 12 days ago
    expect(getObligationDueWithin([overdue], today, 14)).toEqual(overdue);
  });

  it('ignores fulfilled obligations', () => {
    const fulfilled = obligation({ status: 'F', due: '2026-11-05' });
    expect(getObligationDueWithin([fulfilled], today, 14)).toBeUndefined();
  });

  it('returns the earliest of multiple open obligations inside the window', () => {
    const first = obligation({ periodKey: '26Q1', due: '2026-05-07' });
    const second = obligation({ periodKey: '26Q2', due: '2026-08-07' });
    const third = obligation({ periodKey: '26Q3', due: '2026-11-07' });
    expect(getObligationDueWithin([second, third, first], today, 100)).toEqual(
      first,
    );
  });

  it('filters out fulfilled and out-of-window, then returns the earliest of the remainder', () => {
    const overdue = obligation({
      periodKey: '26Q2',
      due: '2026-10-10',
      status: 'O',
    });
    const due = obligation({ periodKey: '26Q3', due: '2026-11-05', status: 'O' });
    const fulfilled = obligation({
      periodKey: '26Q4',
      due: '2026-11-06',
      status: 'F',
    });
    const outOfWindow = obligation({
      periodKey: '27Q1',
      due: '2026-12-01',
      status: 'O',
    });

    const result = getObligationDueWithin(
      [outOfWindow, fulfilled, due, overdue],
      today,
      14,
    );
    expect(result).toEqual(overdue); // earliest due date within window
  });

  it('handles today as the due date (inside a 0-day window)', () => {
    const dueToday = obligation({ due: today });
    expect(getObligationDueWithin([dueToday], today, 0)).toEqual(dueToday);
  });

  it('handles future dates at the edge of the window', () => {
    const dueTomorrow = obligation({ due: '2026-10-28' }); // 1 day away
    expect(getObligationDueWithin([dueTomorrow], today, 1)).toEqual(
      dueTomorrow,
    );
    expect(getObligationDueWithin([dueTomorrow], today, 0)).toBeUndefined();
  });
});
