import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import reconcileRoute, { createReconcileHandler } from '../../bank/reconcile';
import type { AuthDeps } from '../auth';
import type { BankLineView, ReconcileOutcome, ReconcileStore } from '../bankReconcile';
import type { Entry, EntryStore } from '../entries';
import type { MatchableEntry } from '../../../src/lib/bankMatching';

const authDeps: AuthDeps = {
  issuer: { verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null), getEmail: async () => 'a@example.com' },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-02-10T12:00:00Z');
const LINE = id(1);
const OTHER_LINE = id(2);
const ENTRY = id(10);
const OTHER_ENTRY = id(11);
const DRAFT_ENTRY = id(12);
const CATEGORY = id(20);

interface FakeLine extends BankLineView {
  userId: string;
  status: 'unmatched' | 'matched' | 'dismissed';
  matchedEntryId: string | null;
  dismissedReason: string | null;
}
interface FakeEntry extends MatchableEntry {
  description: string;
  userId: string;
  status: 'draft' | 'confirmed' | 'reconciled' | 'voided';
}

describe('bank reconcile route', () => {
  let lines: FakeLine[];
  let entries: FakeEntry[];
  let audits: string[];
  let created: Array<{ userId: string; input: unknown }>;
  let voided: string[];

  const lineFor = (userId: string, lineId: string) => lines.find((line) => line.id === lineId && line.userId === userId);
  const entryFor = (userId: string, entryId: string) => entries.find((entry) => entry.id === entryId && entry.userId === userId);

  const store: ReconcileStore = {
    async listOpenLines(userId, limit) {
      return lines.filter((line) => line.userId === userId && line.status === 'unmatched').slice(0, limit);
    },
    async listConfirmedEntries(userId, _from, _to, limit) {
      return entries.filter((entry) => entry.userId === userId && entry.status === 'confirmed').slice(0, limit);
    },
    async getLine(userId, lineId) {
      return lineFor(userId, lineId);
    },
    async match(userId, lineId, entryId): Promise<ReconcileOutcome> {
      const line = lineFor(userId, lineId);
      if (!line) return 'LINE_NOT_FOUND';
      const entry = entryFor(userId, entryId);
      if (!entry) return 'ENTRY_NOT_FOUND';
      if (line.status !== 'unmatched') return 'LINE_NOT_OPEN';
      if (entry.status !== 'confirmed') return 'ENTRY_NOT_AVAILABLE';
      line.status = 'matched';
      line.matchedEntryId = entryId;
      entry.status = 'reconciled';
      audits.push(`${userId}:bank.match`);
      return 'ok';
    },
    async unmatch(userId, lineId) {
      const line = lineFor(userId, lineId);
      if (!line) return 'LINE_NOT_FOUND';
      if (line.status !== 'matched') return 'NOT_MATCHED';
      const entry = entryFor(userId, line.matchedEntryId ?? '');
      if (entry?.status === 'reconciled') entry.status = 'confirmed';
      line.status = 'unmatched';
      line.matchedEntryId = null;
      audits.push(`${userId}:bank.unmatch`);
      return 'ok';
    },
    async dismiss(userId, lineId, reason) {
      const line = lineFor(userId, lineId);
      if (!line) return 'LINE_NOT_FOUND';
      if (line.status !== 'unmatched') return 'LINE_NOT_OPEN';
      line.status = 'dismissed';
      line.dismissedReason = reason;
      audits.push(`${userId}:bank.dismiss`);
      return 'ok';
    },
    async undismiss(userId, lineId) {
      const line = lineFor(userId, lineId);
      if (!line) return 'LINE_NOT_FOUND';
      if (line.status !== 'dismissed') return 'NOT_DISMISSED';
      line.status = 'unmatched';
      line.dismissedReason = null;
      audits.push(`${userId}:bank.undismiss`);
      return 'ok';
    },
    async linkDraft(userId, lineId, entryId) {
      const line = lineFor(userId, lineId);
      if (!line) return 'LINE_NOT_FOUND';
      if (line.status !== 'unmatched') return 'LINE_NOT_OPEN';
      line.status = 'matched';
      line.matchedEntryId = entryId;
      audits.push(`${userId}:bank.create_entry`);
      return 'ok';
    },
  };

  const entryStore: Pick<EntryStore, 'loadPostingContext' | 'isDateLocked' | 'create' | 'void'> = {
    async loadPostingContext() {
      return {
        category: { accountType: 'expense' as const, archivedAt: null },
        hasVatNumber: true,
        bankAccountId: id(900),
        vatControlAccountId: id(901),
        debtorsAccountId: id(902),
      };
    },
    async isDateLocked() {
      return false;
    },
    async create(userId, header, postedLines) {
      created.push({ userId, input: header });
      return { id: DRAFT_ENTRY, ...header, source: 'manual', lines: postedLines } satisfies Entry;
    },
    async void(_userId, entryId) {
      voided.push(entryId);
      return true;
    },
  };

  const handler = createReconcileHandler(store, entryStore as EntryStore, authDeps, () => NOW);
  const call = (method: string, body?: unknown, userId?: string, rawBody?: string) =>
    handler(
      new Request('https://app.test/api/bank/reconcile', {
        method,
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      }),
    );

  beforeEach(() => {
    lines = [
      { id: LINE, userId: 'owner', date: '2026-02-05', amountPence: -2400, description: 'COFFEE SUPPLIER', status: 'unmatched', matchedEntryId: null, dismissedReason: null },
      { id: OTHER_LINE, userId: 'rival', date: '2026-02-05', amountPence: -2400, description: 'RIVAL LINE', status: 'unmatched', matchedEntryId: null, dismissedReason: null },
    ];
    entries = [
      { id: ENTRY, userId: 'owner', date: '2026-02-05', description: 'Printer paper', grossPence: -2400, status: 'confirmed' },
      { id: OTHER_ENTRY, userId: 'rival', date: '2026-02-05', description: 'Rival', grossPence: -2400, status: 'confirmed' },
    ];
    audits = [];
    created = [];
    voided = [];
  });

  it('default-exports a fetch handler', () => {
    expect(typeof reconcileRoute.fetch).toBe('function');
  });

  it('refuses unauthenticated requests', async () => {
    expect((await call('GET')).status).toBe(401);
    expect((await call('POST', { action: 'unmatch', lineId: LINE })).status).toBe(401);
  });

  it('refuses other methods', async () => {
    expect((await call('DELETE', undefined, 'owner')).status).toBe(405);
  });

  it('proposes matches for only the session owner', async () => {
    const body = await (await call('GET', undefined, 'owner')).json();
    expect(body.lines.map((line: { id: string }) => line.id)).toEqual([LINE]);
    expect(body.proposals).toEqual([{ lineId: LINE, entryId: ENTRY, kind: 'exact', entryDescription: 'Printer paper', entryDate: '2026-02-05' }]);
  });

  it('match marks the line matched and the entry reconciled, with one audit event', async () => {
    const response = await call('POST', { action: 'match', lineId: LINE, entryId: ENTRY }, 'owner');
    expect(response.status).toBe(200);
    expect(lines[0].status).toBe('matched');
    expect(entries[0].status).toBe('reconciled');
    expect(audits).toEqual(['owner:bank.match']);
  });

  it('refuses to match a line that is already matched', async () => {
    await call('POST', { action: 'match', lineId: LINE, entryId: ENTRY }, 'owner');
    entries.push({ id: id(13), userId: 'owner', date: '2026-02-05', description: 'Paper', grossPence: -2400, status: 'confirmed' });
    const response = await call('POST', { action: 'match', lineId: LINE, entryId: id(13) }, 'owner');
    expect(response.status).toBe(409);
    expect(audits).toHaveLength(1);
  });

  it('refuses to match an entry that is already reconciled or voided', async () => {
    entries[0].status = 'reconciled';
    expect((await call('POST', { action: 'match', lineId: LINE, entryId: ENTRY }, 'owner')).status).toBe(409);
    entries[0].status = 'voided';
    expect((await call('POST', { action: 'match', lineId: LINE, entryId: ENTRY }, 'owner')).status).toBe(409);
    expect(lines[0].status).toBe('unmatched');
  });

  it('unmatch returns the line to unmatched and the entry to confirmed', async () => {
    await call('POST', { action: 'match', lineId: LINE, entryId: ENTRY }, 'owner');
    const response = await call('POST', { action: 'unmatch', lineId: LINE }, 'owner');
    expect(response.status).toBe(200);
    expect(lines[0].status).toBe('unmatched');
    expect(entries[0].status).toBe('confirmed');
    expect(audits).toEqual(['owner:bank.match', 'owner:bank.unmatch']);
  });

  it('refuses to unmatch a line that is not matched', async () => {
    expect((await call('POST', { action: 'unmatch', lineId: LINE }, 'owner')).status).toBe(409);
  });

  it('dismiss stores the reason and undismiss clears it', async () => {
    expect((await call('POST', { action: 'dismiss', lineId: LINE, reason: 'Personal spending' }, 'owner')).status).toBe(200);
    expect(lines[0]).toMatchObject({ status: 'dismissed', dismissedReason: 'Personal spending' });
    expect((await call('POST', { action: 'undismiss', lineId: LINE }, 'owner')).status).toBe(200);
    expect(lines[0]).toMatchObject({ status: 'unmatched', dismissedReason: null });
    expect(audits).toEqual(['owner:bank.dismiss', 'owner:bank.undismiss']);
  });

  it('createEntry makes a draft linked to the line', async () => {
    const response = await call('POST', { action: 'createEntry', lineId: LINE, categoryAccountId: CATEGORY, vatRatePercent: 20 }, 'owner');
    expect(response.status).toBe(200);
    expect(created).toHaveLength(1);
    expect(created[0].input).toMatchObject({ status: 'draft', date: '2026-02-05', description: 'COFFEE SUPPLIER' });
    expect(lines[0]).toMatchObject({ status: 'matched', matchedEntryId: DRAFT_ENTRY });
    expect(audits).toEqual(['owner:bank.create_entry']);
  });

  it('createEntry on an already matched line creates nothing', async () => {
    lines[0].status = 'matched';
    const response = await call('POST', { action: 'createEntry', lineId: LINE, categoryAccountId: CATEGORY }, 'owner');
    expect(response.status).toBe(409);
    expect(created).toHaveLength(0);
  });

  it('createEntry voids the draft when the line was taken in the meantime', async () => {
    const racing = { ...store, linkDraft: async () => 'LINE_NOT_OPEN' as const };
    const racingHandler = createReconcileHandler(racing, entryStore as EntryStore, authDeps, () => NOW);
    const response = await racingHandler(
      new Request('https://app.test/api/bank/reconcile', {
        method: 'POST',
        headers: { cookie: 'stf_session=tok-owner' },
        body: JSON.stringify({ action: 'createEntry', lineId: LINE, categoryAccountId: CATEGORY }),
      }),
    );
    expect(response.status).toBe(409);
    expect(voided).toEqual([DRAFT_ENTRY]);
  });

  it.each([
    ['match', { action: 'match', lineId: LINE, entryId: ENTRY }],
    ['unmatch', { action: 'unmatch', lineId: LINE }],
    ['dismiss', { action: 'dismiss', lineId: LINE, reason: 'x' }],
    ['undismiss', { action: 'undismiss', lineId: LINE }],
    ['createEntry', { action: 'createEntry', lineId: LINE, categoryAccountId: CATEGORY }],
  ])("refuses another owner's line on %s with 404", async (_name, body) => {
    lines[0].status = 'matched';
    const response = await call('POST', body, 'rival');
    expect(response.status).toBe(404);
    expect(lines[0].status).toBe('matched');
    expect(audits).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it("refuses another owner's entry on match with 404", async () => {
    const response = await call('POST', { action: 'match', lineId: OTHER_LINE, entryId: ENTRY }, 'rival');
    expect(response.status).toBe(404);
    expect(entries[0].status).toBe('confirmed');
  });

  it.each([
    ['unknown action', { action: 'delete', lineId: LINE }],
    ['non-uuid line', { action: 'unmatch', lineId: 'abc' }],
    ['missing entry', { action: 'match', lineId: LINE }],
    ['empty reason', { action: 'dismiss', lineId: LINE, reason: '   ' }],
    ['long reason', { action: 'dismiss', lineId: LINE, reason: 'x'.repeat(201) }],
    ['control characters in reason', { action: 'dismiss', lineId: LINE, reason: 'a\u0000b' }],
    ['bad vat rate', { action: 'createEntry', lineId: LINE, categoryAccountId: CATEGORY, vatRatePercent: 17 }],
    ['client-supplied owner id is not a field', null],
  ])('refuses a bad body: %s', async (_name, body) => {
    const response = await call('POST', body, 'owner');
    expect(response.status).toBe(400);
    expect(audits).toEqual([]);
  });

  it('refuses a body that is not JSON', async () => {
    expect((await call('POST', undefined, 'owner', '{nope')).status).toBe(400);
  });
});
