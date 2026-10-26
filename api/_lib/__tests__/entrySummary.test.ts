import { describe, expect, it } from 'vitest';

import { summariseEntry } from '../entries.js';

const SETTLE = ['bank', 'debtors'];
const line = (accountId: string, amountPence: number) => ({ accountId, amountPence, vatPence: 0, vatRatePercent: null });
const expense = [line('travel', 10000), line('vat', 2000), line('bank', -12000)];
const income = [line('sales', -10000), line('vat', -2000), line('bank', 12000)];
const noVatExpense = [line('travel', 5000), line('bank', -5000)];

const permutations = <T,>(items: T[]): T[][] =>
  items.length <= 1 ? [items] : items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));

describe('summariseEntry', () => {
  it.each([
    ['expense', expense, 'expense', 12000],
    ['income', income, 'income', 12000],
    ['expense without VAT', noVatExpense, 'expense', 5000],
  ])('reads %s direction and gross from the settle line in any row order', (_name, lines, kind, grossPence) => {
    for (const shuffled of permutations(lines)) {
      expect(summariseEntry(shuffled, SETTLE)).toEqual({ kind, grossPence });
    }
  });

  it('reads an invoice settled against debtors', () => {
    expect(summariseEntry([line('debtors', 6000), line('sales', -6000)], SETTLE)).toEqual({ kind: 'income', grossPence: 6000 });
  });
});
