import { boolean, date, integer, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const businessTypeEnum = pgEnum('business_type', ['sole_trader', 'partnership', 'limited_company']);

export const vatSchemeEnum = pgEnum('vat_scheme', ['standard', 'flat_rate', 'cash_accounting']);

export const accountingBasisEnum = pgEnum('accounting_basis', ['accruals', 'cash']);

export const accountTypeEnum = pgEnum('account_type', ['income', 'expense', 'asset', 'liability', 'equity']);

export const transactionStatusEnum = pgEnum('transaction_status', ['draft', 'confirmed', 'reconciled', 'voided']);

export const transactionSourceEnum = pgEnum('transaction_source', ['manual', 'bank_feed', 'receipt_ai', 'import']);

// Mirrors Clerk identity; created on first sign-in. All money is integer pence.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  businessName: text('business_name'),
  businessType: businessTypeEnum('business_type').notNull().default('sole_trader'),
  utr: text('utr'),
  vatNumber: text('vat_number'),
  vatScheme: vatSchemeEnum('vat_scheme'),
  flatRatePercent: integer('flat_rate_percent'),
  accountingBasis: accountingBasisEnum('accounting_basis').notNull().default('accruals'),
  taxYearEnd: text('tax_year_end').notNull().default('04-05'),
  hmrcAccessToken: text('hmrc_access_token'),
  hmrcRefreshToken: text('hmrc_refresh_token'),
  hmrcTokenExpiresAt: timestamp('hmrc_token_expires_at', { withTimezone: true }),
  hmrcSandboxMode: boolean('hmrc_sandbox_mode').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Chart of accounts, per user. No independent deleted_at: accounts are not
// financial-record transactions themselves; they are referenced by (soft-
// deletable) transaction_lines.
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    accountType: accountTypeEnum('account_type').notNull(),
    taxCategory: text('tax_category'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCodeUnique: unique().on(table.userId, table.code),
  }),
);

// Double-entry ledger header. Soft-deletable financial record.
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  date: date('date').notNull(),
  description: text('description').notNull(),
  reference: text('reference'),
  status: transactionStatusEnum('status').notNull().default('draft'),
  source: transactionSourceEnum('source').notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Ledger lines. Immutable children of a transaction; voided via the parent's
// deleted_at/status rather than an independent deleted_at.
export const transactionLines = pgTable('transaction_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  transactionId: uuid('transaction_id')
    .notNull()
    .references(() => transactions.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  amountPence: integer('amount_pence').notNull(),
  vatPence: integer('vat_pence').notNull().default(0),
  vatRatePercent: integer('vat_rate_percent').notNull().default(0),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
