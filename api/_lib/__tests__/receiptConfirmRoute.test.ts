import { describe, expect, it, vi } from 'vitest';

vi.mock('../db', () => ({ db: {} }));

import { createReceiptConfirmHandler } from '../../receipt-confirm';
import type { AuthDeps } from '../auth';
import { EntryRuleError, PERIOD_LOCKED_MESSAGE, type Entry, type EntryStore } from '../entries';
import type { ReceiptConfirmStore } from '../receiptConfirm';

const authDeps: AuthDeps = {
  issuer: {
    verifyToken: async (token) => (token.startsWith('tok-') ? token.slice(4) : null),
    getEmail: async () => 'a@example.com',
  },
  users: { findId: async (issuerId) => issuerId, createIfAbsent: async (issuerId) => issuerId },
};

const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const CATEGORY_ID = '44444444-4444-4444-8444-444444444444';
const BANK_ID = '55555555-5555-4555-8555-555555555555';
const VAT_ID = '66666666-6666-4666-8666-666666666666';
const DEBTORS_ID = '77777777-7777-4777-8777-777777777777';

// The model suggested 23.99 on 2026-10-30; the owner corrects it to 24.00 on 2026-10-29.
const ownerValues = {
  id: RECEIPT_ID,
  date: '2026-10-29',
  supplier: 'Invented Cafe Ltd',
  grossPence: 2400,
  vatRatePercent: 20,
  categoryAccountId: CATEGORY_ID,
  description: 'Client lunch',
};

function setup({ locked = false, aiStatus = 'extracted' as 'extracted' | 'pending' } = {}) {
  const expenses: Entry[] = [];
  const linked: { transactionId: string | null } = { transactionId: null };
  const confirmedValues: Record<string, string>[] = [];
  let aiState: string = aiStatus;
  const store: ReceiptConfirmStore = {
    find: async (userId, id) => (userId === 'owner_a' && id === RECEIPT_ID ? { aiStatus: aiState as 'extracted', transactionId: linked.transactionId } : undefined),
    confirm: async (_userId, _id, header, lines, confirmed) => {
      if (linked.transactionId) throw new EntryRuleError(409, 'ALREADY_CONFIRMED', 'This receipt is already an expense');
      const entry: Entry = { id: `tx-${expenses.length + 1}`, ...header, source: 'receipt_ai', lines };
      expenses.push(entry);
      linked.transactionId = entry.id;
      confirmedValues.push(confirmed);
      return entry;
    },
    skip: async (userId, id) => {
      if (userId !== 'owner_a' || id !== RECEIPT_ID || linked.transactionId) return false;
      aiState = 'skipped';
      return true;
    },
  };
  const entryStore = {
    isDateLocked: async () => locked,
    loadPostingContext: async () => ({
      category: { accountType: 'expense', archivedAt: null },
      hasVatNumber: true,
      bankAccountId: BANK_ID,
      vatControlAccountId: VAT_ID,
      debtorsAccountId: DEBTORS_ID,
    }),
  } as unknown as EntryStore;
  const handler = createReceiptConfirmHandler({ store, entryStore, now: () => new Date('2026-11-02T10:00:00Z') }, authDeps);
  const call = (method: string, user: string | undefined, body?: unknown) =>
    handler(
      new Request('https://app.test/api/receipt-confirm', {
        method,
        headers: user ? { cookie: `stf_session=tok-${user}`, 'content-type': 'application/json' } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  return { call, expenses, confirmedValues, aiState: () => aiState };
}

describe('receipt confirm', () => {
  it('requires sign-in', async () => {
    expect((await setup().call('POST', undefined, ownerValues)).status).toBe(401);
  });

  it("creates one receipt_ai expense from the owner's values, not the model's", async () => {
    const { call, expenses, confirmedValues } = setup();
    const response = await call('POST', 'owner_a', ownerValues);
    expect(response.status).toBe(200);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({ date: '2026-10-29', description: 'Client lunch', reference: 'Invented Cafe Ltd', source: 'receipt_ai', status: 'confirmed' });
    const gross = expenses[0].lines.filter((line) => line.accountId === CATEGORY_ID).reduce((sum, line) => sum + Math.abs(line.amountPence) + Math.abs(line.vatPence), 0);
    expect(gross).toBe(2400);
    expect(confirmedValues[0]).toMatchObject({ date: '2026-10-29', vendor: 'Invented Cafe Ltd', totalPence: '2400', vatPence: '400', category: CATEGORY_ID });
  });

  it('refuses a second confirm with 409 and creates nothing more', async () => {
    const { call, expenses } = setup();
    await call('POST', 'owner_a', ownerValues);
    const second = await call('POST', 'owner_a', ownerValues);
    expect(second.status).toBe(409);
    expect(expenses).toHaveLength(1);
  });

  it('refuses a date in a locked period with 409 and creates nothing', async () => {
    const { call, expenses } = setup({ locked: true });
    const response = await call('POST', 'owner_a', ownerValues);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'PERIOD_LOCKED', error: PERIOD_LOCKED_MESSAGE });
    expect(expenses).toHaveLength(0);
  });

  it("gives another owner 404 for the first owner's receipt", async () => {
    const { call, expenses } = setup();
    expect((await call('POST', 'owner_b', ownerValues)).status).toBe(404);
    expect((await call('DELETE', 'owner_b', { id: RECEIPT_ID })).status).toBe(404);
    expect(expenses).toHaveLength(0);
  });

  it('refuses a receipt that has not been read yet', async () => {
    const { call, expenses } = setup({ aiStatus: 'pending' });
    expect((await call('POST', 'owner_a', ownerValues)).status).toBe(409);
    expect(expenses).toHaveLength(0);
  });

  it('rejects bad input and ignores a client-supplied user id', async () => {
    const { call, expenses } = setup();
    expect((await call('POST', 'owner_a', { ...ownerValues, grossPence: 24.5 })).status).toBe(400);
    expect((await call('POST', 'owner_a', { ...ownerValues, vatRatePercent: 17 })).status).toBe(400);
    expect((await call('POST', 'owner_b', { ...ownerValues, userId: 'owner_a' })).status).toBe(404);
    expect(expenses).toHaveLength(0);
  });

  it('discard marks the receipt skipped and creates nothing', async () => {
    const { call, expenses, aiState } = setup();
    const response = await call('DELETE', 'owner_a', { id: RECEIPT_ID });
    expect(response.status).toBe(200);
    expect(aiState()).toBe('skipped');
    expect(expenses).toHaveLength(0);
  });

  it('refuses to discard a receipt that is already an expense', async () => {
    const { call } = setup();
    await call('POST', 'owner_a', ownerValues);
    expect((await call('DELETE', 'owner_a', { id: RECEIPT_ID })).status).toBe(409);
  });
});
