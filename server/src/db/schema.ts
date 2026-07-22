import { boolean, date, inet, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const businessTypeEnum = pgEnum('business_type', ['sole_trader', 'partnership', 'limited_company']);

export const vatSchemeEnum = pgEnum('vat_scheme', ['standard', 'flat_rate', 'cash_accounting']);

export const accountingBasisEnum = pgEnum('accounting_basis', ['accruals', 'cash']);

export const accountTypeEnum = pgEnum('account_type', ['income', 'expense', 'asset', 'liability', 'equity']);

export const transactionStatusEnum = pgEnum('transaction_status', ['draft', 'confirmed', 'reconciled', 'voided']);

export const transactionSourceEnum = pgEnum('transaction_source', ['manual', 'bank_feed', 'receipt_ai', 'import']);

export const receiptUploadStatusEnum = pgEnum('receipt_upload_status', ['pending', 'ready', 'failed']);

export const receiptAiStatusEnum = pgEnum('receipt_ai_status', ['pending', 'extracted', 'failed', 'skipped']);

export const invoiceStatusEnum = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'overdue', 'voided']);

export const auditActorTypeEnum = pgEnum('audit_actor_type', ['user', 'system', 'ai_agent']);

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

// Receipt file metadata and its AI draft. Confidence uses integer thousandths
// (0-1000) so no floating-point or numeric database type is persisted.
export const receipts = pgTable('receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  transactionId: uuid('transaction_id').references(() => transactions.id),
  fileKey: text('file_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  uploadStatus: receiptUploadStatusEnum('upload_status').notNull().default('pending'),
  aiStatus: receiptAiStatusEnum('ai_status').notNull().default('pending'),
  aiModel: text('ai_model'),
  aiConfidence: integer('ai_confidence'),
  aiRawOutput: jsonb('ai_raw_output'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// Individual AI suggestions remain drafts until a user confirms or corrects
// them. Confidence is stored as integer thousandths (0-1000).
export const receiptExtractions = pgTable('receipt_extractions', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id')
    .notNull()
    .references(() => receipts.id),
  field: text('field').notNull(),
  suggestedValue: text('suggested_value').notNull(),
  confidence: integer('confidence'),
  confirmedValue: text('confirmed_value'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  confirmedByUserId: uuid('confirmed_by_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Invoice header. Soft-deletable financial record.
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    publicNumber: text('public_number').notNull(),
    clientName: text('client_name').notNull(),
    clientEmail: text('client_email'),
    clientAddress: text('client_address'),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    subtotalPence: integer('subtotal_pence').notNull(),
    vatPence: integer('vat_pence').notNull(),
    totalPence: integer('total_pence').notNull(),
    notes: text('notes'),
    transactionId: uuid('transaction_id').references(() => transactions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    userPublicNumberUnique: unique().on(table.userId, table.publicNumber),
  }),
);

// Invoice lines. Quantity is scaled x10000 (4 dp) integer, never numeric/decimal.
export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  unitPricePence: integer('unit_price_pence').notNull(),
  vatRatePercent: integer('vat_rate_percent').notNull(),
  subtotalPence: integer('subtotal_pence').notNull(),
  vatPence: integer('vat_pence').notNull(),
  totalPence: integer('total_pence').notNull(),
});

// Append-only audit trail. Never updated or deleted.
export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  userId: uuid('user_id'),
  actorType: auditActorTypeEnum('actor_type').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: uuid('resource_id'),
  ipAddress: inet('ip_address'),
  beforeSnapshot: jsonb('before_snapshot'),
  afterSnapshot: jsonb('after_snapshot'),
  metadata: jsonb('metadata').notNull().default({}),
});
