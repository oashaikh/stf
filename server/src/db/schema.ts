import { boolean, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const businessTypeEnum = pgEnum('business_type', ['sole_trader', 'partnership', 'limited_company']);

export const vatSchemeEnum = pgEnum('vat_scheme', ['standard', 'flat_rate', 'cash_accounting']);

export const accountingBasisEnum = pgEnum('accounting_basis', ['accruals', 'cash']);

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
