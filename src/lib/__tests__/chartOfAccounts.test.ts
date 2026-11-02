import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCOUNTS, isPropertyCategory, PROPERTY_ACCOUNTS } from '../chartOfAccounts';

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

describe('PROPERTY_ACCOUNTS', () => {
  it('uses property- tax categories, codes that do not clash with the defaults, and no system accounts', () => {
    const defaultCodes = new Set(DEFAULT_ACCOUNTS.map((account) => account.code));
    expect(PROPERTY_ACCOUNTS.every((account) => isPropertyCategory(account.taxCategory))).toBe(true);
    expect(PROPERTY_ACCOUNTS.some((account) => defaultCodes.has(account.code) || account.isSystem)).toBe(false);
    expect(new Set(PROPERTY_ACCOUNTS.map((account) => account.code)).size).toBe(PROPERTY_ACCOUNTS.length);
  });

  it('has rent received as income and the seven HMRC cost groups as expenses', () => {
    expect(PROPERTY_ACCOUNTS.filter((account) => account.accountType === 'income').map((account) => account.taxCategory)).toEqual(['property-rent-received']);
    expect(PROPERTY_ACCOUNTS.filter((account) => account.accountType === 'expense').map((account) => account.taxCategory)).toEqual([
      'property-repairs-maintenance',
      'property-finance-costs',
      'property-premises-running-costs',
      'property-professional-fees',
      'property-cost-of-services',
      'property-travel-costs',
      'property-other-costs',
    ]);
  });

  it('keeps self-employment categories out of isPropertyCategory', () => {
    expect(isPropertyCategory('travel')).toBe(false);
    expect(isPropertyCategory(null)).toBe(false);
  });
});
