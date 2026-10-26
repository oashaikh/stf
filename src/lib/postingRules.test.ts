import { describe, expect, it } from 'vitest';
import { postEntry, type PostingEntry } from './postingRules.js';
import { buildVatReturnFromLedger, type LedgerLine, type VatRate } from './vat.js';

const accounts = { bankAccountId: 'bank', vatControlAccountId: 'vat', debtorsAccountId: 'debtors' };
const base: PostingEntry = {
  kind: 'expense',
  categoryAccountId: 'cat',
  amountPence: 12000,
  amountIs: 'gross',
  vatRatePercent: 20,
  hasVatNumber: true,
  ...accounts,
};
const period = { start: '2026-07-01', end: '2026-09-30' };

function boxesFor(entry: PostingEntry) {
  const types: Record<string, LedgerLine['accountType']> = {
    cat: entry.kind, bank: 'asset', vat: 'liability', debtors: 'asset',
  };
  const ledger: LedgerLine[] = postEntry(entry).map((l) => ({
    date: '2026-08-01', accountType: types[l.accountId], amountPence: l.amountPence,
    vatPence: l.vatPence, status: 'confirmed', deletedAt: null,
  }));
  return buildVatReturnFromLedger(ledger, period);
}

describe('postEntry', () => {
  it('posts an expense from gross as category, VAT control and bank lines', () => {
    expect(postEntry(base)).toEqual([
      { accountId: 'cat', amountPence: 10000, vatPence: 2000, vatRatePercent: 20 },
      { accountId: 'vat', amountPence: 2000, vatPence: 0, vatRatePercent: null },
      { accountId: 'bank', amountPence: -12000, vatPence: 0, vatRatePercent: null },
    ]);
  });

  it('mirrors the signs for income from net', () => {
    const lines = postEntry({ ...base, kind: 'income', amountIs: 'net', amountPence: 10000 });
    expect(lines.map((l) => [l.accountId, l.amountPence, l.vatPence])).toEqual([
      ['cat', -10000, -2000], ['vat', -2000, 0], ['bank', 12000, 0],
    ]);
  });

  it('always sums to zero for every rate, direction and basis', () => {
    for (const kind of ['income', 'expense'] as const)
      for (const amountIs of ['gross', 'net'] as const)
        for (const rate of [0, 5, 20, null] as (VatRate | null)[])
          for (const amountPence of [1, 5, 33, 999, 12345]) {
            const lines = postEntry({ ...base, kind, amountIs, vatRatePercent: rate, amountPence });
            expect(lines.reduce((s, l) => s + l.amountPence, 0)).toBe(0);
          }
  });

  it.each([20, 5, 0] as VatRate[])('feeds the VAT return correctly at %i%%', (rate) => {
    const vat = (net: number) => Math.round((net * rate) / 100);
    const sale = boxesFor({ ...base, kind: 'income', amountIs: 'net', amountPence: 10000, vatRatePercent: rate });
    expect([sale.box1, sale.box6, sale.box4, sale.box7]).toEqual([vat(10000), 10000, 0, 0]);
    const purchase = boxesFor({ ...base, amountIs: 'net', amountPence: 10000, vatRatePercent: rate });
    expect([purchase.box4, purchase.box7, purchase.box1, purchase.box6]).toEqual([vat(10000), 10000, 0, 0]);
  });

  it('rounds half a penny up, as HMRC does', () => {
    // 10 net at 5% = 0.5p -> 1p
    expect(postEntry({ ...base, amountIs: 'net', amountPence: 10, vatRatePercent: 5 })[0].vatPence).toBe(1);
    // 130 gross at 5%: 130*5/105 = 6.19 -> 6; 21 gross at 20%: 3.5 -> 4
    expect(postEntry({ ...base, amountPence: 21 })[0].vatPence).toBe(4);
  });

  it('writes no VAT line and no VAT without a VAT number', () => {
    const lines = postEntry({ ...base, hasVatNumber: false });
    expect(lines).toEqual([
      { accountId: 'cat', amountPence: 12000, vatPence: 0, vatRatePercent: null },
      { accountId: 'bank', amountPence: -12000, vatPence: 0, vatRatePercent: null },
    ]);
  });

  it('posts against trade debtors when asked', () => {
    const lines = postEntry({ ...base, kind: 'income', settleAgainst: 'debtors' });
    expect(lines[lines.length - 1].accountId).toBe('debtors');
  });

  it('rejects non-integer amounts', () => {
    expect(() => postEntry({ ...base, amountPence: 10.5 })).toThrow();
  });
});
