import type { ItsFinalDeclarationObligations, ItsIncomeAndExpenditureObligations, ItsObligationDetail } from '../../src/lib/hmrc/client.js';

/** What is stored per tax year and what the page shows, before today's date is applied. */
export interface ItsObligation {
  kind: 'quarterly' | 'finalDeclaration';
  taxYear: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: 'open' | 'fulfilled';
  receivedDate: string | null;
}

export interface ItsObligationView extends ItsObligation {
  overdue: boolean;
  nextDue: boolean;
}

/** '2026-27' gives '2025-26'. Works from the label alone so no date is hard-coded. */
export function previousTaxYear(taxYear: string): string {
  const startYear = Number(taxYear.slice(0, 4)) - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function normaliseDetail(kind: ItsObligation['kind'], taxYear: string, detail: ItsObligationDetail): ItsObligation {
  return {
    kind,
    taxYear,
    periodStart: detail.periodStartDate,
    periodEnd: detail.periodEndDate,
    dueDate: detail.dueDate,
    status: detail.status === 'Fulfilled' ? 'fulfilled' : 'open',
    receivedDate: detail.receivedDate ?? null,
  };
}

/** Flattens HMRC's two responses for one tax year. Only HMRC's own fields are kept (SEC-12). */
export function normaliseItsObligations(
  taxYear: string,
  quarterly: ItsIncomeAndExpenditureObligations,
  finalDeclaration: ItsFinalDeclarationObligations,
): ItsObligation[] {
  return [
    ...quarterly.obligations.flatMap((business) => business.obligationDetails.map((detail) => normaliseDetail('quarterly', taxYear, detail))),
    ...finalDeclaration.obligations.map((detail) => normaliseDetail('finalDeclaration', taxYear, detail)),
  ];
}

/**
 * Orders by period start, flags open items past their due date, and flags exactly one open item as
 * next due: the earliest due date, ties broken by the earlier period start. `today` is YYYY-MM-DD.
 */
export function markItsObligations(obligations: ItsObligation[], today: string): { obligations: ItsObligationView[]; nextDue: ItsObligationView | null } {
  const ordered = [...obligations].sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.dueDate.localeCompare(b.dueDate));
  const views: ItsObligationView[] = ordered.map((obligation) => ({
    ...obligation,
    overdue: obligation.status === 'open' && obligation.dueDate < today,
    nextDue: false,
  }));
  const nextDue = views
    .filter((view) => view.status === 'open')
    .reduce<ItsObligationView | null>((best, view) => (best === null || view.dueDate < best.dueDate ? view : best), null);
  if (nextDue) nextDue.nextDue = true;
  return { obligations: views, nextDue };
}
