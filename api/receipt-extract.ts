import Anthropic from '@anthropic-ai/sdk';

import { withAuth, type AuthDeps } from './_lib/auth.js';
import { databaseExtractionStore, extractReceipt, type ExtractionDeps, type ExtractionOutcome } from './_lib/receiptExtraction.js';
import { createReceiptStorage } from './_lib/receiptStorage.js';
import { validateReceiptId } from './_lib/receipts.js';

const refuse = (status: number, error: string, code: string) => Response.json({ ok: false, error, code }, { status });

export type ExtractHandlerDeps = Partial<Pick<ExtractionDeps, 'store' | 'storage' | 'client' | 'now' | 'env'>>;

// Deps are built per request so a deployment without storage settings answers 503 instead of failing to load.
export function createReceiptExtractHandler(overrides: ExtractHandlerDeps = {}, authDeps?: AuthDeps) {
  return withAuth(async (request, auth) => {
    if (request.method !== 'POST') return refuse(405, 'Method not allowed', 'METHOD');

    const id = validateReceiptId(await request.json().catch(() => null));
    if (!id) return refuse(400, 'Receipt id must be a uuid', 'BAD_REQUEST');

    let storage: ExtractionDeps['storage'];
    try {
      storage = overrides.storage ?? createReceiptStorage();
    } catch (error) {
      // The message names only the missing variable, never a value.
      console.error('Receipt storage config error:', error instanceof Error ? error.message : 'unknown');
      return refuse(503, 'Receipt storage is not configured', 'STORAGE_UNAVAILABLE');
    }

    // The service only reports a status, so keep the saved outcome to return the drafts.
    let saved: ExtractionOutcome | undefined;
    const store = overrides.store ?? databaseExtractionStore;
    const result = await extractReceipt(
      {
        store: {
          findReady: (userId, receiptId) => store.findReady(userId, receiptId),
          countRecent: (userId, since, limit) => store.countRecent(userId, since, limit),
          save: async (userId, receiptId, outcome) => {
            await store.save(userId, receiptId, outcome);
            saved = outcome;
          },
        },
        storage,
        // An empty key is never used: the service skips extraction when the key is unset.
        client: overrides.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' }),
        now: overrides.now ?? (() => new Date()),
        env: overrides.env ?? process.env,
      },
      auth.userId,
      id,
    );
    if (result.status === 'not_found') return refuse(404, 'Receipt not found', 'NOT_FOUND');

    if (result.status === 'rate_limited') return refuse(429, 'Too many receipts read this hour. Try again later or enter it by hand.', 'RATE_LIMITED');

    // Never file_key or the raw reply: only the status and the draft fields the owner reviews.
    return Response.json({
      ok: true,
      receipt: { id, aiStatus: result.status === 'already_extracted' ? 'extracted' : result.status, drafts: saved?.extractions ?? [] },
    });
  }, authDeps);
}

export default { fetch: createReceiptExtractHandler() };
