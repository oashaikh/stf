export type RecurringSchedule = 'monthly' | 'yearly';

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The date after `date` for the schedule. The day is clamped to the month length from the stored
 * `anchorDay`, not from `date`, so 31 Jan -> 28 Feb -> 31 Mar does not drift to the 28th.
 */
export function nextOccurrence(date: string, schedule: RecurringSchedule, anchorDay: number): string {
  const [year, month] = date.split('-').map(Number);
  const monthIndex = schedule === 'monthly' ? month : month - 1 + 12;
  const nextYear = year + Math.floor(monthIndex / 12);
  const nextMonth = (monthIndex % 12) + 1;
  return isoDate(nextYear, nextMonth, Math.min(anchorDay, daysInMonth(nextYear, nextMonth)));
}

/**
 * Every date due on or before `today` (ISO), at most `cap` of them, plus the date the template
 * moves to afterwards. A backlog beyond the cap is left for the next run.
 */
export function dueDates(
  nextDate: string,
  schedule: RecurringSchedule,
  anchorDay: number,
  today: string,
  cap: number,
): { dates: string[]; next: string } {
  const dates: string[] = [];
  let next = nextDate;
  while (next <= today && dates.length < cap) {
    dates.push(next);
    next = nextOccurrence(next, schedule, anchorDay);
  }
  return { dates, next };
}
