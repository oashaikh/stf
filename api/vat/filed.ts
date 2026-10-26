import { getVatReturn, refreshAccessToken } from '../../src/lib/hmrc/client.js';
import { withAuth, type AuthDeps } from '../_lib/auth.js';
import { callHmrcAsUser, type HmrcCallDeps } from '../_lib/hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';

// Rate limiting: see the ponytail note in submit.ts (SEC-14).
export function createFiledReturnHandler(
  store: HmrcStore = databaseHmrcStore,
  authDeps?: AuthDeps,
  { fetchFn, refresh = refreshAccessToken, now }: HmrcCallDeps & { fetchFn?: typeof fetch } = {},
) {
  return withAuth(async (request, auth) => {
    const fail = (status: number, code: string, error: string) => Response.json({ ok: false, error, code }, { status });
    if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');

    const periodKey = new URL(request.url).searchParams.get('periodKey');
    if (!periodKey || periodKey.length > 20) return fail(400, 'BAD_REQUEST', 'Invalid periodKey');

    const credentials = await store.credentials(auth.userId);
    if (!credentials) return fail(409, 'HMRC_NOT_CONNECTED', 'HMRC is not connected');
    if (!credentials.vatNumber) return fail(409, 'VAT_NUMBER_MISSING', 'No VAT number is set');
    const { vatNumber } = credentials;

    return callHmrcAsUser(
      {
        request,
        userId: auth.userId,
        credentials,
        store,
        label: 'view return',
        call: async (accessToken, fraudHeaders) =>
          Response.json({ ok: true, data: await getVatReturn(vatNumber, periodKey, accessToken, fraudHeaders, fetchFn) }),
      },
      { refresh, now },
    );
  }, authDeps);
}

export default { fetch: createFiledReturnHandler() };
