export type ReviewStatus = 'draft' | 'confirmed' | null;

export interface ReviewStateInput {
  status: ReviewStatus;
  declarationTicked: boolean;
  confirmPending: boolean;
  /** The server found the ledger or period no longer matches what was confirmed. */
  stale?: boolean;
  /** The receipt HMRC gave for this period, if it has been filed. */
  submission?: SubmissionReceipt | null;
  submitPending?: boolean;
  /** HMRC may have accepted the return but we could not confirm it. */
  outcomeUnknown?: boolean;
  /** Both the deployment and the user's opt-in allow live filing. */
  live?: boolean;
}

export interface SubmissionReceipt {
  formBundleNumber: string;
  processingDate: string;
  sandbox: boolean;
}

export interface ReviewState {
  statusLabel: string;
  canConfirm: boolean;
  canSubmit: boolean;
  submitLabel: string;
  /** Set once filed; sandbox receipts carry a label so a rehearsal is never mistaken for a real filing. */
  receipt: (SubmissionReceipt & { heading: string }) | null;
  /** Tells the user not to retry; set when the outcome could not be confirmed. */
  warning: string | null;
}

/** Boxes with contributing transactions; 2, 8 and 9 are always zero so have nothing to expand. */
export const DRILLABLE_BOXES = [1, 3, 4, 5, 6, 7] as const;

export const BOX_LABELS: Record<number, string> = {
  1: 'VAT due on sales',
  2: 'VAT due on acquisitions',
  3: 'Total VAT due',
  4: 'VAT reclaimed on purchases',
  5: 'Net VAT to pay or reclaim',
  6: 'Total sales excluding VAT',
  7: 'Total purchases excluding VAT',
  8: 'Total supplies to EU excluding VAT',
  9: 'Total acquisitions from EU excluding VAT',
};

/** Box 5 is signed on the server: negative means HMRC owes the user a refund. */
export function boxLabel(box: number, pence: number): string {
  return box === 5 && pence < 0 ? `${BOX_LABELS[5]} (refund due to you)` : BOX_LABELS[box];
}

/** The calendar quarter containing `now`. ponytail: real VAT periods follow the user's stagger; replace when settings hold it. */
export function currentQuarter(now: Date) {
  const year = now.getUTCFullYear();
  const quarter = Math.floor(now.getUTCMonth() / 3);
  const startMonth = quarter * 3;
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    periodKey: `${year}-Q${quarter + 1}`,
    start: `${year}-${pad(startMonth + 1)}-01`,
    end: `${year}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}`,
  };
}

export function reviewState(input: ReviewStateInput): ReviewState {
  const stale = input.stale === true;
  const statusLabel = stale
    ? 'Ledger changed since you confirmed. Review and confirm again.'
    : input.status === 'confirmed'
      ? 'Confirmed'
      : input.status === 'draft'
        ? 'Draft, not yet confirmed'
        : 'Not yet reviewed';
  const alreadyConfirmed = input.status === 'confirmed' && !stale;
  const submission = input.submission ?? null;
  const outcomeUnknown = input.outcomeUnknown === true;
  // A sandbox rehearsal never blocks the live filing, so only a live receipt (or a sandbox one while live is off) locks submit.
  const filed = submission !== null && (!submission.sandbox || !input.live);
  return {
    statusLabel,
    canConfirm: input.declarationTicked && !input.confirmPending && !alreadyConfirmed,
    canSubmit: alreadyConfirmed && !input.submitPending && !filed && !outcomeUnknown,
    submitLabel: input.submitPending ? 'Submitting…' : input.live ? 'Submit to HMRC' : 'Submit to HMRC sandbox',
    receipt: submission
      ? { ...submission, heading: submission.sandbox ? 'Sandbox test submission' : 'Submitted to HMRC' }
      : null,
    warning: outcomeUnknown
      ? 'We could not confirm whether HMRC received this return. Do not submit again. Check your HMRC online account before trying again.'
      : null,
  };
}
