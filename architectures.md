# architectures.md — STF (Sole Trader Finance)

## Purpose

Architectural companion to `AI.md`. Any AI coding agent must use this file when turning the readiness layers in `AI.md` into concrete software architecture.

The governing principle:

> Do not build screens first. Build operating truth first.

---

## Required read order for AI agents

1. `AI.md`
2. `architectures.md` (this file)
3. `PLAN.md`
4. `docs/workflows/<workflow-name>.md`
5. `docs/data-model.md`
6. `docs/adr/*.md` (relevant)
7. Source code

---

## System boundary

### Owns
- All financial records (transactions, expenses, invoices, receipts)
- All tax calculations (VAT, Income Tax, Corporation Tax)
- All HMRC submission workflows
- Audit trail for all mutations and submissions
- AI extraction drafts and their confirmation status

### Does not own
- Payment processing (Stripe owns card processing)
- HMRC identity verification (HMRC owns OAuth)
- Email delivery (email provider owns transport)
- Bank transaction feed (Open Banking provider owns the feed)

### Upstream systems
| System | Sends | Trust level | Failure behaviour |
|---|---|---|---|
| HMRC MTD API | Tax obligations, submission receipts | High (authoritative) | Store last-known state; surface error to user |
| Open Banking API | Transaction feed | Medium | Queue retry; flag transactions as unsynced |
| Anthropic API (Haiku) | Receipt extractions | Low (draft only) | Fall back to manual entry; log failure |

### Downstream systems
| System | Receives | Dependency | Failure behaviour |
|---|---|---|---|
| HMRC MTD | VAT returns, income tax updates | Hard (prod) | Surface error; prevent re-submit; audit log |
| Email provider | Notifications, invoice PDFs | Soft | Queue and retry; never block the main flow |

---

## Currency rule

**All monetary amounts are stored as integer pence (GBP × 100).**

```typescript
// Good
const amount: number = 1299; // £12.99

// Never
const amount: number = 12.99; // floating-point — forbidden
```

A `formatPence(pence: number): string` utility in `src/lib/money.ts` handles all display formatting. No component may format currency ad-hoc.

VAT is calculated as: `vatPence = Math.round(netPence * vatRate)` where `vatRate` is a rational expressed as numerator/denominator (e.g. 20/100 = 0.2). Rounding is always `Math.round` (half-up), matching HMRC's expected behaviour.

---

## Data architecture

### Core tables

```sql
-- The single owner row; created on first login
CREATE TABLE users (
    id UUID PRIMARY KEY,
    clerk_user_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NULL,
    business_name TEXT NULL,
    business_type TEXT NOT NULL DEFAULT 'sole_trader',
    utr TEXT NULL,                      -- Unique Taxpayer Reference (encrypted at rest)
    vat_number TEXT NULL,               -- if VAT registered
    vat_scheme TEXT NULL,               -- 'standard', 'flat_rate', 'cash_accounting'
    flat_rate_percent INTEGER NULL,     -- pence per 100 if flat rate scheme
    accounting_basis TEXT NOT NULL DEFAULT 'accruals', -- 'accruals' | 'cash'
    tax_year_end TEXT NOT NULL DEFAULT '04-05', -- MM-DD
    hmrc_access_token TEXT NULL,        -- encrypted; user-supplied
    hmrc_refresh_token TEXT NULL,       -- encrypted; user-supplied
    hmrc_token_expires_at TIMESTAMPTZ NULL,
    hmrc_sandbox_mode BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chart of accounts (user-customisable, seeded from defaults)
CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    code TEXT NOT NULL,                 -- e.g. '4000', '5000'
    name TEXT NOT NULL,
    account_type TEXT NOT NULL,         -- 'income' | 'expense' | 'asset' | 'liability' | 'equity'
    tax_category TEXT NULL,             -- HMRC category slug
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, code)
);

-- The canonical ledger. Every financial movement lives here.
CREATE TABLE transactions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    date DATE NOT NULL,
    description TEXT NOT NULL,
    reference TEXT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'confirmed' | 'reconciled' | 'voided'
    source TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'bank_feed' | 'receipt_ai' | 'import'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL,        -- soft-delete only
    CONSTRAINT transactions_status_check
        CHECK (status IN ('draft', 'confirmed', 'reconciled', 'voided'))
);

-- Double-entry lines for each transaction
CREATE TABLE transaction_lines (
    id UUID PRIMARY KEY,
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    account_id UUID NOT NULL REFERENCES accounts(id),
    amount_pence INTEGER NOT NULL,      -- positive = debit, negative = credit
    vat_pence INTEGER NOT NULL DEFAULT 0,
    vat_rate_percent INTEGER NOT NULL DEFAULT 0, -- e.g. 20 for 20%
    description TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Receipts and uploaded documents
CREATE TABLE receipts (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    transaction_id UUID NULL REFERENCES transactions(id),
    file_key TEXT NOT NULL,             -- storage object key
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    upload_status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'ready' | 'failed'
    ai_status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'extracted' | 'failed' | 'skipped'
    ai_model TEXT NULL,                 -- e.g. 'claude-haiku-4-5-20251001'
    ai_confidence NUMERIC(4,3) NULL,    -- 0.000–1.000
    ai_raw_output JSONB NULL,           -- full AI response for audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT receipts_upload_status_check
        CHECK (upload_status IN ('pending', 'ready', 'failed')),
    CONSTRAINT receipts_ai_status_check
        CHECK (ai_status IN ('pending', 'extracted', 'failed', 'skipped'))
);

-- AI-suggested field values awaiting user confirmation
CREATE TABLE receipt_extractions (
    id UUID PRIMARY KEY,
    receipt_id UUID NOT NULL REFERENCES receipts(id),
    field TEXT NOT NULL,                -- 'date' | 'vendor' | 'total_pence' | 'vat_pence' | 'category'
    suggested_value TEXT NOT NULL,
    confidence NUMERIC(4,3) NULL,
    confirmed_value TEXT NULL,
    confirmed_at TIMESTAMPTZ NULL,
    confirmed_by_user_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invoices issued by the user to their clients
CREATE TABLE invoices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    public_number TEXT NOT NULL,        -- e.g. 'INV-0042'
    client_name TEXT NOT NULL,
    client_email TEXT NULL,
    client_address TEXT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'sent' | 'paid' | 'overdue' | 'voided'
    subtotal_pence INTEGER NOT NULL DEFAULT 0,
    vat_pence INTEGER NOT NULL DEFAULT 0,
    total_pence INTEGER NOT NULL DEFAULT 0,
    notes TEXT NULL,
    transaction_id UUID NULL REFERENCES transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL,
    UNIQUE (user_id, public_number),
    CONSTRAINT invoices_status_check
        CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'voided'))
);

-- Invoice line items
CREATE TABLE invoice_lines (
    id UUID PRIMARY KEY,
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    description TEXT NOT NULL,
    quantity NUMERIC(10,4) NOT NULL DEFAULT 1,
    unit_price_pence INTEGER NOT NULL,
    vat_rate_percent INTEGER NOT NULL DEFAULT 0,
    subtotal_pence INTEGER NOT NULL,    -- quantity × unit_price_pence
    vat_pence INTEGER NOT NULL,
    total_pence INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- VAT return periods
CREATE TABLE vat_returns (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    period_key TEXT NOT NULL,           -- HMRC period key e.g. '24A1'
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    due_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'draft' | 'submitted' | 'accepted' | 'rejected'
    vat_due_sales_pence INTEGER NULL,
    vat_due_acquisitions_pence INTEGER NULL,
    total_vat_due_pence INTEGER NULL,
    vat_reclaimed_pence INTEGER NULL,
    net_vat_due_pence INTEGER NULL,
    total_value_sales_pence INTEGER NULL,
    total_value_purchases_pence INTEGER NULL,
    hmrc_submission_id TEXT NULL,
    hmrc_submitted_at TIMESTAMPTZ NULL,
    hmrc_response JSONB NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, period_key),
    CONSTRAINT vat_returns_status_check
        CHECK (status IN ('open', 'draft', 'submitted', 'accepted', 'rejected'))
);

-- Full audit log
CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id UUID NULL,
    actor_type TEXT NOT NULL DEFAULT 'user', -- 'user' | 'system' | 'ai_agent'
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID NULL,
    ip_address INET NULL,
    before_snapshot JSONB NULL,
    after_snapshot JSONB NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT audit_events_actor_type_check
        CHECK (actor_type IN ('user', 'system', 'ai_agent'))
);
```

---

## Layer architecture

| Layer | Where | Notes |
|---|---|---|
| Domain / business rules | `src/lib/` | Pure TS: money arithmetic, VAT calculation, tax bands, HMRC payload builders |
| Data model types | `src/model/` | TypeScript types mirroring DB schema |
| State | `src/store/` | Zustand stores; no financial logic here |
| API routes | `api/` | Vercel serverless functions; thin — call domain layer |
| Control plane | `server/src/` | Fastify; handles jobs, HMRC token refresh, scheduled tasks |
| UI | `src/components/` + `src/pages/` | React; display only |
| AI agents | `api/receipts/` + `docs/agents/` | Haiku extraction; always draft |
| Infra | `infra/` | Docker compose (local), k3s (self-hosted), AWS Fargate |

---

## AI agent architecture

### Receipt extraction agent

SOP: `docs/agents/receipt-extraction.md`

```
User uploads receipt image/PDF
→ api/receipts/extract.ts receives file
→ Store raw file in object storage (S3 / local)
→ Create receipts row (upload_status=ready, ai_status=pending)
→ Call Claude Haiku with vision prompt
→ Parse response into receipt_extractions rows (status=pending)
→ Return draft to UI for user review
→ User confirms/corrects each field
→ On confirmation: create transaction + transaction_lines
→ Link receipt to transaction
→ Emit audit_event: receipt.confirmed
```

**Claude Haiku prompt contract** (in `src/lib/receiptPrompt.ts`):

The prompt must instruct Haiku to return structured JSON only:
```json
{
  "date": "YYYY-MM-DD or null",
  "vendor": "string or null",
  "total_pence": "integer or null",
  "vat_pence": "integer or null",
  "currency": "GBP or other",
  "confidence": 0.0–1.0,
  "notes": "any caveats"
}
```

If the image is not a receipt, Haiku must return `{ "error": "not_a_receipt" }`.

---

## HMRC MTD architecture

HMRC Making Tax Digital APIs used:
- MTD VAT API v1 — VAT return obligations, submission, view
- MTD Income Tax API v2 — self-employment income, allowances (future)
- Corporation Tax API (future)

All HMRC calls go through `src/lib/hmrc/client.ts` which:
- Reads user's token from DB (decrypted)
- Refreshes the token if expired (via server job)
- Adds `Authorization: Bearer <token>` header
- Logs full request + response to audit_events
- Throws structured `HmrcError` with HMRC error code on failure
- In sandbox mode: uses `https://test-api.service.hmrc.gov.uk`
- In production: uses `https://api.service.hmrc.gov.uk`

**No component or route may call the HMRC API directly.** All calls go through `src/lib/hmrc/client.ts`.

---

## Permission model

All records are user-scoped. The permission model at launch is simple:

- Authenticated = can access own records
- Unauthenticated = no access

Every API route must extract `userId` from the signed session cookie server-side and scope all queries to that userId. No frontend-passed userId is trusted.

---

## ADR naming convention

`docs/adr/NNNN-short-title.md`

Start at `0001`. Use the same ADR template as URDF Studio (`architectures.md` in that repo).
