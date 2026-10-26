/**
 * Shared domain types — STF
 *
 * These are the application-level types that flow through the UI and API.
 * Database column types live in server/src/db/schema.ts; the canonical DB
 * row types are re-exported below (type-only, so drizzle/server code never
 * enters the client bundle).
 *
 * Money rule: all amount fields are integer pence (GBP × 100).
 */

// ─── Canonical DB row types (mirror server/src/db/schema.ts) ─────────────────

export type {
  UserRow,
  UserInsert,
  AccountRow,
  AccountInsert,
  TransactionRow,
  TransactionInsert,
  TransactionLineRow,
  TransactionLineInsert,
  ReceiptRow,
  ReceiptInsert,
  ReceiptExtractionRow,
  ReceiptExtractionInsert,
  InvoiceRow,
  InvoiceInsert,
  InvoiceLineRow,
  InvoiceLineInsert,
  VatReturnDraftRow,
  VatReturnDraftInsert,
  AuditEventRow,
  AuditEventInsert,
} from '../../server/src/db/schema.js';

// ─── Users ────────────────────────────────────────────────────────────────────

export type UserProfile = {
  id: string;
  clerkUserId: string;
  displayName: string;
  email: string;
  utrMasked: string | null;       // e.g. "****5678" — never the full UTR in the UI
  vatRegistered: boolean;
  vatScheme: 'standard' | 'flat_rate' | 'cash_accounting' | null;
  vrn: string | null;             // VAT registration number
  sandboxMode: boolean;           // true = HMRC sandbox
  createdAt: string;              // ISO 8601
};

// ─── Accounts (Chart of Accounts) ─────────────────────────────────────────────

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export type Account = {
  id: string;
  code: string;       // e.g. "4000"
  name: string;
  type: AccountType;
  description: string | null;
  isSystemAccount: boolean;
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export type TransactionSource = 'manual' | 'bank_feed' | 'receipt_ai' | 'import';

export type Transaction = {
  id: string;
  date: string;           // YYYY-MM-DD
  description: string;
  reference: string | null;
  source: TransactionSource;
  totalAmountPence: number;  // sum of all lines; informational
  deletedAt: string | null;
  createdAt: string;
};

export type TransactionLine = {
  id: string;
  transactionId: string;
  accountId: string;
  accountName: string;
  amountPence: number;    // positive = debit; negative = credit
  vatPence: number;
  vatRate: 0 | 5 | 20;
  description: string | null;
};

export type TransactionWithLines = Transaction & { lines: TransactionLine[] };

// ─── Receipts ─────────────────────────────────────────────────────────────────

export type ReceiptAiStatus = 'pending' | 'extracted' | 'failed' | 'skipped';

export type Receipt = {
  id: string;
  userId: string;
  storageKey: string;         // S3/MinIO object key
  fileType: string;           // MIME type
  originalFilename: string | null;
  aiStatus: ReceiptAiStatus;
  aiConfidence: number | null; // 0–1
  transactionId: string | null;
  createdAt: string;
};

export type ReceiptExtraction = {
  id: string;
  receiptId: string;
  field: string;
  suggestedValue: string;
  confidence: number;
  confirmedValue: string | null;
  confirmedAt: string | null;
};

// ─── Invoices ─────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'voided';

export type Invoice = {
  id: string;
  number: string;
  clientName: string;
  clientEmail: string | null;
  clientAddress: string | null;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  subtotalPence: number;
  vatPence: number;
  totalPence: number;
  notes: string | null;
  deletedAt: string | null;
};

export type InvoiceLine = {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitPricePence: number;
  vatRate: 0 | 5 | 20;
  lineNetPence: number;
  lineVatPence: number;
};

export type InvoiceWithLines = Invoice & { lines: InvoiceLine[] };

// ─── VAT Returns ──────────────────────────────────────────────────────────────

export type VatReturnStatus = 'draft' | 'submitted' | 'accepted' | 'rejected';

export type VatReturn = {
  id: string;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: VatReturnStatus;
  // All nine boxes in pence (except where HMRC expects whole pounds — stored as pence throughout)
  box1Pence: number;
  box2Pence: number;
  box3Pence: number;
  box4Pence: number;
  box5Pence: number;
  box6Pence: number;
  box7Pence: number;
  box8Pence: number;
  box9Pence: number;
  hmrcResponse: Record<string, unknown> | null;
  submittedAt: string | null;
};

// ─── Audit events ─────────────────────────────────────────────────────────────

export type AuditActorType = 'user' | 'system' | 'ai_agent';

export type AuditEvent = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: AuditActorType;
  actorId: string;
  diff: Record<string, unknown> | null;
  createdAt: string;
};

// ─── API response envelopes ───────────────────────────────────────────────────

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiError = { ok: false; error: string; code?: string };
export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export function isApiError(r: ApiResponse<unknown>): r is ApiError {
  return !r.ok;
}
