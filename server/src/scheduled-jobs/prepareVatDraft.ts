import { eq } from 'drizzle-orm';
import { getVatObligations, refreshAccessToken } from '../../../src/lib/hmrc/client.js';
import { getObligationDueWithin, REMINDER_WINDOW_DAYS, type VatObligation } from '../../../src/lib/vatReminder.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { decryptToken, encryptToken } from '../lib/hmrcCrypto.js';
import type { ScheduledJob } from './index.js';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // Daily

export interface PrepareDraftDeps {
  findOwner: () => Promise<{ id: string; vatNumber: string | null; hmrcAccessToken: string | null; hmrcRefreshToken: string | null; hmrcTokenExpiresAt: Date | null } | null>;
  fetchObligations: (vatNumber: string, accessToken: string) => Promise<VatObligation[]>;
  saveTokens: (userId: string, tokens: { accessToken: string; refreshToken: string; expiresAt: Date }) => Promise<void>;
  saveDraft: (userId: string, period: { periodKey: string; start: string; end: string }) => Promise<void>;
  now: () => Date;
}

export interface PrepareSummary {
  attempted: boolean;
  saved: boolean;
  reason?: string;
}

export async function prepareVatDraft(deps: PrepareDraftDeps): Promise<PrepareSummary> {
  const { findOwner, fetchObligations, saveTokens, saveDraft, now } = deps;
  const summary: PrepareSummary = { attempted: true, saved: false };

  try {
    const owner = await findOwner();
    if (!owner) {
      summary.reason = 'no_owner_found';
      return summary;
    }

    if (!owner.vatNumber) {
      summary.reason = 'vat_number_missing';
      return summary;
    }

    if (!owner.hmrcRefreshToken) {
      summary.reason = 'hmrc_not_connected';
      return summary;
    }

    const today = now().toISOString().split('T')[0];
    let accessToken: string = owner.hmrcAccessToken ? decryptToken(owner.hmrcAccessToken) : '';
    let refreshToken: string = owner.hmrcRefreshToken ? decryptToken(owner.hmrcRefreshToken) : '';

    if (!accessToken || !refreshToken) {
      summary.reason = 'hmrc_not_connected';
      return summary;
    }

    // Refresh the access token if needed
    if (owner.hmrcTokenExpiresAt && new Date(owner.hmrcTokenExpiresAt).getTime() < now().getTime()) {
      try {
        const refreshed = await refreshAccessToken(refreshToken);
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        await saveTokens(owner.id, {
          accessToken,
          refreshToken,
          expiresAt: new Date(refreshed.expiresAt),
        });
      } catch (error) {
        summary.reason = 'token_refresh_failed';
        console.error('[prepare-vat-draft] token refresh failed:', error instanceof Error ? error.name : typeof error);
        return summary;
      }
    }

    // Fetch obligations
    try {
      const obligations = await fetchObligations(owner.vatNumber as string, accessToken);
      const dueObligation = getObligationDueWithin(obligations, today, REMINDER_WINDOW_DAYS);

      if (!dueObligation) {
        summary.reason = 'no_obligation_due';
        return summary;
      }

      await saveDraft(owner.id, {
        periodKey: dueObligation.periodKey,
        start: dueObligation.start,
        end: dueObligation.end,
      });

      summary.saved = true;
      return summary;
    } catch (error) {
      summary.reason = 'obligations_fetch_failed';
      console.error('[prepare-vat-draft] obligations fetch failed:', error instanceof Error ? error.name : typeof error);
      return summary;
    }
  } catch (error) {
    summary.reason = 'unexpected_error';
    console.error('[prepare-vat-draft] unexpected error:', error instanceof Error ? error.name : typeof error);
    return summary;
  }
}

// Real implementation with database
const databaseFindOwner = async () => {
  const result = await db
    .select({
      id: users.id,
      vatNumber: users.vatNumber,
      hmrcAccessToken: users.hmrcAccessToken,
      hmrcRefreshToken: users.hmrcRefreshToken,
      hmrcTokenExpiresAt: users.hmrcTokenExpiresAt,
    })
    .from(users)
    .where(eq(users.clerkUserId, 'owner'))
    .limit(1);
  return result[0] ?? null;
};

const databaseFetchObligations = async (vatNumber: string, accessToken: string): Promise<VatObligation[]> => {
  const { obligations } = await getVatObligations(
    vatNumber,
    accessToken,
    new Date().toISOString().split('T')[0],
    new Date().toISOString().split('T')[0],
    {},
  );
  return obligations.map((o) => ({
    periodKey: o.periodKey,
    start: o.start,
    end: o.end,
    due: o.due,
    status: o.status as 'O' | 'F',
  }));
};

const databaseSaveTokens = async (userId: string, tokens: { accessToken: string; refreshToken: string; expiresAt: Date }) => {
  await db
    .update(users)
    .set({
      hmrcAccessToken: encryptToken(tokens.accessToken),
      hmrcRefreshToken: encryptToken(tokens.refreshToken),
      hmrcTokenExpiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
};

// Lazy-load saveReturnDraft to avoid circular dependencies at module load time
const databaseSaveDraft = async (userId: string, period: { periodKey: string; start: string; end: string }) => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { saveReturnDraft, databaseStore } = await import('../../../api/_lib/vatReturns.js');
  await saveReturnDraft(databaseStore, userId, period, false);
};

export const runPrepareVatDraft = (): Promise<PrepareSummary> =>
  prepareVatDraft({
    findOwner: databaseFindOwner,
    fetchObligations: databaseFetchObligations,
    saveTokens: databaseSaveTokens,
    saveDraft: databaseSaveDraft,
    now: () => new Date(),
  });

export const prepareVatDraftJob: ScheduledJob = {
  name: 'prepare-vat-draft',
  intervalMs: TICK_INTERVAL_MS,
  run: async () => {
    await runPrepareVatDraft();
  },
};
