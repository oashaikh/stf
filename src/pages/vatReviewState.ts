export type ReviewStatus = 'draft' | 'confirmed' | null;

export interface ReviewStateInput {
  status: ReviewStatus;
  declarationTicked: boolean;
  confirmPending: boolean;
  /** Error code from the last confirm or submit-gate response, if any. */
  errorCode?: string;
}

export interface ReviewState {
  statusLabel: string;
  canConfirm: boolean;
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
  const stale = input.errorCode === 'STALE_CONFIRMATION';
  const statusLabel = stale
    ? 'Ledger changed since you confirmed. Review and confirm again.'
    : input.status === 'confirmed'
      ? 'Confirmed'
      : input.status === 'draft'
        ? 'Draft, not yet confirmed'
        : 'Not yet reviewed';
  const alreadyConfirmed = input.status === 'confirmed' && !stale;
  return {
    statusLabel,
    canConfirm: input.declarationTicked && !input.confirmPending && !alreadyConfirmed,
  };
}
