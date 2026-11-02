import type { ConsentState } from './bankApi';
import type { ItsObligationRow } from './hmrc/itsObligationsApi';
import { quarterOf } from './hmrc/itsUpdateApi';
import type { VatObligationRow } from './hmrc/vatApi';

export interface HomeTodo {
  id: string;
  title: string;
  /** YYYY-MM-DD; absent for jobs with no deadline. */
  dueDate?: string;
  /** Whole days past the due date; only set on overdue items. */
  daysLate?: number;
  buttonLabel: string;
  route: string;
}

export interface SkippedSetupStep {
  id: string;
  title: string;
  route: string;
}

export interface HomeTodoInput {
  vatObligations: VatObligationRow[];
  itsObligations: ItsObligationRow[];
  unsortedBankCount: number;
  receiptsToCheckCount: number;
  bank: { state: ConsentState; expiresAt: string } | null;
  skippedSetupSteps?: SkippedSetupStep[];
}

export interface HomeTodos {
  items: HomeTodo[];
  /** Set only when there is nothing to do. */
  upToDate: string | null;
}

/** Deadlines further away than this are not a job yet; they only feed the "next date" line. */
const SHOW_WITHIN_DAYS = 30;
const DAY_MS = 86_400_000;

const dayNumber = (isoDate: string) => Math.floor(Date.parse(isoDate) / DAY_MS);

function longDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

const plural = (count: number, singular: string) => `${count} ${singular}${count === 1 ? '' : 's'}`;

function datedItem(id: string, task: string, buttonLabel: string, route: string, dueDate: string, todayNumber: number): HomeTodo {
  const daysLate = todayNumber - dayNumber(dueDate);
  if (daysLate > 0) {
    return { id, title: `${task}, ${plural(daysLate, 'day')} late`, dueDate, daysLate, buttonLabel, route };
  }
  return { id, title: `${task}, due ${longDate(dueDate)}`, dueDate, buttonLabel, route };
}

export function buildHomeTodos(input: HomeTodoInput, today: Date): HomeTodos {
  const todayNumber = Math.floor(today.getTime() / DAY_MS);
  const dated: HomeTodo[] = [];
  const later: { dueDate: string; label: string }[] = [];

  const consider = (dueDate: string, nextLabel: string, build: () => HomeTodo) => {
    if (dayNumber(dueDate) - todayNumber <= SHOW_WITHIN_DAYS) dated.push(build());
    else later.push({ dueDate, label: nextLabel });
  };

  for (const obligation of input.vatObligations) {
    if (obligation.status !== 'O') continue;
    consider(obligation.due, 'VAT return', () =>
      datedItem(`vat-${obligation.periodKey}`, 'File your VAT return', 'File return', '/tax/vat', obligation.due, todayNumber),
    );
  }

  for (const obligation of input.itsObligations) {
    const quarter = quarterOf(obligation);
    if (obligation.status !== 'open' || quarter === null) continue;
    consider(obligation.dueDate, 'Income Tax update', () =>
      datedItem(
        `its-${obligation.taxYear}-${quarter}`,
        'Send your Income Tax update',
        'Send update',
        `/tax/update/${obligation.taxYear}/${quarter}`,
        obligation.dueDate,
        todayNumber,
      ),
    );
  }

  if (input.bank?.state === 'expiring') {
    const daysLeft = Math.max(0, Math.ceil((Date.parse(input.bank.expiresAt) - today.getTime()) / DAY_MS));
    dated.push({
      id: 'bank-expiring',
      title: `Your bank connection runs out in ${plural(daysLeft, 'day')}`,
      dueDate: input.bank.expiresAt.slice(0, 10),
      buttonLabel: 'Reconnect bank',
      route: '/bank',
    });
  }

  const overdue = dated.filter((item) => item.daysLate !== undefined).sort((a, b) => b.daysLate! - a.daysLate!);
  const upcoming = dated.filter((item) => item.daysLate === undefined).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

  const undated: HomeTodo[] = [];
  if (input.unsortedBankCount > 0) {
    undated.push({
      id: 'unsorted-payments',
      title: `Sort ${plural(input.unsortedBankCount, 'bank payment')}`,
      buttonLabel: 'Sort payments',
      route: '/bank',
    });
  }
  if (input.receiptsToCheckCount > 0) {
    undated.push({
      id: 'receipts-to-check',
      title: `Check ${plural(input.receiptsToCheckCount, 'receipt')}`,
      buttonLabel: 'Check receipts',
      route: '/money-out/receipts',
    });
  }
  for (const step of input.skippedSetupSteps ?? []) {
    undated.push({ id: step.id, title: step.title, buttonLabel: 'Finish setting up', route: step.route });
  }

  const items = [...overdue, ...upcoming, ...undated];
  if (items.length > 0) return { items, upToDate: null };

  const next = later.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  return {
    items,
    upToDate: next ? `You're up to date. Your next ${next.label} is due ${longDate(next.dueDate)}.` : "You're up to date.",
  };
}
