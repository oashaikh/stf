import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entry, EntryStore, PostingContext } from '../entries.js';
import { RECURRING_LIST_LIMIT, createTemplate, generateDueEntries, listTemplates, type DueTemplate, type RecurringStore } from '../recurringEntries.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER = id(500);
const BANK = id(900);
const VAT = id(901);
const DEBTORS = id(902);
const TRAVEL = id(2);
const NOW = new Date('2026-10-27T03:00:00Z');

function fakes() {
  const entries: Array<Entry & { userId: string }> = [];
  const runs: Array<{ templateId: string; runDate: string; transactionId: string }> = [];
  const templates: Array<DueTemplate & { paused: boolean }> = [];
  let locked: [string, string] | undefined;
  const entryStore: Pick<EntryStore, 'loadPostingContext' | 'create' | 'isDateLocked' | 'void'> = {
    async loadPostingContext(): Promise<PostingContext> {
      return { category: { accountType: 'expense', archivedAt: null }, hasVatNumber: true, bankAccountId: BANK, vatControlAccountId: VAT, debtorsAccountId: DEBTORS };
    },
    async create(userId, header, lines) {
      const entry: Entry = { id: id(100 + entries.length), ...header, source: 'manual', lines };
      entries.push({ ...entry, userId });
      return entry;
    },
    async isDateLocked(_userId, date) {
      return locked !== undefined && date >= locked[0] && date <= locked[1];
    },
    async void(_userId, entryId) {
      entries.splice(entries.findIndex((entry) => entry.id === entryId), 1);
      return true;
    },
  };
  const store: RecurringStore = {
    async due(today, limit) {
      return templates.filter((template) => !template.paused && template.nextDate <= today).slice(0, limit);
    },
    async recordRun(template, runDate, transactionId, nextDate) {
      if (runs.some((run) => run.templateId === template.id && run.runDate === runDate)) return false;
      runs.push({ templateId: template.id, runDate, transactionId });
      template.nextDate = nextDate;
      return true;
    },
    async hasRun(templateId, runDate) {
      return runs.some((run) => run.templateId === templateId && run.runDate === runDate);
    },
    async list(userId, limit) {
      return templates.filter((template) => template.userId === userId).slice(0, limit) as never;
    },
    async create() {
      throw new Error('unused');
    },
    async update() {
      throw new Error('unused');
    },
    async softDelete() {
      throw new Error('unused');
    },
    async ownsCategory() {
      return true;
    },
  };
  const add = (overrides: Partial<DueTemplate & { paused: boolean }> = {}) => {
    const template = { id: id(10 + templates.length), userId: USER, kind: 'expense', categoryAccountId: TRAVEL, amountPence: 12000, amountIs: 'gross', vatRatePercent: 20, description: 'Rent', schedule: 'monthly', anchorDay: 1, nextDate: '2026-10-01', paused: false, ...overrides } as DueTemplate & { paused: boolean };
    templates.push(template);
    return template;
  };
  return { entries, runs, templates, entryStore, store, add, lock: (from: string, to: string) => (locked = [from, to]) };
}

describe('generateDueEntries', () => {
  let f: ReturnType<typeof fakes>;
  beforeEach(() => {
    f = fakes();
  });

  it('creates drafts only', async () => {
    f.add();
    await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    expect(f.entries).toHaveLength(1);
    expect(f.entries.every((entry) => entry.status === 'draft')).toBe(true);
    expect(f.runs).toHaveLength(1);
  });

  it('creates once when run twice', async () => {
    f.add();
    await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    expect(f.entries).toHaveLength(1);
  });

  it('voids its draft when another run claims the date first', async () => {
    f.add();
    f.store.recordRun = async () => false;
    await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    expect(f.entries).toHaveLength(0);
  });

  it('skips a date that already has a run', async () => {
    const template = f.add();
    f.runs.push({ templateId: template.id, runDate: '2026-10-01', transactionId: id(1) });
    await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    expect(f.entries).toHaveLength(0);
  });

  it('keeps month-end days across short months', async () => {
    const template = f.add({ nextDate: '2026-08-31', anchorDay: 31 });
    await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    expect(f.entries.map((entry) => entry.date)).toEqual(['2026-08-31', '2026-09-30']);
    expect(template.nextDate).toBe('2026-10-31');
  });

  it('skips paused templates', async () => {
    f.add({ paused: true });
    await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    expect(f.entries).toHaveLength(0);
  });

  it('leaves a template in a locked period unchanged and still runs the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stuck = f.add({ nextDate: '2026-09-15' });
    const open = f.add({ nextDate: '2026-10-05', anchorDay: 5 });
    f.lock('2026-09-01', '2026-09-30');
    const result = await generateDueEntries(f.store, f.entryStore as EntryStore, NOW);
    expect(stuck.nextDate).toBe('2026-09-15');
    expect(open.nextDate).toBe('2026-11-05');
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(warn.mock.calls.flat().join(' ')).toContain(stuck.id);
    warn.mockRestore();
  });
});

describe('listTemplates', () => {
  it('asks the store for a bounded page', async () => {
    const f = fakes();
    const spy = vi.spyOn(f.store, 'list');
    await listTemplates(f.store, USER);
    expect(spy).toHaveBeenCalledWith(USER, RECURRING_LIST_LIMIT);
  });
});

describe('createTemplate', () => {
  it('refuses a category the user does not own', async () => {
    const f = fakes();
    f.store.ownsCategory = async () => false;
    await expect(
      createTemplate(f.store, USER, { kind: 'expense', categoryAccountId: TRAVEL, amountPence: 100, amountIs: 'gross', vatRatePercent: 0, description: 'x', schedule: 'monthly', nextDate: '2026-11-01' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});
