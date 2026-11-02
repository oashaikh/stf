import type { AccountInsert } from '../../server/src/db/schema.js';

export type DefaultAccount = Required<Pick<AccountInsert, 'code' | 'name' | 'accountType' | 'taxCategory' | 'isSystem'>>;

// System account codes are referenced by the posting rules, so keep them stable.
export const BANK_ACCOUNT_CODE = '1000';
export const TRADE_DEBTORS_CODE = '1100';
export const VAT_CONTROL_CODE = '2100';
export const OWNER_CAPITAL_CODE = '3000';
export const OWNER_DRAWINGS_CODE = '3100';
export const SALES_ACCOUNT_CODE = '4000';

// Tax category slugs map to the HMRC self-employment expense boxes.
export const DEFAULT_ACCOUNTS: readonly DefaultAccount[] = [
  { code: BANK_ACCOUNT_CODE, name: 'Business bank account', accountType: 'asset', taxCategory: null, isSystem: true },
  { code: TRADE_DEBTORS_CODE, name: 'Trade debtors', accountType: 'asset', taxCategory: null, isSystem: true },
  { code: VAT_CONTROL_CODE, name: 'VAT control', accountType: 'liability', taxCategory: null, isSystem: true },
  { code: OWNER_CAPITAL_CODE, name: "Owner's capital", accountType: 'equity', taxCategory: null, isSystem: true },
  { code: OWNER_DRAWINGS_CODE, name: "Owner's drawings", accountType: 'equity', taxCategory: null, isSystem: true },
  { code: SALES_ACCOUNT_CODE, name: 'Sales', accountType: 'income', taxCategory: 'turnover', isSystem: false },
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

// UK property categories follow HMRC's property income and expense boxes. They are a separate list so
// owners without a rental see no extra categories; the property- prefix keeps them out of self-employment figures.
export const PROPERTY_CATEGORY_PREFIX = 'property-';
export const isPropertyCategory = (taxCategory: string | null): boolean => taxCategory?.startsWith(PROPERTY_CATEGORY_PREFIX) ?? false;

export const PROPERTY_ACCOUNTS: readonly DefaultAccount[] = [
  { code: '4200', name: 'Rent received', accountType: 'income', taxCategory: 'property-rent-received', isSystem: false },
  { code: '6710', name: 'Rental repairs and maintenance', accountType: 'expense', taxCategory: 'property-repairs-maintenance', isSystem: false },
  { code: '6720', name: 'Rental mortgage interest and finance costs', accountType: 'expense', taxCategory: 'property-finance-costs', isSystem: false },
  { code: '6730', name: 'Rental running costs (rates, rent, insurance, utilities)', accountType: 'expense', taxCategory: 'property-premises-running-costs', isSystem: false },
  { code: '6740', name: 'Rental professional fees (agent, accountant, legal)', accountType: 'expense', taxCategory: 'property-professional-fees', isSystem: false },
  { code: '6750', name: 'Rental services (cleaning, gardening, wages)', accountType: 'expense', taxCategory: 'property-cost-of-services', isSystem: false },
  { code: '6760', name: 'Rental travel', accountType: 'expense', taxCategory: 'property-travel-costs', isSystem: false },
  { code: '6770', name: 'Other rental costs', accountType: 'expense', taxCategory: 'property-other-costs', isSystem: false },
];
