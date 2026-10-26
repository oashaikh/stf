import { buildFraudHeaders } from '../../src/lib/hmrc/fraudHeaders';
import { getVatObligations, HmrcError, refreshAccessToken, withHmrcToken, type HmrcTokenSet } from '../../src/lib/hmrc/client';
import { withAuth, type AuthDeps } from '../_lib/auth';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore';

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
    const { vatNumber, storedRefreshToken } = credentials;

    const fraudHeaders = buildFraudHeaders({
      request,
      userId: auth.userId,
      appVersion: process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
      vendorPublicIp: process.env.HMRC_VENDOR_PUBLIC_IP,
      now: now(),
    });

    try {
      const { obligations } = await withHmrcToken(
        {
          accessToken: credentials.accessToken,
          refreshToken: credentials.refreshToken,
          expiresAt: credentials.expiresAt.getTime(),
        },
        (accessToken) =>
          getVatObligations(vatNumber, accessToken, query.from, query.to, fraudHeaders, fetchFn, query.status),
        // A lost compare-and-swap means a concurrent request already rotated the stored tokens; ours still serve this retry.
        // A failed save must not fail the request: the rotated token is still valid for this call.
        async (refreshed) => {
          try {
            await store.saveRefreshedTokens(auth.userId, storedRefreshToken, {
              accessToken: refreshed.accessToken,
              refreshToken: refreshed.refreshToken,
              expiresAt: new Date(refreshed.expiresAt),
            });
          } catch {
            // The error text can echo tokens, so log a fixed message only. The user may need to reconnect HMRC.
            console.error('HMRC refreshed tokens could not be saved');
          }
        },
        refresh,
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
    } catch (error) {
      if (!(error instanceof HmrcError)) throw error;
      // Log the HMRC code and status only: its message can echo tokens or the VAT number.
      console.error('HMRC obligations error', error.apiError.code, error.apiError.statusCode);
      return failure(502, error.apiError.code, 'HMRC request failed', { hmrcStatus: error.apiError.statusCode });
    }
  }, authDeps);
}

export default { fetch: createObligationsHandler() };
