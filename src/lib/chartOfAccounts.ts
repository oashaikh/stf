import type { AccountInsert } from '../../server/src/db/schema.js';

export type DefaultAccount = Required<Pick<AccountInsert, 'code' | 'name' | 'accountType' | 'taxCategory' | 'isSystem'>>;

// System account codes are referenced by the posting rules, so keep them stable.
export const BANK_ACCOUNT_CODE = '1000';
export const TRADE_DEBTORS_CODE = '1100';
export const VAT_CONTROL_CODE = '2100';
export const OWNER_CAPITAL_CODE = '3000';
export const OWNER_DRAWINGS_CODE = '3100';

// Tax category slugs map to the HMRC self-employment expense boxes.
export const DEFAULT_ACCOUNTS: readonly DefaultAccount[] = [
  { code: BANK_ACCOUNT_CODE, name: 'Business bank account', accountType: 'asset', taxCategory: null, isSystem: true },
  { code: TRADE_DEBTORS_CODE, name: 'Trade debtors', accountType: 'asset', taxCategory: null, isSystem: true },
  { code: VAT_CONTROL_CODE, name: 'VAT control', accountType: 'liability', taxCategory: null, isSystem: true },
  { code: OWNER_CAPITAL_CODE, name: "Owner's capital", accountType: 'equity', taxCategory: null, isSystem: true },
  { code: OWNER_DRAWINGS_CODE, name: "Owner's drawings", accountType: 'equity', taxCategory: null, isSystem: true },
  { code: '4000', name: 'Sales', accountType: 'income', taxCategory: 'turnover', isSystem: false },
  { code: '4100', name: 'Other business income', accountType: 'income', taxCategory: 'other-income', isSystem: false },
  { code: '5000', name: 'Cost of goods', accountType: 'expense', taxCategory: 'cost-of-goods', isSystem: false },
  { code: '6000', name: 'Travel', accountType: 'expense', taxCategory: 'travel', isSystem: false },
  { code: '6100', name: 'Premises', accountType: 'expense', taxCategory: 'premises', isSystem: false },
  { code: '6200', name: 'Admin and office', accountType: 'expense', taxCategory: 'admin-office', isSystem: false },
  { code: '6300', name: 'Advertising', accountType: 'expense', taxCategory: 'advertising', isSystem: false },
  { code: '6400', name: 'Professional fees', accountType: 'expense', taxCategory: 'professional-fees', isSystem: false },
  { code: '6500', name: 'Finance costs', accountType: 'expense', taxCategory: 'finance-costs', isSystem: false },
  { code: '6600', name: 'Other allowable expenses', accountType: 'expense', taxCategory: 'other-allowable', isSystem: false },
  { code: '6900', name: 'Disallowable expenses', accountType: 'expense', taxCategory: 'disallowable', isSystem: false },
];
