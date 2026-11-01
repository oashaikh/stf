import { z } from 'zod';

import { auditEvents } from '../../server/src/db/schema.js';
import { decryptToken } from '../../server/src/lib/hmrcCrypto.js';
import { hmrcApiBase, HMRC_JSON_HEADERS, SELF_EMPLOYMENT_API_ACCEPT, selfEmploymentCumulativePath } from '../../src/lib/hmrc/client.js';
import { buildCumulativePeriodSummary, quarterEndDate } from '../../src/lib/itsCumulativeUpdate.js';
import { TAX_BANDS } from '../../src/lib/taxBands.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { db } from './db.js';
import { databaseHmrcStore, type HmrcStore } from './hmrcStore.js';
import { databaseTaxIdentifiersStore, maskNino, type TaxIdentifiersStore } from './taxIdentifiers.js';
import { databaseTaxYearSummaryStore, getTaxYearSummary, type TaxYearSummaryStore } from './taxYearSummary.js';

// Same rule as parseTaxYearPeriod: well formed and has tax bands. The NINO and business id are never input.
export const itsCumulativePreviewSchema = z
  .object({
    taxYear: z.string().refine((value) => value in TAX_BANDS && taxYearPeriod(value) !== null),
    quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  })
  .strict();

export type ItsCumulativePreviewInput = z.infer<typeof itsCumulativePreviewSchema>;

export interface ItsCumulativePreviewDeps {
  hmrcStore?: HmrcStore;
  identifiers?: TaxIdentifiersStore;
  summaryStore?: TaxYearSummaryStore;
  recordPreview?: (userId: string, metadata: { taxYear: string; quarter: number; sandbox: boolean }) => Promise<void>;
}

const recordPreviewInDatabase: NonNullable<ItsCumulativePreviewDeps['recordPreview']> = async (userId, metadata) => {
  await db.insert(auditEvents).values({
    userId,
    actorType: 'user',
    action: 'its_update.previewed',
    resourceType: 'its_cumulative_update',
    metadata,
  });
};

type Refusal = { ok: false; status: number; code: string; error: string };

const refuse = (status: number, code: string, error: string): Refusal => ({ ok: false, status, code, error });

/**
 * Shows what the cumulative quarterly update would send, without calling HMRC or writing HMRC
 * state. The only write is the audit event, which carries the year, quarter and mode, never the body.
 */
export async function previewItsCumulativeUpdateForUser(
  { userId, taxYear, quarter }: { userId: string } & ItsCumulativePreviewInput,
  {
    hmrcStore = databaseHmrcStore,
    identifiers = databaseTaxIdentifiersStore,
    summaryStore = databaseTaxYearSummaryStore,
    recordPreview = recordPreviewInDatabase,
  }: ItsCumulativePreviewDeps = {},
) {
  // Off by default: nothing below runs, so no database read.
  if (process.env.HMRC_ITSA_ENABLED !== 'true') return refuse(404, 'ITSA_DISABLED', 'Income Tax is off');

  // Live needs both switches: the deployment env and the user's own opt-in.
  const userSandbox = await hmrcStore.sandboxMode(userId);
  const sandbox = process.env.HMRC_SANDBOX_MODE !== 'false';
  if (userSandbox === undefined || userSandbox !== sandbox) return refuse(403, 'LIVE_MODE_REFUSED', 'HMRC mode not allowed');

  if (!(await hmrcStore.credentials(userId))) return refuse(409, 'HMRC_NOT_CONNECTED', 'HMRC is not connected');
  const { itsBusinessId, needsItsReconnect } = await hmrcStore.status(userId);
  if (needsItsReconnect) return refuse(409, 'ITS_SCOPE_MISSING', 'Reconnect HMRC to grant Income Tax access');
  if (!itsBusinessId) return refuse(409, 'NO_BUSINESS_SELECTED', 'Choose your self-employment business first');
  const stored = await identifiers.get(userId);
  if (!stored?.ninoEncrypted) return refuse(409, 'NO_NINO', 'Add your National Insurance number first');
  const nino = decryptToken(stored.ninoEncrypted);

  const summary = await getTaxYearSummary(summaryStore, userId, { start: taxYearPeriod(taxYear)!.start, end: quarterEndDate(taxYear, quarter) });
  await recordPreview(userId, { taxYear, quarter, sandbox });

  return {
    ok: true as const,
    data: {
      endpoint: {
        method: 'PUT',
        url: `${hmrcApiBase()}${selfEmploymentCumulativePath(maskNino(nino), maskNino(itsBusinessId), taxYear)}`,
        sandbox,
      },
      body: buildCumulativePeriodSummary(summary),
      headers: { ...HMRC_JSON_HEADERS, Accept: SELF_EMPLOYMENT_API_ACCEPT, Authorization: 'Bearer (hidden)' } as Record<string, string>,
    },
  };
}
