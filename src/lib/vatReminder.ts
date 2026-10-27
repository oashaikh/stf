/**
 * VAT return reminder logic — STF
 *
 * Pure function to pick the next VAT return obligation due within a reminder window.
 * Used by both the dashboard card and the scheduled draft-saving cron.
 */

export const REMINDER_WINDOW_DAYS = 14;

export interface VatObligation {
  periodKey: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  due: string; // YYYY-MM-DD
  status: 'O' | 'F'; // O = open, F = fulfilled
}

/**
 * Pick the next open obligation due within the reminder window.
 * Returns the open obligation with the earliest due date inside the window,
 * including overdue obligations (which the owner needs reminding about most).
 * Fulfilled obligations are ignored.
 *
 * @param obligations Array of VAT obligation objects
 * @param today YYYY-MM-DD string (UTC day), e.g. '2026-10-27'
 * @param windowDays Number of days to look ahead from today (inclusive)
 * @returns The obligation to remind about, or undefined if none are due soon
 */
export function getObligationDueWithin(
  obligations: VatObligation[],
  today: string,
  windowDays: number,
): VatObligation | undefined {
  // Window is [today - ∞, today + windowDays]. Include overdue, so no lower bound.
  const windowEnd = addDays(today, windowDays);

  const openDue = obligations
    .filter((o) => o.status === 'O')
    .filter((o) => o.due <= windowEnd);

  if (openDue.length === 0) return undefined;

  // Return the one with the earliest due date
  return openDue.reduce((earliest, current) =>
    current.due < earliest.due ? current : earliest,
  );
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}
