import { formatPence } from '../lib/money';

export const VAT_FLOW_STEPS = ['period', 'problems', 'figures', 'send'] as const;
export type VatFlowStep = (typeof VAT_FLOW_STEPS)[number];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthAndYear(iso: string): { month: string; year: string } {
  return { month: MONTH_NAMES[Number(iso.slice(5, 7)) - 1], year: iso.slice(0, 4) };
}

/** "August to October 2026": the year appears once unless the period crosses a year end. */
export function monthRange(startIso: string, endIso: string): string {
  const start = monthAndYear(startIso);
  const end = monthAndYear(endIso);
  if (start.month === end.month && start.year === end.year) return `${start.month} ${start.year}`;
  return start.year === end.year
    ? `${start.month} to ${end.month} ${end.year}`
    : `${start.month} ${start.year} to ${end.month} ${end.year}`;
}

/** The one sentence on the last step. Box 5 is signed: negative means HMRC owes the user. */
export function finalSentence(box5Pence: number, startIso: string, endIso: string): string {
  const period = monthRange(startIso, endIso);
  if (box5Pence === 0) return `You're telling HMRC you owe £0 VAT for ${period}.`;
  return box5Pence < 0
    ? `You're telling HMRC they owe you ${formatPence(-box5Pence)} VAT for ${period}.`
    : `You're telling HMRC you owe ${formatPence(box5Pence)} VAT for ${period}.`;
}

const stepStorageKey = (periodKey: string) => `stf-vat-step:${periodKey}`;

export function saveStep(periodKey: string, step: VatFlowStep): void {
  localStorage.setItem(stepStorageKey(periodKey), step);
}

export function readSavedStep(periodKey: string): VatFlowStep | null {
  const stored = localStorage.getItem(stepStorageKey(periodKey));
  return VAT_FLOW_STEPS.find((step) => step === stored) ?? null;
}
