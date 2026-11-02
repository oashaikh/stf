import { and, eq, isNull } from 'drizzle-orm';

import { auditEvents, receiptExtractions, receipts } from '../../server/src/db/schema.js';
import { buildReceiptSystemPrompt, buildReceiptUserPrompt, parseReceiptReply, type ReceiptDraft } from '../../src/lib/receiptPrompt.js';
import { db } from './db.js';
import type { NewReceipt } from './receipts.js';
import type { ReceiptStorage } from './receiptStorage.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_REPLY_TOKENS = 1024;
const DRAFT_FIELDS = ['date', 'vendor', 'totalPence', 'vatPence', 'category'] as const;

export interface ReadyReceipt {
  id: string;
  fileKey: string;
  mimeType: NewReceipt['mimeType'];
}

export interface ExtractionOutcome {
  aiStatus: 'extracted' | 'failed' | 'skipped';
  aiModel: string | null;
  /** Integer thousandths, 0-1000. */
  aiConfidence: number | null;
  rawOutput: { reply: string } | null;
  /** One draft row per field the model returned; confidence in integer thousandths. */
  extractions: { field: string; suggestedValue: string; confidence: number }[];
  audit: { action: string; metadata: Record<string, unknown> };
}

// Injected so tests never touch a database. Every call is scoped by userId from the session.
export interface ExtractionStore {
  /** The live, ready receipt for (id, userId), or undefined. */
  findReady(userId: string, id: string): Promise<ReadyReceipt | undefined>;
  /** Writes the outcome and its audit event in one transaction. Never touches transactions. */
  save(userId: string, id: string, outcome: ExtractionOutcome): Promise<void>;
}

type ContentBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/webp'; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'text'; text: string };

/** The part of the Anthropic SDK this module uses, so tests can pass a fake. */
export interface ModelClient {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: 'user'; content: ContentBlock[] }[];
    }): Promise<{ content: { type: string; text?: string }[] }>;
  };
}

export interface ExtractionDeps {
  store: ExtractionStore;
  storage: Pick<ReceiptStorage, 'getObject'>;
  client: ModelClient;
  now: () => Date;
  env: Record<string, string | undefined>;
}

export type ExtractionResult = { status: 'extracted' | 'failed' | 'skipped' | 'not_found' };

const failedOutcome = (model: string, rawOutput: ExtractionOutcome['rawOutput']): ExtractionOutcome => ({
  aiStatus: 'failed',
  aiModel: model,
  aiConfidence: null,
  rawOutput,
  extractions: [],
  audit: { action: 'receipt.extract', metadata: { status: 'failed' } },
});

function draftRows(draft: ReceiptDraft) {
  return DRAFT_FIELDS.flatMap((field) => {
    const extracted = draft[field];
    return extracted ? [{ field, suggestedValue: String(extracted.value), confidence: extracted.confidence }] : [];
  });
}

/**
 * Reads one ready receipt with the model and stores the result as drafts. The file read and the model
 * call finish before the store opens its transaction (COD-4). Logs carry the receipt id and an error
 * class only: never receipt content, model output or keys.
 */
export async function extractReceipt(deps: ExtractionDeps, userId: string, receiptId: string): Promise<ExtractionResult> {
  const receipt = await deps.store.findReady(userId, receiptId);
  if (!receipt) return { status: 'not_found' };

  const model = deps.env.RECEIPT_AI_MODEL || DEFAULT_MODEL;
  if (!deps.env.ANTHROPIC_API_KEY || deps.env.RECEIPT_AI_ENABLED === 'false') {
    await deps.store.save(userId, receipt.id, {
      aiStatus: 'skipped',
      aiModel: null,
      aiConfidence: null,
      rawOutput: null,
      extractions: [],
      audit: { action: 'receipt.extract', metadata: { status: 'skipped' } },
    });
    return { status: 'skipped' };
  }

  let reply: string;
  try {
    const bytes = await deps.storage.getObject(receipt.fileKey);
    const data = Buffer.from(bytes).toString('base64');
    const file: ContentBlock =
      receipt.mimeType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: receipt.mimeType, data } };
    const response = await deps.client.messages.create({
      model,
      max_tokens: MAX_REPLY_TOKENS,
      system: buildReceiptSystemPrompt(deps.now().toISOString().slice(0, 10)),
      messages: [{ role: 'user', content: [file, { type: 'text', text: buildReceiptUserPrompt() }] }],
    });
    reply = response.content.map((block) => block.text ?? '').join('');
  } catch (error) {
    console.error('Receipt extraction call failed:', receipt.id, error instanceof Error ? error.constructor.name : 'unknown');
    await deps.store.save(userId, receipt.id, failedOutcome(model, null));
    return { status: 'failed' };
  }

  const parsed = parseReceiptReply(reply);
  if (parsed.status !== 'ok') {
    console.error('Receipt extraction reply rejected:', receipt.id, parsed.status);
    await deps.store.save(userId, receipt.id, failedOutcome(model, { reply }));
    return { status: 'failed' };
  }

  const extractions = draftRows(parsed.draft);
  await deps.store.save(userId, receipt.id, {
    aiStatus: 'extracted',
    aiModel: model,
    aiConfidence: parsed.draft.confidence,
    rawOutput: { reply },
    extractions,
    audit: { action: 'receipt.extract', metadata: { status: 'extracted', fieldCount: extractions.length } },
  });
  return { status: 'extracted' };
}

// Query audit: both statements filter on receipts.id (primary key) and user_id from the session, with
// LIMIT 1. The transaction updates one receipt row and inserts at most five extraction rows plus one
// audit row; it never touches transactions. receipt_extractions has no index on receipt_id yet, but
// nothing here filters on it.
export const databaseExtractionStore: ExtractionStore = {
  async findReady(userId, id) {
    const [row] = await db
      .select({ id: receipts.id, fileKey: receipts.fileKey, mimeType: receipts.mimeType })
      .from(receipts)
      .where(and(eq(receipts.id, id), eq(receipts.userId, userId), eq(receipts.uploadStatus, 'ready'), isNull(receipts.deletedAt)))
      .limit(1);
    return row && { ...row, mimeType: row.mimeType as NewReceipt['mimeType'] };
  },
  async save(userId, id, outcome) {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(receipts)
        .set({ aiStatus: outcome.aiStatus, aiModel: outcome.aiModel, aiConfidence: outcome.aiConfidence, aiRawOutput: outcome.rawOutput })
        .where(and(eq(receipts.id, id), eq(receipts.userId, userId), isNull(receipts.deletedAt)))
        .returning({ id: receipts.id });
      if (updated.length === 0) throw new Error('Receipt vanished before the extraction was saved');
      if (outcome.extractions.length > 0) {
        await tx.insert(receiptExtractions).values(outcome.extractions.map((extraction) => ({ receiptId: id, ...extraction })));
      }
      await tx.insert(auditEvents).values({
        userId,
        actorType: 'ai_agent',
        action: outcome.audit.action,
        resourceType: 'receipt',
        resourceId: id,
        metadata: outcome.audit.metadata,
      });
    });
  },
};
