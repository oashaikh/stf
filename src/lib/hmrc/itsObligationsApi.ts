import { browserFraudHeaders } from './vatApi';

type FetchFn = typeof fetch;

/** Mirrors ItsObligationView in api/_lib/itsObligations.ts. */
export interface ItsObligationRow {
  kind: 'quarterly' | 'finalDeclaration';
  taxYear: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: 'open' | 'fulfilled';
  receivedDate: string | null;
  overdue: boolean;
  nextDue: boolean;
}

export interface ItsObligationsState {
  obligations: ItsObligationRow[];
  stale: boolean;
  fetchedAt: string | null;
  error: string | null;
}

/** Why the section cannot show dates yet; each one has a Settings step to fix it. */
export type ItsSetupGap = 'not-connected' | 'reconnect' | 'no-business' | 'no-nino';

const SETUP_GAPS: Record<string, ItsSetupGap> = {
  HMRC_NOT_CONNECTED: 'not-connected',
  ITS_SCOPE_MISSING: 'reconnect',
  NO_BUSINESS_SELECTED: 'no-business',
  NO_NINO: 'no-nino',
};

/** Resolves to null when Income Tax is switched off, so the page can show nothing at all. */
export async function fetchItsObligations(fetchFn: FetchFn = fetch): Promise<ItsObligationsState | { gap: ItsSetupGap } | null> {
  const response = await fetchFn('/api/hmrc/its-obligations', {
    credentials: 'same-origin',
    headers: browserFraudHeaders(),
  });
  if (response.status === 404) return null;
  if (response.status === 409) {
    const { code } = await response.json().catch(() => ({ code: undefined }));
    const gap = SETUP_GAPS[code];
    if (gap) return { gap };
  }
  if (!response.ok) throw new Error('Request to /api/hmrc/its-obligations failed');
  const body = await response.json();
  return {
    obligations: body.obligations,
    stale: body.stale === true,
    fetchedAt: body.fetchedAt ?? null,
    error: body.error ?? null,
  };
}
