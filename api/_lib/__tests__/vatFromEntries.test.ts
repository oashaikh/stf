import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createEntriesHandler } from '../../entries';
import type { AuthDeps } from '../auth';
import { createEntry, type Entry, type EntryStore, type NewEntry } from '../entries';
import type { HmrcStore } from '../hmrcStore';
import { previewVatReturnForUser } from '../vatPreview';
import { confirmReturn, getReturnReview, requireConfirmedReturn, VatReturnError, type DrillLine, type Period, type SavedDraft, type VatReturnStore } from '../vatReturns';
import { buildVatReturnFromLedger } from '../../../src/lib/vat';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-04-10T12:00:00Z');
const OWNER = 'owner';
const BANK = id(900);
const VAT = id(901);
const DEBTORS = id(902);
const SALES = id(1);
const PURCHASES = id(2);
const accountTypes: Record<string, DrillLine['accountType']> = { [SALES]: 'income', [PURCHASES]: 'expense', [BANK]: 'asset', [DEBTORS]: 'asset', [VAT]: 'liability' };

const period: Period = { periodKey: '26A1', start: '2026-01-01', end: '2026-03-31' };

type SavedEntry = Entry & { userId: string; voidedAt?: Date };

describe('VAT return from real entries', () => {
  let saved: SavedEntry[];
  let draft: SavedDraft | undefined;
  let filed: boolean;
  // The database store also locks a period once its return is confirmed; switching that off lets the
  // stale-confirmation guard be tested on its own, as it would be if an entry changed by another route.
  let confirmedLocksPeriod: boolean;

  const live = () => saved.filter((entry) => !entry.voidedAt);

  const entryStore: EntryStore = {
    async loadPostingContext(_userId, categoryAccountId) {
      return {
        category: categoryAccountId in accountTypes ? { accountType: accountTypes[categoryAccountId] as 'income' | 'expense', archivedAt: null } : undefined,
        hasVatNumber: true,
        bankAccountId: BANK,
        vatControlAccountId: VAT,
        debtorsAccountId: DEBTORS,
      };
    },
    async create(userId, header, lines) {
      const entry: Entry = { id: id(100 + saved.length), ...header, source: 'manual', lines };
      saved.push({ ...entry, userId });
      return entry;
    },
    async get(userId, entryId) {
      return live().find((entry) => entry.userId === userId && entry.id === entryId);
    },
    async isDateLocked(_userId, date) {
      const inPeriod = date >= period.start && date <= period.end;
      return inPeriod && (filed || (confirmedLocksPeriod && draft?.status === 'confirmed'));
    },
    async replace(userId, entryId, header, lines) {
      const old = live().find((entry) => entry.userId === userId && entry.id === entryId);
      if (!old) return undefined;
      old.voidedAt = NOW;
      const entry: Entry = { id: id(100 + saved.length), ...header, source: 'manual', lines };
      saved.push({ ...entry, userId });
      return entry;
    },
    async void(userId, entryId) {
      const old = live().find((entry) => entry.userId === userId && entry.id === entryId);
      if (!old) return false;
      old.voidedAt = NOW;
      return true;
    },
    async confirm() {
      return undefined;
    },
    async list() {
      return [];
    },
  };

  // Reads the same saved rows the entry store writes, the way the database store joins lines to accounts.
  const vatStore = {
    async loadLedgerLines(userId, { start, end }) {
      return live()
        .filter((entry) => entry.userId === userId && entry.date >= start && entry.date <= end)
        .flatMap((entry) =>
          entry.lines.map((line, index): DrillLine => ({
            lineId: `${entry.id}-${index}`,
            transactionId: entry.id,
            date: entry.date,
            accountType: accountTypes[line.accountId],
            amountPence: line.amountPence,
            vatPence: line.vatPence,
            status: entry.status,
            deletedAt: null,
            description: entry.description,
          })),
        );
    },
    async findDraft() {
      return draft;
    },
    async findSubmission() {
      return undefined;
    },
    async confirm(_userId, { start, end }, boxes, now) {
      draft = { status: 'confirmed', periodStart: start, periodEnd: end, boxes, confirmedAt: now.toISOString() };
    },
  } as unknown as VatReturnStore;

  const call = (method: string, body?: unknown, query = '') =>
    createEntriesHandler(entryStore, authDeps, () => NOW)(
      new Request(`https://app.test/api/entries${query}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: { cookie: `stf_session=tok-${OWNER}` },
      }),
    );

  const entry = (kind: 'income' | 'expense', amountPence: number, vatRatePercent: 0 | 5 | 20, amountIs: 'gross' | 'net' = 'net', date = '2026-02-10'): NewEntry => ({
    date,
    description: `${kind} ${vatRatePercent}%`,
    kind,
    categoryAccountId: kind === 'income' ? SALES : PURCHASES,
    amountPence,
    amountIs,
    vatRatePercent,
    status: 'confirmed',
  });
  const post = async (input: NewEntry) => {
    const response = await call('POST', input);
    expect(response.status).toBe(200);
    return (await response.json()).entry as Entry;
  };

  /** Standard, reduced and zero-rated sales and purchases. */
  const postMixedPeriod = async () => {
    await post(entry('income', 12000, 20, 'gross')); // net 10000, vat 2000
    await post(entry('income', 20000, 5)); // vat 1000
    await post(entry('income', 5000, 0));
    await post(entry('expense', 6000, 20, 'gross')); // net 5000, vat 1000
    await post(entry('expense', 4000, 5)); // vat 200
    await post(entry('expense', 3000, 0));
  };

  beforeEach(() => {
    saved = [];
    draft = undefined;
    filed = false;
    confirmedLocksPeriod = true;
  });

  it('fills every box from standard, reduced and zero-rated entries', async () => {
    await postMixedPeriod();
    const review = await getReturnReview(vatStore, OWNER, period);
    expect(review.boxes).toEqual({ box1: 3000, box2: 0, box3: 3000, box4: 1200, box5: 1800, box6: 35000, box7: 12000, box8: 0, box9: 0 });
    expect(review.entryCount).toBe(6);
    expect(review.drillDownTotals).toMatchObject({ box1: 3, box6: 3, box4: 3, box7: 3 });
    expect(review.drillDown.box1.map((line) => line.transactionId)).toEqual(live().filter((e) => e.lines[0].accountId === SALES).map((e) => e.id));
  });

  it('shows no entries for an empty period', async () => {
    const review = await getReturnReview(vatStore, OWNER, period);
    expect(review.entryCount).toBe(0);
    expect(review.boxes.box6).toBe(0);
  });

  it('reports a refund as a negative box 5 when reclaimed VAT exceeds VAT due', async () => {
    await createEntry(entryStore, OWNER, entry('income', 5000, 20), NOW); // vat 1000
    await createEntry(entryStore, OWNER, entry('expense', 24000, 20, 'gross'), NOW); // net 20000, vat 4000
    const { boxes } = await getReturnReview(vatStore, OWNER, period);
    expect(boxes).toMatchObject({ box1: 1000, box3: 1000, box4: 4000, box5: -3000, box6: 5000, box7: 20000 });
  });

  it('counts the first and last day of the period and ignores the day before and after', async () => {
    await post(entry('income', 1000, 20, 'net', '2026-01-01'));
    await post(entry('income', 2000, 20, 'net', '2026-03-31'));
    await post(entry('income', 4000, 20, 'net', '2025-12-31'));
    await post(entry('income', 8000, 20, 'net', '2026-04-01'));
    const review = await getReturnReview(vatStore, OWNER, period);
    expect(review.boxes.box6).toBe(3000);
    expect(review.boxes.box1).toBe(600);
    expect(review.entryCount).toBe(2);
  });

  it('leaves draft and voided entries out of the return', async () => {
    await post({ ...entry('income', 1000, 20), status: 'draft' });
    const voided = await post(entry('income', 2000, 20));
    expect((await call('DELETE', undefined, `?id=${voided.id}`)).status).toBe(200);
    const review = await getReturnReview(vatStore, OWNER, period);
    expect(review.boxes.box6).toBe(0);
  });

  it('refuses a confirmed return once an entry in it is edited by another route', async () => {
    const sale = await post(entry('income', 10000, 20));
    await confirmReturn(vatStore, OWNER, period, NOW);
    await expect(requireConfirmedReturn(OWNER, period, vatStore)).resolves.toMatchObject({ box1: 2000, box6: 10000 });

    confirmedLocksPeriod = false;
    expect((await call('PUT', entry('income', 20000, 20), `?id=${sale.id}`)).status).toBe(200);

    const review = await getReturnReview(vatStore, OWNER, period);
    expect(review.stale).toBe(true);
    await expect(requireConfirmedReturn(OWNER, period, vatStore)).rejects.toMatchObject({ code: 'STALE_CONFIRMATION', status: 409 });
  });

  it('locks the confirmed period against edits so a confirmation cannot go stale', async () => {
    const sale = await post(entry('income', 10000, 20));
    await confirmReturn(vatStore, OWNER, period, NOW);
    const response = await call('PUT', entry('income', 20000, 20), `?id=${sale.id}`);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('PERIOD_LOCKED');
    await expect(requireConfirmedReturn(OWNER, period, vatStore)).resolves.toMatchObject({ box1: 2000 });
  });

  it('refuses create, edit and void inside a filed period', async () => {
    const sale = await post(entry('income', 10000, 20));
    filed = true;
    const attempts = [
      call('POST', entry('income', 500, 20)),
      call('PUT', entry('income', 20000, 20), `?id=${sale.id}`),
      call('DELETE', undefined, `?id=${sale.id}`),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('PERIOD_LOCKED');
    }
    expect(live()).toHaveLength(1);
    expect(live()[0].lines[0].amountPence).toBe(-10000);
    // An entry dated after the filed period is still open.
    expect((await call('POST', entry('income', 500, 20, 'net', '2026-04-02'))).status).toBe(200);
  });

  describe('preview', () => {
    const hmrcStore = {
      sandboxMode: async () => true,
      credentials: async () => ({ vatNumber: '123456789', accessToken: 'invented-access', refreshToken: 'invented-refresh', storedRefreshToken: 'invented-stored', expiresAt: new Date(NOW.getTime() + 3_600_000) }),
      saveRefreshedTokens: async () => true,
    } as unknown as HmrcStore;

    beforeEach(() => {
      vi.stubEnv('HMRC_SANDBOX_MODE', 'true');
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('sends the figures that come from the entries', async () => {
      await postMixedPeriod();
      await confirmReturn(vatStore, OWNER, period, NOW);
      const preview = await previewVatReturnForUser(
        { userId: OWNER, period, request: new Request('https://app.test/api/vat/preview', { method: 'POST' }) },
        { vatStore, hmrcStore, now: () => NOW, recordPreview: async () => undefined },
      );
      expect(preview.body).toMatchObject({
        periodKey: '26A1',
        vatDueSales: 30,
        totalVatDue: 30,
        vatReclaimedCurrPeriod: 12,
        netVatDue: 18,
        totalValueSalesExVAT: 350,
        totalValuePurchasesExVAT: 120,
      });
    });

    it('refuses to preview a return whose entries changed after confirmation', async () => {
      const sale = await post(entry('income', 10000, 20));
      await confirmReturn(vatStore, OWNER, period, NOW);
      confirmedLocksPeriod = false;
      await call('PUT', entry('income', 20000, 20), `?id=${sale.id}`);
      await expect(
        previewVatReturnForUser(
          { userId: OWNER, period, request: new Request('https://app.test/api/vat/preview', { method: 'POST' }) },
          { vatStore, hmrcStore, now: () => NOW, recordPreview: async () => undefined },
        ),
      ).rejects.toBeInstanceOf(VatReturnError);
    });
  });

  it('matches the pure ledger calculation for the same lines', async () => {
    await postMixedPeriod();
    const lines = await vatStore.loadLedgerLines(OWNER, period);
    expect((await getReturnReview(vatStore, OWNER, period)).boxes).toEqual(buildVatReturnFromLedger(lines, period));
  });
});
