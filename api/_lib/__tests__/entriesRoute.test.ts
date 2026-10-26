import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createEntriesHandler } from '../../entries';
import type { AuthDeps } from '../auth';
import type { Entry, EntryStore, PostingContext } from '../entries';
import { getReturnReview, type DrillLine, type VatReturnStore } from '../vatReturns';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-02-10T12:00:00Z');
const BANK = id(900);
const VAT = id(901);
const DEBTORS = id(902);
const SALES = id(1);
const TRAVEL = id(2);
const ARCHIVED = id(3);
const OTHER_OWNERS = id(4);

describe('entries route', () => {
  let saved: Array<Entry & { userId: string; voidedAt?: Date }>;
  let lockedPeriods: Array<{ start: string; end: string }>;
  let audits: string[];
  const accountTypes: Record<string, 'income' | 'expense'> = { [SALES]: 'income', [TRAVEL]: 'expense', [ARCHIVED]: 'expense', [OTHER_OWNERS]: 'expense' };
  const store: EntryStore = {
    async loadPostingContext(_userId, categoryAccountId): Promise<PostingContext> {
      const owned = categoryAccountId !== OTHER_OWNERS; // that account belongs to a different owner
      const known = owned && categoryAccountId in accountTypes;
      return {
        category: known ? { accountType: accountTypes[categoryAccountId], archivedAt: categoryAccountId === ARCHIVED ? new Date() : null } : undefined,
        hasVatNumber: true,
        bankAccountId: BANK,
        vatControlAccountId: VAT,
        debtorsAccountId: DEBTORS,
      };
    },
    async create(userId, header, lines) {
      const entry: Entry = { id: id(100 + saved.length), ...header, source: 'manual', lines };
      saved.push({ ...entry, userId });
      audits.push(`${userId}:entry.create`);
      return entry;
    },
    async get(userId, entryId) {
      return saved.find((entry) => entry.userId === userId && entry.id === entryId && !entry.voidedAt);
    },
    async list() {
      return [];
    },
    async isDateLocked(_userId, date) {
      return lockedPeriods.some((period) => date >= period.start && date <= period.end);
    },
    async replace(userId, entryId, header, lines) {
      const old = saved.find((entry) => entry.userId === userId && entry.id === entryId && !entry.voidedAt);
      if (!old) return undefined;
      old.voidedAt = NOW;
      const entry: Entry = { id: id(100 + saved.length), ...header, source: 'manual', lines };
      saved.push({ ...entry, userId });
      audits.push(`${userId}:entry.edit:${old.id}->${entry.id}`);
      return entry;
    },
    async void(userId, entryId) {
      const old = saved.find((entry) => entry.userId === userId && entry.id === entryId && !entry.voidedAt);
      if (!old) return false;
      old.voidedAt = NOW;
      audits.push(`${userId}:entry.void`);
      return true;
    },
    async confirm(userId, entryId) {
      const found = saved.find((entry) => entry.userId === userId && entry.id === entryId && !entry.voidedAt && entry.status === 'draft');
      if (!found) return undefined;
      found.status = 'confirmed';
      audits.push(`${userId}:entry.confirm`);
      return found;
    },
  };
  const call = (method: string, body?: unknown, userId?: string, query = '') =>
    createEntriesHandler(store, authDeps, () => NOW)(
      new Request(`https://app.test/api/entries${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: userId ? { cookie: `stf_session=tok-${userId}` } : {},
      }),
    );
  const valid = { date: '2026-02-01', description: 'Train to client', kind: 'expense', categoryAccountId: TRAVEL, amountPence: 12000, amountIs: 'gross', vatRatePercent: 20 };

  beforeEach(() => {
    saved = [];
    audits = [];
    lockedPeriods = [];
  });

  it('creates a confirmed manual entry with lines built by the posting rules', async () => {
    const response = await call('POST', valid, 'owner');
    expect(response.status).toBe(200);
    const { entry } = await response.json();
    expect(entry.status).toBe('confirmed');
    expect(entry.source).toBe('manual');
    expect(entry.lines.map((l: { amountPence: number }) => l.amountPence)).toEqual([10000, 2000, -12000]);
    expect(audits).toEqual(['owner:entry.create']);
  });

  it('keeps a draft as a draft', async () => {
    const { entry } = await (await call('POST', { ...valid, status: 'draft' }, 'owner')).json();
    expect(entry.status).toBe('draft');
  });

  it('fetches an entry with its lines, only for its owner', async () => {
    const { entry } = await (await call('POST', valid, 'owner')).json();
    const found = await call('GET', undefined, 'owner', `?id=${entry.id}`);
    expect((await found.json()).entry.lines).toHaveLength(3);
    expect((await call('GET', undefined, 'intruder', `?id=${entry.id}`)).status).toBe(404);
  });

  it('refuses another owner account, an archived account and a kind mismatch', async () => {
    for (const categoryAccountId of [OTHER_OWNERS, ARCHIVED, SALES, id(77)]) {
      const response = await call('POST', { ...valid, categoryAccountId }, 'owner');
      expect(response.status, categoryAccountId).toBe(422);
      expect((await response.json()).code).toBe('INVALID_ACCOUNT');
    }
    expect(saved).toHaveLength(0);
  });

  it.each([
    ['float', { amountPence: 10.5 }],
    ['negative', { amountPence: -100 }],
    ['zero', { amountPence: 0 }],
    ['over the limit', { amountPence: 1_000_000_001 }],
    ['string amount', { amountPence: '100' }],
    ['bad vat rate', { vatRatePercent: 17 }],
    ['bad date', { date: '2026-02-30' }],
    ['far future date', { date: '2026-06-01' }],
    ['empty description', { description: '' }],
    ['long description', { description: 'x'.repeat(201) }],
    ['bad status', { status: 'reconciled' }],
  ])('refuses a %s', async (_name, change) => {
    const response = await call('POST', { ...valid, ...change }, 'owner');
    expect(response.status).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it('refuses unauthenticated requests', async () => {
    expect((await call('POST', valid)).status).toBe(401);
    expect((await call('GET', undefined, undefined, `?id=${id(5)}`)).status).toBe(401);
  });

  it('refuses a malformed id on read', async () => {
    expect((await call('GET', undefined, 'owner', '?id=nope')).status).toBe(400);
  });

  describe('effect on the VAT return review', () => {
    const period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };
    const vatStore: VatReturnStore = {
      loadLedgerLines: async (userId: string) =>
        saved
          .filter((entry) => entry.userId === userId)
          .flatMap((entry) =>
            entry.lines.map((line, index): DrillLine => ({
              lineId: `${entry.id}-${index}`,
              date: entry.date,
              accountType: line.accountId === BANK || line.accountId === VAT ? 'asset' : accountTypes[line.accountId],
              amountPence: line.amountPence,
              vatPence: line.vatPence,
              status: entry.status,
              deletedAt: entry.voidedAt ? entry.voidedAt.toISOString() : null,
              description: entry.description,
            })),
          ),
      findDraft: async () => undefined,
      findSubmission: async () => undefined,
    } as unknown as VatReturnStore;

    it('counts a confirmed entry but not a draft', async () => {
      await call('POST', { ...valid, status: 'draft' }, 'owner');
      expect((await getReturnReview(vatStore, 'owner', period)).boxes.box4).toBe(0);
      await call('POST', valid, 'owner');
      const { boxes } = await getReturnReview(vatStore, 'owner', period);
      expect(boxes.box4).toBe(2000);
      expect(boxes.box7).toBe(10000);
    });
  });

  describe('edit, void, confirm and the period lock', () => {
    const q = (entryId: string) => `?id=${entryId}`;
    const create = async (body: object = valid) => (await (await call('POST', body, 'owner')).json()).entry as Entry;
    const period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };
    const boxesFor = async () => {
      const vatStore = {
        loadLedgerLines: async () =>
          saved.flatMap((entry) =>
            entry.lines.map((line, index): DrillLine => ({
              lineId: `${entry.id}-${index}`,
              date: entry.date,
              accountType: line.accountId === BANK || line.accountId === VAT ? 'asset' : accountTypes[line.accountId],
              amountPence: line.amountPence,
              vatPence: line.vatPence,
              status: entry.status,
              deletedAt: entry.voidedAt ? entry.voidedAt.toISOString() : null,
              description: entry.description,
            })),
          ),
        findDraft: async () => undefined,
        findSubmission: async () => undefined,
      } as unknown as VatReturnStore;
      return (await getReturnReview(vatStore, 'owner', period)).boxes;
    };

    it('edit voids the old entry and the VAT boxes reflect only the replacement', async () => {
      const original = await create();
      const response = await call('PUT', { ...valid, amountPence: 6000 }, 'owner', q(original.id));
      expect(response.status).toBe(200);
      const { entry } = await response.json();
      expect(entry.id).not.toBe(original.id);
      expect(saved.find((row) => row.id === original.id)?.voidedAt).toBeDefined();
      expect(saved.find((row) => row.id === entry.id)?.status).toBe('confirmed');
      expect((await boxesFor()).box4).toBe(1000);
      expect(audits).toEqual(['owner:entry.create', `owner:entry.edit:${original.id}->${entry.id}`]);
    });

    it('void removes the entry from the VAT boxes and audits it', async () => {
      const original = await create();
      expect((await boxesFor()).box4).toBe(2000);
      expect((await call('DELETE', undefined, 'owner', q(original.id))).status).toBe(200);
      expect((await boxesFor()).box4).toBe(0);
      expect(audits).toEqual(['owner:entry.create', 'owner:entry.void']);
      expect((await call('GET', undefined, 'owner', q(original.id))).status).toBe(404);
    });

    it('confirms a draft once, with an audit event', async () => {
      const draft = await create({ ...valid, status: 'draft' });
      const response = await call('PATCH', { status: 'confirmed' }, 'owner', q(draft.id));
      expect((await response.json()).entry.status).toBe('confirmed');
      expect(audits).toEqual(['owner:entry.create', 'owner:entry.confirm']);
      const again = await call('PATCH', { status: 'confirmed' }, 'owner', q(draft.id));
      expect(again.status).toBe(409);
      expect((await again.json()).code).toBe('NOT_DRAFT');
    });

    it('refuses to create, edit, void or confirm inside a locked period, and again for a new date', async () => {
      const outside = await create({ ...valid, date: '2026-02-05' });
      const draft = await create({ ...valid, date: '2026-02-06', status: 'draft' });
      const inside = await create({ ...valid, date: '2026-01-15' });
      const saveCount = saved.length;
      lockedPeriods = [{ start: '2026-01-01', end: '2026-01-31' }];
      const intoLocked = { ...valid, date: '2026-01-20' };

      const attempts = [
        await call('POST', intoLocked, 'owner'),
        await call('PUT', valid, 'owner', q(inside.id)),
        await call('DELETE', undefined, 'owner', q(inside.id)),
        await call('PUT', intoLocked, 'owner', q(outside.id)), // moving a date into the locked period
        await call('PATCH', { status: 'confirmed' }, 'owner', q(inside.id)),
      ];
      for (const response of attempts) {
        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.code).toBe('PERIOD_LOCKED');
        expect(body.error).toMatch(/reopen the return first/i);
      }
      expect(saved).toHaveLength(saveCount);
      expect(saved.every((row) => !row.voidedAt)).toBe(true);
      expect((await call('PATCH', { status: 'confirmed' }, 'owner', q(draft.id))).status).toBe(200);
    });

    it('refuses another owner, a missing entry and bad input', async () => {
      const original = await create();
      for (const method of ['PUT', 'DELETE', 'PATCH']) {
        const body = method === 'PUT' ? valid : method === 'PATCH' ? { status: 'confirmed' } : undefined;
        expect((await call(method, body, 'intruder', q(original.id))).status, method).toBe(404);
        expect((await call(method, body, 'owner', q(id(999)))).status, method).toBe(404);
        expect((await call(method, body, 'owner', '?id=nope')).status, method).toBe(400);
        expect((await call(method, body, undefined, q(original.id))).status, method).toBe(401);
      }
      expect((await call('PUT', { ...valid, amountPence: -1 }, 'owner', q(original.id))).status).toBe(400);
      expect((await call('PATCH', { status: 'draft' }, 'owner', q(original.id))).status).toBe(400);
      expect(saved.every((row) => !row.voidedAt)).toBe(true);
    });
  });
});
