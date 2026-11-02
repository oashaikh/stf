import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createBankCategoriseHandler } from '../../bank/categorise';
import type { AuthDeps } from '../auth';
import type { CategoriseStore } from '../bankCategorise';
import type { ModelClient } from '../receiptExtraction';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const LINE = '11111111-1111-4111-8111-111111111111';
const TRAVEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function setup(enabled = 'true') {
  const save = vi.fn(async () => {});
  const store: CategoriseStore = {
    findLines: async (userId, ids) => ids.filter((id) => userId === 'owner_a' && id === LINE).map((id) => ({ id, description: 'INVENTED CAFE', amountPence: -450, date: '2026-10-30' })),
    listAccounts: async () => [{ id: TRAVEL, code: '7400', name: 'Travel' }],
    countRecent: async () => 0,
    save,
  };
  const create = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify({ suggestions: [{ ref: 1, accountId: TRAVEL, confidence: 70 }] }) }] }));
  const handler = createBankCategoriseHandler(
    { store, client: { messages: { create } } as unknown as ModelClient, now: () => new Date('2026-11-02T10:00:00Z'), env: { ANTHROPIC_API_KEY: 'k', RECEIPT_AI_ENABLED: enabled } },
    authDeps,
  );
  const call = (method: string, user?: string, body?: unknown) =>
    handler(
      new Request('https://app.test/api/bank/categorise', {
        method,
        headers: user ? { cookie: `stf_session=tok-${user}`, 'content-type': 'application/json' } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { call, create, save };
}

describe('bank categorise route', () => {
  it('refuses a request without a session', async () => {
    const { call, create } = setup();
    expect((await call('POST', undefined, { lineIds: [LINE] })).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts only POST', async () => {
    expect((await setup().call('GET', 'owner_a')).status).toBe(405);
  });

  it.each([{}, { lineIds: [] }, { lineIds: ['nope'] }, { lineIds: Array(26).fill(LINE) }, { lineIds: [LINE, LINE] }])('rejects the bad body %j with 400', async (body) => {
    const { call, create } = setup();
    expect((await call('POST', 'owner_a', body)).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("gives a second user 404 for the first user's line and never calls the model", async () => {
    const { call, create, save } = setup();
    expect((await call('POST', 'owner_b', { lineIds: [LINE] })).status).toBe(404);
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('returns suggestions only, with no description text', async () => {
    const { call } = setup();
    const response = await call('POST', 'owner_a', { lineIds: [LINE] });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ ok: true, status: 'suggested', suggestions: [{ lineId: LINE, accountId: TRAVEL, confidence: 70 }] });
    expect(text).not.toContain('CAFE');
  });

  it('says suggestions are off and makes no call when the kill switch is off', async () => {
    const { call, create } = setup('false');
    const response = await call('POST', 'owner_a', { lineIds: [LINE] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: 'skipped' });
    expect(create).not.toHaveBeenCalled();
  });
});
