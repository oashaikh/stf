import { createHash, timingSafeEqual } from 'node:crypto';

import { getVatObligations, refreshAccessToken, type HmrcTokenSet } from '../../src/lib/hmrc/client.js';
import { getObligationDueWithin, REMINDER_WINDOW_DAYS } from '../../src/lib/vatReminder.js';
import { databaseUsers, type UserStore } from '../_lib/auth.js';
import { callHmrcAsUser } from '../_lib/hmrcCall.js';
import { databaseHmrcStore, type HmrcStore } from '../_lib/hmrcStore.js';
import { OWNER_EXTERNAL_ID } from '../_lib/ownerSession.js';
import { databaseStore, saveReturnDraft, VatReturnError, type Period } from '../_lib/vatReturns.js';

// Hashing first gives equal-length buffers, so timingSafeEqual neither throws nor leaks the secret's length.
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export interface PrepareDraftDeps {
  cronSecret?: string;
  users?: Pick<UserStore, 'findId'>;
  store?: HmrcStore;
  /** Always called with reopen=false, so a confirmed draft is left alone. */
  saveDraft?: (userId: string, period: Period) => Promise<unknown>;
  fetchFn?: typeof fetch;
  refresh?: (refreshToken: string) => Promise<HmrcTokenSet>;
  now?: () => Date;
}

const skipped = (reason: string) => Response.json({ ok: true, saved: false, reason });

// This route only ever saves a draft. Sending anything to HMRC stays with the signed-in owner.
export function createPrepareDraftHandler({
  cronSecret,
  users = databaseUsers,
  store = databaseHmrcStore,
  saveDraft = (userId, period) => saveReturnDraft(databaseStore, userId, period, false),
  fetchFn,
  refresh = refreshAccessToken,
  now = () => new Date(),
}: PrepareDraftDeps = {}) {
  return async (request: Request): Promise<Response> => {
    // Fail closed: with no secret configured nobody is authorised.
    if (!cronSecret) return Response.json({ ok: false }, { status: 401 });
    const presented = request.headers.get('authorization') ?? '';
    if (!timingSafeEqual(sha256(presented), sha256(`Bearer ${cronSecret}`))) {
      return Response.json({ ok: false }, { status: 401 });
    }
    try {
      const userId = await users.findId(OWNER_EXTERNAL_ID);
      if (!userId) return skipped('no_owner');
      const credentials = await store.credentials(userId);
      if (!credentials) return skipped('hmrc_not_connected');
      const { vatNumber } = credentials;
      if (!vatNumber) return skipped('vat_number_missing');

      const today = now().toISOString().slice(0, 10);
      const windowEnd = new Date(now().getTime() + REMINDER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
      // Open obligations only, up to the end of the window; overdue ones come back too. No DB transaction is open here.
      const hmrcResponse = await callHmrcAsUser(
        {
          request,
          userId,
          credentials,
          store,
          label: 'prepare-vat-draft',
          call: async (accessToken, fraudHeaders) =>
            Response.json(
              (await getVatObligations(vatNumber, accessToken, oneYearBefore(windowEnd), windowEnd, fraudHeaders, fetchFn, 'O'))
                .obligations,
            ),
        },
        { refresh, now },
      );
      if (!hmrcResponse.ok) return Response.json({ ok: false }, { status: 502 });

      const due = getObligationDueWithin(await hmrcResponse.json(), today, REMINDER_WINDOW_DAYS);
      if (!due) return skipped('no_obligation_due');
      await saveDraft(userId, { periodKey: due.periodKey, start: due.start, end: due.end });
      return Response.json({ ok: true, saved: true });
    } catch (error) {
      // A confirmed or already-filed period is expected to refuse a draft; that is not a job failure.
      if (error instanceof VatReturnError) return skipped(error.code.toLowerCase());
      // The error class only: the message could echo a token or the VAT number.
      console.error(`[prepare-vat-draft] cron run failed: ${error instanceof Error ? error.name : typeof error}`);
      return Response.json({ ok: false }, { status: 500 });
    }
  };
}

function oneYearBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; the env var is read per request.
export default { fetch: (request: Request) => createPrepareDraftHandler({ cronSecret: process.env.CRON_SECRET })(request) };
