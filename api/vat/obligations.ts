import { getVatObligations, refreshAccessToken, type HmrcTokenSet } from '../../src/lib/hmrc/client.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { callHmrcAsUser } from '../_lib/hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';

export interface ObligationsHmrcDeps {
  fetchFn?: typeof fetch;
  refresh?: (refreshToken: string) => Promise<HmrcTokenSet>;
  now?: () => Date;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// HMRC rejects an obligations range longer than one year; a leap-year span is 366 days.
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

function failure(status: number, code: string, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ ok: false, error, code, ...extra }, { status });
}

/** Returns the date as a UTC midnight timestamp, or undefined unless it is a real YYYY-MM-DD calendar date. */
function parseDay(value: string): number | undefined {
  if (!DATE_PATTERN.test(value)) return undefined;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return undefined;
  return timestamp;
}

const isoDay = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10);

function oneYearBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function parseQuery(url: URL, today: string): { from: string; to: string; status?: 'O' | 'F' } | undefined {
  const to = url.searchParams.get('to') ?? today;
  const from = url.searchParams.get('from') ?? oneYearBefore(to);
  const status = url.searchParams.get('status') ?? undefined;
  const fromTime = parseDay(from);
  const toTime = parseDay(to);
  if (fromTime === undefined || toTime === undefined || fromTime > toTime) return undefined;
  if ((toTime - fromTime) / DAY_MS > MAX_RANGE_DAYS) return undefined;
  if (status !== undefined && status !== 'O' && status !== 'F') return undefined;
  return { from, to, status };
}

export function createObligationsHandler(
  store: HmrcStore = databaseHmrcStore,
  authDeps?: AuthDeps,
  hmrcDeps: ObligationsHmrcDeps = {},
) {
  const { fetchFn, refresh = refreshAccessToken, now = () => new Date() } = hmrcDeps;

  return withAuth(async (request, auth) => {
    if (request.method !== 'GET') return failure(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

    const today = isoDay(now().getTime());
    const query = parseQuery(new URL(request.url), today);
    if (!query) return failure(400, 'BAD_REQUEST', 'Invalid from, to or status');

    const credentials = await store.credentials(auth.userId);
    if (!credentials) return failure(409, 'HMRC_NOT_CONNECTED', 'HMRC is not connected');
    if (!credentials.vatNumber) return failure(409, 'VAT_NUMBER_MISSING', 'No VAT number is set');
    const { vatNumber } = credentials;

    return callHmrcAsUser(
      {
        request,
        userId: auth.userId,
        credentials,
        store,
        label: 'obligations',
        call: async (accessToken, fraudHeaders) => {
          const { obligations } = await getVatObligations(
            vatNumber,
            accessToken,
            query.from,
            query.to,
            fraudHeaders,
            fetchFn,
            query.status,
          );
          return Response.json({
            ok: true,
            obligations: obligations.map(({ periodKey, start, end, due, status, received }) => ({
              periodKey,
              start,
              end,
              due,
              status,
              received,
              overdue: status === 'O' && due < today,
            })),
          });
        },
      },
      { refresh, now },
    );
  }, authDeps);
}

export default { fetch: createObligationsHandler() };
