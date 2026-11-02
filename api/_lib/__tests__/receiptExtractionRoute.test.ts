import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createReceiptExtractHandler } from '../../receipt-extract';
import type { AuthDeps } from '../auth';
import type { ExtractionOutcome, ExtractionStore, ModelClient } from '../receiptExtraction';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const FILE_KEY = 'owner_a/secret-file-key';
const RAW_REPLY = JSON.stringify({
  date: { value: '2026-10-30', confidence: 0.95 },
  vendor: { value: 'Invented Cafe Ltd', confidence: 0.9 },
  totalPence: { value: 2399, confidence: 0.99 },
  vatPence: null,
  category: null,
  currency: 'GBP',
  confidence: 0.87,
  notes: null,
});

function setup() {
  const saved: ExtractionOutcome[] = [];
  const store: ExtractionStore = {
    findReady: async (userId, id) => (userId === 'owner_a' && id === RECEIPT_ID ? { id, fileKey: FILE_KEY, mimeType: 'image/png', alreadyExtracted: saved.length > 0 } : undefined),
    countRecent: async () => 0,
    save: async (_userId, _id, outcome) => {
      saved.push(outcome);
    },
  };
  const client: ModelClient = { messages: { create: vi.fn(async () => ({ content: [{ type: 'text', text: RAW_REPLY }] })) } };
  const handler = createReceiptExtractHandler(
    {
      store,
      storage: { getObject: async () => new Uint8Array([1, 2, 3]) },
      client,
      now: () => new Date('2026-11-02T10:00:00Z'),
      env: { ANTHROPIC_API_KEY: 'sk-ant-test', RECEIPT_AI_ENABLED: 'true' },
    },
    authDeps,
  );
  const call = (method: string, user?: string, body?: unknown) =>
    handler(
      new Request('https://app.test/api/receipt-extract', {
        method,
        headers: user ? { cookie: `stf_session=tok-${user}`, 'content-type': 'application/json' } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { call, saved, client };
}

describe('receipt extraction route', () => {
  it('refuses a request without a session and does not call the model', async () => {
    const { call, client } = setup();
    expect((await call('POST', undefined, { id: RECEIPT_ID })).status).toBe(401);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('accepts only POST', async () => {
    const { call } = setup();
    expect((await call('GET', 'owner_a')).status).toBe(405);
  });

  it('refuses a malformed id', async () => {
    const { call } = setup();
    expect((await call('POST', 'owner_a', { id: 'nope' })).status).toBe(400);
  });

  it("gives a second user 404 for the first user's receipt id and never calls the model", async () => {
    const { call, saved, client } = setup();
    expect((await call('POST', 'owner_b', { id: RECEIPT_ID })).status).toBe(404);
    expect(saved).toEqual([]);
    expect(client.messages.create).not.toHaveBeenCalled();
  });

  it('returns the drafts and status without the file key or raw reply', async () => {
    const { call, saved } = setup();
    const response = await call('POST', 'owner_a', { id: RECEIPT_ID });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/file-key|fileKey|file_key|rawOutput|ai_raw_output|"notes"/);
    expect(JSON.parse(text).receipt).toEqual({
      id: RECEIPT_ID,
      aiStatus: 'extracted',
      drafts: [
        { field: 'date', suggestedValue: '2026-10-30', confidence: 950 },
        { field: 'vendor', suggestedValue: 'Invented Cafe Ltd', confidence: 900 },
        { field: 'totalPence', suggestedValue: '2399', confidence: 990 },
      ],
    });
    expect(saved).toHaveLength(1);
  });

  it('answers a second call for the same receipt from the stored result with no second model call', async () => {
    const { call, saved, client } = setup();
    await call('POST', 'owner_a', { id: RECEIPT_ID });
    const second = await call('POST', 'owner_a', { id: RECEIPT_ID });
    expect(second.status).toBe(200);
    expect((await second.json()).receipt).toEqual({ id: RECEIPT_ID, aiStatus: 'extracted', drafts: [] });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
  });
});
