import { hmrcApiBase, HMRC_JSON_HEADERS, vatReturnsPath } from '../../src/lib/hmrc/client.js';
import { auditEvents } from '../../server/src/db/schema.js';
import { db } from './db.js';
import { databaseHmrcStore, type HmrcStore } from './hmrcStore.js';
import { prepareSubmission } from './vatSubmit.js';
import { databaseStore, type Period, type VatReturnStore } from './vatReturns.js';

export interface PreviewDeps {
  vatStore?: VatReturnStore;
  hmrcStore?: HmrcStore;
  now?: () => Date;
  recordPreview?: (userId: string, metadata: { periodKey: string; sandbox: boolean }) => Promise<void>;
}

const recordPreviewInDatabase: NonNullable<PreviewDeps['recordPreview']> = async (userId, metadata) => {
  await db.insert(auditEvents).values({
    userId,
    actorType: 'user',
    action: 'vat_return.previewed',
    resourceType: 'vat_return',
    metadata,
  });
};

// Only the last 3 digits identify the trader on screen; the rest stays out of the response.
const maskVrn = (vrn: string) => `${'*'.repeat(Math.max(vrn.length - 3, 0))}${vrn.slice(-3)}`;

/**
 * Shows what submitVatReturnForUser would send, without claiming the period or calling HMRC. The
 * only write is the audit event, which carries the period and mode, never the body or headers.
 */
export async function previewVatReturnForUser(
  { userId, period, request }: { userId: string; period: Period; request: Request },
  { vatStore = databaseStore, hmrcStore = databaseHmrcStore, now = () => new Date(), recordPreview = recordPreviewInDatabase }: PreviewDeps = {},
) {
  const { sandbox, vatNumber, fraudHeaders, payload } = await prepareSubmission(
    { userId, period, request },
    vatStore,
    hmrcStore,
    now,
  );
  await recordPreview(userId, { periodKey: period.periodKey, sandbox });

  return {
    endpoint: { method: 'POST', url: `${hmrcApiBase()}${vatReturnsPath(maskVrn(vatNumber))}`, sandbox },
    body: payload,
    headers: { ...HMRC_JSON_HEADERS, Authorization: 'Bearer (hidden)', ...fraudHeaders } as Record<string, string>,
  };
}
