import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { categoriseLines, type CategoriseOutcome, type CategoriseStore } from '../bankCategorise';
import type { ModelClient } from '../receiptExtraction';

const LINE_A = '11111111-1111-4111-8111-111111111111';
const LINE_B = '22222222-2222-4222-8222-222222222222';
const TRAVEL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FOREIGN_ACCOUNT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function setup(reply: string | Error, env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'sk-ant-test', RECEIPT_AI_ENABLED: 'true' }) {
  const saved: CategoriseOutcome[] = [];
  const store: CategoriseStore = {
    findLines: async (userId, ids) =>
      ids.filter((id) => userId === 'owner_a' && id === LINE_A).map((id) => ({ id, description: 'INVENTED TRAIN CO', amountPence: -1250, date: '2026-10-30' })),
    listAccounts: async () => [{ id: TRAVEL, code: '7400', name: 'Travel' }],
    countRecent: async () => 0,
    save: async (_userId, outcome) => {
      saved.push(outcome);
    },
  };
  const create = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return { content: [{ type: 'text', text: reply }] };
  });
  const client = { messages: { create } } as unknown as ModelClient;
  const run = (userId: string, ids: string[]) => categoriseLines({ store, client, now: () => new Date('2026-11-02T10:00:00Z'), env }, userId, ids);
  return { run, saved, create };
}

const goodReply = JSON.stringify({ suggestions: [{ ref: 1, accountId: TRAVEL, confidence: 82 }] });

describe('categoriseLines', () => {
  it('stores the suggested account and confidence as a draft', async () => {
    const { run, saved } = setup(goodReply);
    const result = await run('owner_a', [LINE_A]);
    expect(result).toEqual({ status: 'suggested', suggestions: [{ lineId: LINE_A, accountId: TRAVEL, confidence: 82 }] });
    expect(saved).toHaveLength(1);
    expect(saved[0].suggestions).toEqual([{ lineId: LINE_A, accountId: TRAVEL, confidence: 82 }]);
    expect(saved[0].audit).toEqual({ status: 'suggested', lineCount: 1, suggestedCount: 1 });
  });

  it('makes no model call when the kill switch is off', async () => {
    const { run, create, saved } = setup(goodReply, { ANTHROPIC_API_KEY: 'sk-ant-test', RECEIPT_AI_ENABLED: 'false' });
    expect(await run('owner_a', [LINE_A])).toEqual({ status: 'skipped', suggestions: [] });
    expect(create).not.toHaveBeenCalled();
    expect(saved[0].audit.status).toBe('skipped');
  });

  it('makes no model call without an API key', async () => {
    const { run, create } = setup(goodReply, {});
    expect((await run('owner_a', [LINE_A])).status).toBe('skipped');
    expect(create).not.toHaveBeenCalled();
  });

  it('drops an account id that is not in the owner list', async () => {
    const { run, saved } = setup(JSON.stringify({ suggestions: [{ ref: 1, accountId: FOREIGN_ACCOUNT, confidence: 90 }] }));
    expect(await run('owner_a', [LINE_A])).toEqual({ status: 'suggested', suggestions: [] });
    expect(saved[0].suggestions).toEqual([]);
  });

  it('clamps confidence to an integer from 0 to 100', async () => {
    const { run } = setup(JSON.stringify({ suggestions: [{ ref: 1, accountId: TRAVEL, confidence: 140.6 }] }));
    expect((await run('owner_a', [LINE_A])).suggestions[0].confidence).toBe(100);
  });

  it("returns not_found for another user's line and never calls the model", async () => {
    const { run, create, saved } = setup(goodReply);
    expect(await run('owner_b', [LINE_A])).toEqual({ status: 'not_found', suggestions: [] });
    expect(create).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it('returns not_found when any requested line is not the owner own', async () => {
    const { run, create } = setup(goodReply);
    expect((await run('owner_a', [LINE_A, LINE_B])).status).toBe('not_found');
    expect(create).not.toHaveBeenCalled();
  });

  it('leaves lines unchanged and reports failed when the call throws', async () => {
    const { run, saved } = setup(new Error('network down'));
    expect(await run('owner_a', [LINE_A])).toEqual({ status: 'failed', suggestions: [] });
    expect(saved[0].suggestions).toEqual([]);
    expect(saved[0].audit.status).toBe('failed');
  });

  it('reports failed when the reply is not the expected shape', async () => {
    const { run, saved } = setup('sure, here you go');
    expect((await run('owner_a', [LINE_A])).status).toBe('failed');
    expect(saved[0].suggestions).toEqual([]);
  });

  it('refuses when the hourly limit is reached, without a call', async () => {
    const { create } = setup(goodReply);
    const store: CategoriseStore = {
      findLines: async () => [],
      listAccounts: async () => [],
      countRecent: async () => 20,
      save: async () => {},
    };
    const result = await categoriseLines(
      { store, client: { messages: { create } } as unknown as ModelClient, now: () => new Date(), env: { ANTHROPIC_API_KEY: 'k' } },
      'owner_a',
      [LINE_A],
    );
    expect(result.status).toBe('rate_limited');
    expect(create).not.toHaveBeenCalled();
  });

  it('does not put audit text or descriptions in the audit record', async () => {
    const { run, saved } = setup(goodReply);
    await run('owner_a', [LINE_A]);
    expect(JSON.stringify(saved[0].audit)).not.toContain('TRAIN');
  });
});
