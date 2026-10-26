import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS } from '../chartOfAccounts';

const SYSTEM_CODES = ['1000', '1100', '2100', '3000', '3100'];

describe('DEFAULT_ACCOUNTS', () => {
  it('has unique codes', () => {
    const codes = DEFAULT_ACCOUNTS.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('stays between 15 and 20 accounts', () => {
    expect(DEFAULT_ACCOUNTS.length).toBeGreaterThanOrEqual(15);
    expect(DEFAULT_ACCOUNTS.length).toBeLessThanOrEqual(20);
  });

  it('covers every account type', () => {
    const types = new Set(DEFAULT_ACCOUNTS.map((account) => account.accountType));
    expect(types).toEqual(new Set(['income', 'expense', 'asset', 'liability', 'equity']));
  });

  it('gives every expense a tax category covering the HMRC groups', () => {
    const expenses = DEFAULT_ACCOUNTS.filter((account) => account.accountType === 'expense');
    expect(expenses.every((account) => account.taxCategory)).toBe(true);
    expect(new Set(expenses.map((account) => account.taxCategory))).toEqual(
      new Set([
        'cost-of-goods',
        'travel',
        'premises',
        'admin-office',
        'advertising',
        'professional-fees',
        'finance-costs',
        'other-allowable',
        'disallowable',
      ]),
    );
  });

  it('flags exactly the five posting accounts as system', () => {
    const system = DEFAULT_ACCOUNTS.filter((account) => account.isSystem).map((account) => account.code);
    expect(system.sort()).toEqual(SYSTEM_CODES);
  });
});
