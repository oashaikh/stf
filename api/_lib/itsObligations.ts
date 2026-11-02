import type { ItsFinalDeclarationObligations, ItsIncomeAndExpenditureObligations, ItsObligationDetail } from '../../src/lib/hmrc/client.js';

/** What is stored per tax year and what the page shows, before today's date is applied. */
export interface ItsObligation {
  /** Which HMRC business the row belongs to, so the Tax page can tell the two sets apart. */
  business: 'self-employment' | 'uk-property';
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

function normaliseDetail(business: ItsObligation['business'], kind: ItsObligation['kind'], taxYear: string, detail: ItsObligationDetail): ItsObligation {
  return {
    business,
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
    ...quarterly.obligations.flatMap((business) => business.obligationDetails.map((detail) => normaliseDetail('self-employment', 'quarterly', taxYear, detail))),
    ...finalDeclaration.obligations.map((detail) => normaliseDetail('self-employment', 'finalDeclaration', taxYear, detail)),
  ];
}

/** The final declaration is per taxpayer and already comes with the self-employment rows, so property adds quarterly rows only. */
export function normalisePropertyObligations(taxYear: string, quarterly: ItsIncomeAndExpenditureObligations): ItsObligation[] {
  return quarterly.obligations.flatMap((business) => business.obligationDetails.map((detail) => normaliseDetail('uk-property', 'quarterly', taxYear, detail)));
}

/** Rows cached before property support carry no tag; they were all self-employment. */
export function withBusinessTag(row: ItsObligation | Omit<ItsObligation, 'business'>): ItsObligation {
  return { business: 'self-employment', ...row };
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
