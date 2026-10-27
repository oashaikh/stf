# PLAN.md — STF (Sole Trader Finance)

**Full project plan for AI agents and human contributors.**

Last updated: 2026-10-26
Status: Active development — Phase 1 and Phase 2 partly done

---

## Vision

STF replaces the need for expensive accounting software (Xero, QuickBooks, FreeAgent) for sole traders and small startups. It is fully open source — anyone can clone it, supply their own API keys, and run it themselves or self-host it for others. It handles the complete accounting lifecycle: recording expenses, issuing invoices, calculating VAT and income tax, and submitting directly to HMRC via Making Tax Digital (MTD).

AI (Claude Haiku) automates the tedious parts: reading receipts, suggesting expense categories, pre-filling VAT returns, and flagging anomalies — always as drafts that the user confirms.

---

## Non-goals (explicit)

- Not a payroll system (out of scope for v1)
- Not a multi-currency system (GBP only for v1)
- Not a bank account (we read feeds; we do not hold money)
- Not a fully-managed SaaS (open source; users run it themselves)
- No tax advice (we compute; the user is responsible for the filing)

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Same as URDF; proven stack |
| Styling | Tailwind CSS | Fast, consistent, small bundle |
| State | Zustand | Lightweight; no Redux overhead |
| Backend API | Vercel serverless routes in `api/` (TypeScript), London region (`lhr1`) | Zero-ops hosting |
| Scheduled jobs | Vercel Cron (`vercel.json`, routes in `api/cron/`) | HMRC token refresh |
| Local control plane | Fastify (`server/`) | Runs the scheduled jobs locally only; serves no user routes |
| Database | Neon Postgres (London) via Drizzle ORM | Relational integrity for financial data |
| Auth | Single-owner password | Signed session cookie; OWNER_PASSWORD + SESSION_SECRET |
| AI | Anthropic Claude Haiku | Vision for receipts; fast; cheap; user-supplied key |
| PDF generation | `@react-pdf/renderer` | Invoice PDF export |
| Object storage | S3-compatible (MinIO for self-host) | Receipt/document storage |
| Open banking | TrueLayer or GoCardless (user-supplied) | Bank transaction feed (Phase 3) |
| HMRC | MTD VAT API v1, MTD Income Tax v2 | Tax submissions |
| Testing | Vitest | Unit tests (Playwright E2E is not set up yet) |
| CI/CD | GitHub Actions + Vercel | Matches URDF pipeline |

---

## Phase roadmap

### Phase 1 — Foundation (current)

**Goal:** A working local app where a sole trader can record income and expenses, see their P&L, and export a URDF-style report.

Milestone checklist:
- [x] Project scaffold
- [x] Database schema + migrations (Drizzle)
- [x] Auth — single-owner password login
- [x] Authenticator-app second factor (TOTP) with recovery codes; feeds `Gov-Client-Multi-Factor`
- [ ] Chart of accounts (seeded defaults, user-editable)
- [ ] Manual transaction entry (income + expense)
- [ ] Receipt upload (image/PDF)
- [ ] Claude Haiku receipt extraction (draft → user confirmation)
- [ ] Basic P&L report (date range, income vs expenses)
- [ ] Invoice creation and PDF export
- [ ] Expense list with search and filter
- [x] Unit tests: money arithmetic, VAT calculation
- [x] `.env.example` with all required keys documented
- [x] `docker-compose.yml` for local Postgres + MinIO

### Phase 2 — VAT

**Goal:** Full VAT return workflow with HMRC MTD submission.

Milestone checklist:
- [x] HMRC OAuth flow (user connects their Government Gateway account)
- [x] MTD VAT obligations fetch (what returns are due)
- [x] VAT return builder (pulls transactions by period, computes nine boxes)
- [x] User review and confirmation screen
- [x] HMRC MTD VAT submit (sandbox first, then production)
- [x] VAT return history and status tracking
- [ ] Flat Rate Scheme support
- [ ] Cash accounting basis support
- [ ] Integration tests against HMRC sandbox

### Phase 3 — Income Tax (Self-Assessment)

**Goal:** Pre-populate self-assessment figures and submit via MTD Income Tax.

Milestone checklist:
- [ ] Tax year summary (income, expenses, profit, personal allowance)
- [ ] Income tax band calculation (basic/higher/additional rate — current tax year bands)
- [ ] Class 2 and Class 4 NIC calculation
- [ ] MTD Income Tax — cumulative period summary submission
- [ ] End-of-period statement (EOPS)
- [ ] Final declaration
- [ ] Self-employed allowances (Annual Investment Allowance, trading allowances)
- [ ] Tax estimate widget (running estimate on dashboard)

### Phase 4 — Bank Feed Integration

**Goal:** Automatic transaction import from bank accounts.

Milestone checklist:
- [ ] Open Banking provider integration (TrueLayer or GoCardless — user-supplied API key)
- [ ] Bank account connection flow
- [ ] Transaction import + deduplication
- [ ] AI-assisted categorisation suggestions (Haiku)
- [ ] Bank reconciliation workflow (match imported to recorded)
- [ ] Unmatched transaction alerts

### Phase 5 — Advanced Automation

**Goal:** Reduce manual entry to near-zero for common workflows.

Milestone checklist:
- [ ] Email receipt ingestion (forward receipts to a unique address)
- [x] Recurring transaction templates
- [ ] Mileage log (HMRC approved mileage rates)
- [ ] AI anomaly detection (unusual amounts, duplicate receipts)
- [ ] Automated VAT return draft (scheduled, requires user approval before submit)

---

## Feature deep-dives

### Receipt extraction (Claude Haiku)

**Agent SOP:** to be written in the agent SOP folder when this feature is built (see Agent SOPs below)

Flow:
1. User uploads image or PDF of a receipt.
2. File stored in S3-compatible storage; `receipts` row created.
3. Haiku called with vision prompt (see `src/lib/receiptPrompt.ts`).
4. Response parsed into `receipt_extractions` rows (one per field).
5. UI shows extraction results with confidence indicators.
6. User reviews, corrects any field, and clicks Confirm.
7. On confirm: `transactions` + `transaction_lines` + `audit_event` created.
8. Receipt linked to transaction.

**Prompt design principles:**
- Ask for JSON only; no prose.
- Include today's date in the prompt to help Haiku resolve relative dates.
- Ask for amount in pence explicitly to avoid decimal confusion.
- Ask for a `confidence` score 0–1 for the overall extraction.
- Ask Haiku to return `"error": "not_a_receipt"` for non-receipt images.
- Store the full raw Haiku response in `receipts.ai_raw_output` for audit.

**Supported file types:** JPEG, PNG, WEBP, PDF (first page via PDF-to-image).

### VAT return builder

**Workflow:** `docs/workflows/vat-return.md`

The nine MTD VAT boxes:
| Box | Description | Computed from |
|---|---|---|
| 1 | VAT due on sales | SUM(transaction_lines.vat_pence) where account.type=income, period |
| 2 | VAT due on acquisitions from EC | 0 for most sole traders |
| 3 | Total VAT due (Box 1 + Box 2) | Computed |
| 4 | VAT reclaimed on purchases | SUM(transaction_lines.vat_pence) where account.type=expense, period |
| 5 | Net VAT to pay / reclaim (Box 3 - Box 4) | Computed |
| 6 | Total value of sales (ex VAT) | SUM(net amounts) income, period |
| 7 | Total value of purchases (ex VAT) | SUM(net amounts) expense, period |
| 8 | Total value of EC supplies | 0 |
| 9 | Total value of EC acquisitions | 0 |

All values submitted in pence; HMRC expects pounds with 2 decimal places — convert at the API boundary only.

### Invoice system

Invoices follow the number sequence `INV-NNNN` (user-configurable prefix).

PDF invoices are generated server-side using `@react-pdf/renderer` and include:
- Business name, address, VAT number (if applicable)
- Client details
- Line items with quantity, unit price, VAT rate, subtotal
- VAT summary
- Total due
- Bank details / payment instructions (user-configured)
- Unique invoice number and issue/due dates

On payment confirmation, the invoice generates a corresponding transaction in the ledger.

### Tax estimate widget

Shows a running estimate on the dashboard:

```
Profit to date: £X,XXX
Estimated tax due: £XXX
National Insurance: £XXX
---
Set aside: £X,XXX (suggested 30% of profit)
```

Income tax and Class 4 NIC bands, rates and allowances live in `src/lib/taxBands.ts`, keyed by tax year. Do not copy the figures into docs.

Never hard-code band values in components.

### Recurring transaction templates

**Workflow:** `docs/workflows/recurring-entries.md`

Templates for regular income and costs — rent, subscriptions, salaries — that create draft entries on a schedule. The owner confirms entries from the Expenses list; nothing is auto-confirmed.

A cron job (daily, 5 AM UTC) scans due templates and generates drafts through the posting function. A template never creates the same date twice: a run ledger with a unique key on (template, date) ensures idempotency even with overlapping runs. A date that falls inside a locked VAT period is skipped without aborting the whole run.

Month-end dates clamp to the stored anchor day, so a 31st template goes 31 Jan → 28/29 Feb → 31 Mar, never drifting to the 28th.

---

## HMRC MTD integration

### Authentication

HMRC uses OAuth 2.0 with Government Gateway.

Flow:
1. User clicks "Connect to HMRC" in Settings.
2. App redirects to HMRC authorization endpoint with:
   - `client_id` (user-supplied from their HMRC developer application)
   - `redirect_uri` (the app's callback URL)
   - `scope` `read:vat write:vat` (or income tax scopes)
   - `state` (CSRF token)
3. User signs in with Government Gateway and grants access.
4. HMRC redirects back with `code`.
5. Server exchanges `code` for `access_token` + `refresh_token`.
6. Tokens stored encrypted in the database.
7. Server refreshes access token automatically before expiry (scheduled job).

**HMRC sandbox:** Uses separate client credentials. Default for all new installations.

### VAT submission API call

```
POST /organisations/vat/{vrn}/returns
Authorization: Bearer <access_token>
Gov-Client-Connection-Method: WEB_APP_VIA_SERVER
Gov-Client-User-IDs: os=<owner-user-id>
Gov-Vendor-Version: stf/<app-version>
Content-Type: application/json

{
  "periodKey": "24A1",
  "vatDueSales": 120.00,
  ...
}
```

**Fraud prevention headers** (`Gov-Client-*`, `Gov-Vendor-*`) are mandatory for MTD. See `src/lib/hmrc/fraudHeaders.ts`.

---

## Open source deployment guide

### Self-hosted (Docker Compose)

```bash
git clone https://github.com/oashaikh/stf
cp .env.example .env.local
# fill in your keys (Anthropic, HMRC sandbox)
docker compose up -d
```

Required keys:
- `ANTHROPIC_API_KEY` — your key from console.anthropic.com
- `OWNER_PASSWORD` + `SESSION_SECRET` — your own values
- `DATABASE_URL` — Postgres connection string
- `STORAGE_ENDPOINT` / `STORAGE_BUCKET` / `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` — S3-compatible
- `HMRC_CLIENT_ID` + `HMRC_CLIENT_SECRET` — from developer.service.hmrc.gov.uk (sandbox first)

### Vercel (zero-ops)

```bash
npm run deploy:preview
npm run deploy:prod
```

Add all env vars in Vercel project settings. Storage: use any S3-compatible provider (AWS S3, Cloudflare R2, Backblaze B2).

---

## Coding standards

See `coding-standards.md`.

**Currency rule:** Integer pence everywhere in the domain. Format only at the view layer.

**Tax rule:** Pure functions only. Never compute tax in a route handler.

**AI rule:** All AI output is `status: 'draft'` until user confirms. No exceptions.

**HMRC rule:** Sandbox by default. Production requires `HMRC_SANDBOX_MODE=false` in env AND a user-level confirmation in Settings.

---

## Agent SOPs

The agent SOP folder (`docs/agents/`) does not exist yet; create it when the first SOP is written. Each SOP is required before its AI feature is built. Planned:

- receipt-extraction — Haiku OCR SOP
- categorisation — expense category suggestion SOP
- anomaly-detection — duplicate/unusual transaction SOP (Phase 5)

Each SOP must define:
1. What data the agent may read.
2. What the agent may write (draft only vs confirmed).
3. What triggers the agent.
4. What the user sees before any output is persisted.
5. What audit event is emitted.
6. The kill switch.

---

## Repository structure

Only folders that exist today are listed. `docs/agents/`, `docs/adr/`, `src/store/`, `src/features/`, `src/hooks/`, `e2e/`, `infra/` and `scripts/` will be created when first needed.

```
stf/
├── AI.md, architectures.md, PLAN.md, README.md, CLAUDE.md, coding-standards.md
├── package.json, vite.config.ts, tsconfig.json, vercel.json, drizzle.config.ts
├── docker-compose.yml           # local Postgres + MinIO
├── .env.example
│
├── src/                         # React frontend
│   ├── main.tsx, App.tsx
│   ├── styles/
│   ├── components/              # Shared UI components
│   ├── pages/                   # Route-level pages
│   ├── lib/                     # Pure domain logic
│   │   ├── money.ts             # formatPence, parsePence
│   │   ├── vat.ts               # VAT calculation functions
│   │   ├── taxBands.ts          # Income tax + NIC bands by year
│   │   ├── receiptPrompt.ts     # Haiku prompt builder
│   │   ├── session.ts, dates.ts
│   │   └── hmrc/                # client.ts, fraudHeaders.ts, vatApi.ts, settingsApi.ts
│   └── model/                   # TypeScript types (mirror DB schema)
│
├── api/                         # Vercel serverless routes (London region)
│   ├── _lib/                    # Shared API code: auth.ts, db.ts, VAT and HMRC helpers
│   ├── auth/                    # login.ts, mfa.ts, logout.ts
│   ├── cron/                    # refresh-hmrc-tokens.ts (Vercel Cron)
│   ├── hmrc/                    # connect.ts, callback.ts, mode.ts, status.ts
│   ├── vat/                     # obligations.ts, preview.ts, filed.ts, history.ts, submit.ts
│   ├── settings/                # vat-number.ts
│   └── me.ts
│
├── server/                      # Local control plane (Fastify), local scheduled jobs only
│   └── src/
│       ├── db/                  # schema.ts, client.ts, migrations/
│       ├── scheduled-jobs/      # Token refresh job
│       └── lib/
│
└── docs/
    ├── workflows/               # Workflow write-ups
    └── runbooks/                # Operational runbooks
```

---

## Key decisions (pre-ADR)

1. **Integer pence for all money** — eliminates floating-point tax errors. Non-negotiable.
2. **AI extractions are always drafts** — user must confirm before any record is persisted. Non-negotiable.
3. **HMRC sandbox by default** — production mode requires explicit user opt-in per account. Non-negotiable.
4. **Open source, bring-your-own-keys** — no central server, no analytics, no phoning home. Core to the project identity.
5. **Drizzle ORM over raw SQL** — type-safe schema, migration-first, small footprint.
6. **No floating-point in the domain layer** — Drizzle schema uses `integer` for all pence columns.
7. **Single-owner password auth** — the auth boundary is in `api/_lib/auth.ts`.
