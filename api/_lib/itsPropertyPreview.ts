import { auditEvents } from '../../server/src/db/schema.js';
import { hmrcApiBase, HMRC_JSON_HEADERS, PROPERTY_BUSINESS_API_ACCEPT, propertyCumulativePath } from '../../src/lib/hmrc/client.js';
import { quarterEndDate } from '../../src/lib/itsCumulativeUpdate.js';
import { buildPropertyCumulativeSummary } from '../../src/lib/itsPropertyUpdate.js';
import { taxYearPeriod } from '../../src/lib/taxYearSummary.js';
import { db } from './db.js';
import { requestFraudHeaders } from './hmrcCall.js';
import { databaseHmrcStore } from './hmrcStore.js';
import { checkItsReadiness, itsCumulativePreviewSchema, type ItsCumulativePreviewDeps, type ItsCumulativePreviewInput } from './itsCumulativePreview.js';
import { databaseTaxIdentifiersStore, maskNino } from './taxIdentifiers.js';
import { databaseTaxYearSummaryStore, getPropertySummary } from './taxYearSummary.js';

// Same year and quarter rules as the self-employment update, so the two previews cannot drift apart.
export const itsPropertyPreviewSchema = itsCumulativePreviewSchema;

const recordPreviewInDatabase: NonNullable<ItsCumulativePreviewDeps['recordPreview']> = async (userId, metadata) => {
  await db.insert(auditEvents).values({
    userId,
    actorType: 'user',
    action: 'its_property_update.previewed',
    resourceType: 'its_property_cumulative_update',
    metadata,
  });
};

/**
 * Shows what the cumulative property update would send, without calling HMRC. The audit event carries
 * the year, quarter and mode, never the body. The fraud headers shown are the set a real call would send.
 */
export async function previewItsPropertyUpdateForUser(
  { userId, taxYear, quarter, request }: { userId: string; request: Request } & ItsCumulativePreviewInput,
  {
    hmrcStore = databaseHmrcStore,
    identifiers = databaseTaxIdentifiersStore,
    summaryStore = databaseTaxYearSummaryStore,
    recordPreview = recordPreviewInDatabase,
  }: ItsCumulativePreviewDeps = {},
) {
  const readiness = await checkItsReadiness(userId, hmrcStore, identifiers, 'property');
  if (!readiness.ok) return readiness;
  const { sandbox, nino, businessId } = readiness;

  const summary = await getPropertySummary(summaryStore, userId, { start: taxYearPeriod(taxYear)!.start, end: quarterEndDate(taxYear, quarter) });
  await recordPreview(userId, { taxYear, quarter, sandbox });

  return {
    ok: true as const,
    data: {
      endpoint: {
        method: 'PUT',
        url: `${hmrcApiBase()}${propertyCumulativePath(maskNino(nino), maskNino(businessId), taxYear)}`,
        sandbox,
      },
      body: buildPropertyCumulativeSummary(summary),
      headers: {
        ...HMRC_JSON_HEADERS,
        Accept: PROPERTY_BUSINESS_API_ACCEPT,
        ...requestFraudHeaders(request, userId, new Date()),
        Authorization: 'Bearer (hidden)',
      } as Record<string, string>,
    },
  };
}
