# STF-2: Database schema + migrations (Drizzle)

> Machine-generated plan (model `opus`, effort `high`) for
> http://oashaikh.local:9999/local-development/projects/9203edf1-6363-4ae0-9cde-3dfee92f1a09/issues/d185f6f0-55d2-408a-a9c0-2bb8871c8872. Progress below is written by the orchestrator; the
> database copy is authoritative — editing this file does not change execution.

## Assumptions

- The Drizzle schema, connection, and migrations live under server/src/db/ (schema.ts, client.ts, migrations/), per PLAN.md and the existing src/model/types.ts header comment.
- vat_returns is out of scope for STF-2: it is absent from the ticket's explicit table list; it belongs to a later VAT ticket even though architectures.md and types.ts describe it.
- Enumerated columns use pgEnum (drizzle-orm@0.30 lacks the check() constraint builder); this generates CREATE TYPE statements and still enforces allowed values.
- 'No floating-point / no numeric/decimal' is enforced literally: money is integer pence, confidence is integer thousandths (0-1000), and invoice quantity is an integer scaled x10000 (4 dp) - the schema contains zero numeric/decimal/real/double/float columns.
- 'Every financial table has deleted_at' applies to the canonical financial-record tables (transactions, receipts, invoices); child/line tables and the append-only audit_events do not carry an independent deleted_at, matching architectures.md.
- DATABASE_URL is supplied via the environment (already in .env.example and docker-compose); no dotenv dependency is added, honoring the minimal-dependency policy.
- ESLint is configured/managed outside this ticket; the schema lives under server/ (outside `eslint src`) so lint is unaffected, and the only src-side edit (src/model/types.ts) is already linted.

## Out of scope

- vat_returns table and any VAT-return / tax-return schema.
- api/_lib/db.ts, Fastify control-plane wiring, jobs, and any HTTP routes or query/repository layer.
- Seeding default chart-of-accounts rows or any data seeds.
- Encryption-at-rest implementation for UTR and HMRC tokens (columns exist; encryption is a later concern).
- Any UI, page, or store changes beyond keeping existing type imports compiling.

## Tasks

- [x] **Task 1: Drizzle tooling + config + DB client + server tsconfig + users table**
  - Intent: Stand up the Drizzle project so migrations can be generated and applied, and define the first (dependency-free) table. Done when drizzle.config.ts, a typecheckable server/ TypeScript project, a Postgres client, and migration npm scripts exist, and server/src/db/schema.ts defines the users table plus the shared enums it needs. No migration is generated yet (deferred to the single initial-migration task) but the schema must typecheck.
  - Files: `drizzle.config.ts`, `server/tsconfig.json`, `server/src/db/schema.ts`, `server/src/db/client.ts`, `package.json`
  - [x] drizzle.config.ts uses drizzle-kit defineConfig with dialect 'postgresql', schema './server/src/db/schema.ts', out './server/src/db/migrations', and dbCredentials.url from process.env.DATABASE_URL.
  - [x] package.json gains scripts: db:generate ('drizzle-kit generate'), db:migrate ('drizzle-kit migrate'), db:push ('drizzle-kit push'); and the existing 'typecheck' script is extended to also run 'tsc -p server/tsconfig.json --noEmit'.
  - [x] server/tsconfig.json compiles server/src with strict:true, noEmit:true, moduleResolution 'bundler', types:['node'].
  - [x] server/src/db/schema.ts defines the users table matching architectures.md (uuid PK defaultRandom, clerk_user_id unique, email, business_type/vat_scheme/accounting_basis as pgEnum, flat_rate_percent integer, hmrc_* token columns, hmrc_sandbox_mode boolean default true, created_at/updated_at timestamptz defaultNow); no numeric/decimal/real/double/float columns.
  - [x] server/src/db/client.ts exports a drizzle instance built on the `postgres` driver reading process.env.DATABASE_URL.
  - [x] npm run typecheck (root + server) passes; npm run build and npm run lint remain green.
  - Risk: drizzle-orm@0.30 predates the check() constraint builder, so enumerated columns use pgEnum (generates CREATE TYPE) rather than TEXT+CHECK. No dotenv dependency is added; DATABASE_URL is supplied via the environment (already documented in .env.example).
  - Commit: `ccd149e783eb`

- [x] **Task 2: Add ledger tables: accounts, transactions, transaction_lines** (after 1)
  - Intent: Define the chart of accounts and the double-entry ledger. Done when accounts, transactions, and transaction_lines are added to schema.ts with correct FKs, integer-pence money columns, status/source enums, and deleted_at on transactions.
  - Files: `server/src/db/schema.ts`
  - [x] accounts: uuid PK, user_id FK -> users.id, code, name, account_type (pgEnum: income|expense|asset|liability|equity), tax_category nullable, is_system boolean, unique(user_id, code).
  - [x] transactions: uuid PK, user_id FK, date (date), description, reference nullable, status pgEnum (draft|confirmed|reconciled|voided), source pgEnum (manual|bank_feed|receipt_ai|import), created_at/updated_at timestamptz, and deleted_at timestamptz nullable (soft-delete).
  - [x] transaction_lines: uuid PK, transaction_id FK -> transactions.id, account_id FK -> accounts.id, amount_pence integer, vat_pence integer default 0, vat_rate_percent integer default 0, description nullable.
  - [x] All money columns are integer; no numeric/decimal/real/double/float column types are introduced.
  - [x] npm run typecheck passes; build and lint remain green.
  - Risk: transaction_lines has no deleted_at: lines are immutable children voided via their parent transaction, consistent with architectures.md.
  - Commit: `5dc06bda3ad4`

- [x] **Task 3: Add receipts and receipt_extractions tables** (after 2)
  - Intent: Define receipt storage metadata and the AI-draft extraction rows. Done when both tables exist with deleted_at on receipts and confidence stored as a scaled integer (no numeric types).
  - Files: `server/src/db/schema.ts`
  - [x] receipts: uuid PK, user_id FK, transaction_id nullable FK -> transactions.id, file_key, file_name, mime_type, size_bytes integer, upload_status pgEnum (pending|ready|failed), ai_status pgEnum (pending|extracted|failed|skipped), ai_model nullable, ai_confidence stored as integer thousandths (0-1000) NOT numeric, ai_raw_output jsonb nullable, created_at timestamptz, deleted_at timestamptz nullable.
  - [x] receipt_extractions: uuid PK, receipt_id FK -> receipts.id, field, suggested_value, confidence as integer thousandths (0-1000) NOT numeric, confirmed_value nullable, confirmed_at nullable, confirmed_by_user_id nullable, created_at timestamptz.
  - [x] No numeric/decimal/real/double/float column types anywhere in these tables (confidence is integer-scaled).
  - [x] npm run typecheck passes; build and lint remain green.
  - Risk: architectures.md wrote ai_confidence/confidence as NUMERIC(4,3); the ticket forbids numeric/decimal/float, so confidence is represented as integer thousandths (0.000-1.000 -> 0-1000). Document the scale in a comment.
  - Commit: `834fdcc9893b`

- [x] **Task 4: Add invoices, invoice_lines, and audit_events tables** (after 3)
  - Intent: Complete the schema with invoicing and the audit trail. Done when all three tables exist, invoices carries deleted_at, invoice_lines quantity is a scaled integer, and audit_events is append-only with jsonb/inet columns.
  - Files: `server/src/db/schema.ts`
  - [x] invoices: uuid PK, user_id FK, public_number, client_name/email/address, issue_date/due_date (date), status pgEnum (draft|sent|paid|overdue|voided), subtotal_pence/vat_pence/total_pence integer, notes nullable, transaction_id nullable FK, created_at/updated_at timestamptz, deleted_at timestamptz nullable, unique(user_id, public_number).
  - [x] invoice_lines: uuid PK, invoice_id FK -> invoices.id, description, quantity as integer scaled x10000 (4 dp) NOT numeric, unit_price_pence integer, vat_rate_percent integer, subtotal_pence/vat_pence/total_pence integer.
  - [x] audit_events: uuid PK, occurred_at timestamptz defaultNow, user_id nullable, actor_type pgEnum (user|system|ai_agent), action, resource_type, resource_id nullable, ip_address inet nullable, before_snapshot/after_snapshot jsonb nullable, metadata jsonb notNull default '{}'.
  - [x] No numeric/decimal/real/double/float column types; all money is integer pence and quantity is integer-scaled.
  - [x] npm run typecheck passes; build and lint remain green.
  - Risk: invoice_lines/audit_events have no deleted_at: line items are children of the (soft-deletable) invoice, and audit_events is an append-only immutable log per architectures.md.
  - Commit: `14d17dee6267`

- [x] **Task 5: Mirror the schema in src/model/types.ts via inferred row types** (after 4)
  - Intent: Satisfy 'TypeScript types in src/model/types.ts mirror the schema' without drifting. Done when schema.ts exports $inferSelect/$inferInsert row types for all nine tables and src/model/types.ts re-exports them (type-only) as the canonical DB row types, reconciling the few enum values that diverge from architectures.md (e.g. vat scheme 'cash_accounting').
  - Files: `server/src/db/schema.ts`, `src/model/types.ts`
  - [x] schema.ts exports inferred row types (e.g. UserRow = typeof users.$inferSelect, and Insert variants) for users, accounts, transactions, transaction_lines, receipts, receipt_extractions, invoices, invoice_lines, audit_events.
  - [x] src/model/types.ts re-exports those DB row types using `import type` so no runtime/drizzle code enters the client bundle.
  - [x] Existing UI-facing view-model types remain but any enum union that contradicts the schema for an in-scope table is reconciled to the schema's values.
  - [x] npm run build, npm run typecheck, and npm run lint all pass (no page/component using these types breaks).
  - Risk: Editing exported enum unions could break importing pages; keep changes additive where possible and adjust only genuine contradictions. Use `import type` to avoid pulling drizzle-orm/postgres into the Vite client bundle.
  - Commit: `54e8524579df`

- [x] **Task 6: Generate the initial migration and apply it to docker-compose Postgres** (after 5)
  - Intent: Produce the single initial migration and prove it applies cleanly to a fresh database. Done when drizzle-kit generate emits SQL under server/src/db/migrations and drizzle-kit migrate applies it to the docker-compose Postgres with all nine tables created and the schema reported in sync.
  - Files: `server/src/db/migrations/`
  - [x] With `docker compose up -d` running and DATABASE_URL set to the local Postgres, `npm run db:generate` produces a migration (SQL + meta journal) under server/src/db/migrations/.
  - [x] `npm run db:migrate` applies cleanly against a freshly-created database with no errors.
  - [x] All nine tables exist afterwards (users, accounts, transactions, transaction_lines, receipts, receipt_extractions, invoices, invoice_lines, audit_events), verifiable via information_schema.
  - [x] Re-running db:generate reports no pending changes (schema and migration are in sync).
  - [x] npm run typecheck, build, and lint remain green.
  - Risk: Requires a running local Postgres from docker-compose and DATABASE_URL in the environment. Generating one migration only after the full schema exists avoids migration churn.
  - Commit: `00d9722035ac`

- [x] **Task 7: Add automated guard test: no floating-point columns + deleted_at coverage** (after 6)
  - Intent: Encode the ticket's headline acceptance criteria as a CI test so regressions are caught. Done when a vitest test reads the generated migration SQL and asserts no floating-point/numeric/decimal/money column types anywhere and that every financial-record table carries deleted_at.
  - Files: `server/src/db/schema.test.ts`
  - [x] A vitest test reads the generated migration SQL from server/src/db/migrations/ and fails if any column type matches real, double precision, float4, float8, numeric, decimal, or money.
  - [x] The test asserts deleted_at is present on transactions, receipts, and invoices (the soft-deletable financial-record tables).
  - [x] npm test passes with the new test included, and typecheck/build/lint remain green.
  - Risk: Default vitest environment is node (no vitest.config), so fs access to the migrations directory works. The test depends on the migration SQL produced in the previous task.
  - Commit: `358aa9c48fc3`

- [x] **Task 8: Fix: resolve validation failures** (after 7)
  - Intent: ### lint: `npm run lint` (exit=2, timed_out=False)
```
> stf@0.1.0 lint
> eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0



Oops! Something went wrong! :(

ESLint: 8.57.1

ESLint couldn't find a configuration file. To set up a configuration file for this project, please run:

    npm init @eslint/config

ESLint looked for configuration files in /Users/oashaikh/Projects/PlaneServer/runtime/worktrees/STF-2/src and its ancestors. If it found none, it then looked in your home directory.

If you think you already have a configuration file or if you need more help, please stop by the ESLint Discord server: https://eslint.org/chat
```

### lint: `npm run lint` (exit=2, timed_out=False)
```
> stf@0.1.0 lint
> eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0



Oops! Something went wrong! :(

ESLint: 8.57.1

ESLint couldn't find a configuration file. To set up a configuration file for this project, please run:

    npm init @eslint/config

ESLint looked for configuration files in /Users/oashaikh/Projects/PlaneServer/runtime/worktrees/STF-2/src and its ancestors. If it found none, it then looked in your home directory.

If you think you already have a configuration file or if you need more help, please stop by the ESLint Discord server: https://eslint.org/chat
```

### lint: `npm run lint` (exit=2, timed_out=False)
```
> stf@0.1.0 lint
> eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0



Oops! Something went wrong! :(

ESLint: 8.57.1

ESLint couldn't find a configuration file. To set up a configuration file for this project, please run:

    npm init @eslint/config

ESLint looked for configuration files in /Users/oashaikh/Projects/PlaneServer/runtime/worktrees/STF-2/src and its ancestors. If it found none, it then looked in your home directory.

If you think you already have a configuration file or if you need more help, please stop by the ESLint Discord server: https://eslint.org/chat
```
  - Commit: `f5001f422262`

- [x] **Task 9: Fix: resolve validation failures** (after 8)
  - Intent: ### build: `npm run build` (exit=2, timed_out=False)
```
> stf@0.1.0 build
> tsc -p tsconfig.app.json --noEmit && vite build

src/lib/hmrc/client.ts(17,31): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
src/lib/hmrc/client.ts(68,28): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
src/main.tsx(7,36): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
```

### build: `npm run build` (exit=2, timed_out=False)
```
> stf@0.1.0 build
> tsc -p tsconfig.app.json --noEmit && vite build

src/lib/hmrc/client.ts(17,31): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
src/lib/hmrc/client.ts(68,28): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
src/main.tsx(7,36): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
```

### build: `npm run build` (exit=2, timed_out=False)
```
> stf@0.1.0 build
> tsc -p tsconfig.app.json --noEmit && vite build

src/lib/hmrc/client.ts(17,31): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
src/lib/hmrc/client.ts(68,28): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
src/main.tsx(7,36): error TS2339: Property 'env' does not exist on type 'ImportMeta'.
```
  - Commit: `762b2652b472`
