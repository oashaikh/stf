# STF-4: Chart of accounts: default UK sole-trader accounts, archive flag and accounts API

> Machine-generated plan (model `claude-sonnet-5-5`, effort `medium`) for
> the ticket. Progress below is written by the orchestrator; the
> database copy is authoritative — editing this file does not change execution.
> A task's [x] is the orchestrator's record that the task finished; the
> criteria beneath it are what the planner asked for, not individually
> verified — no per-criterion outcome is recorded anywhere.
> Prose written under a task entry is kept across progress ticks and is
> the place to record analysis. So are edits to the entry's Intent, Files,
> criteria and Risk bullets once the file exists; only its heading's mark and
> the Commit bullet are re-rendered from the database.

## Assumptions

- Vercel file routing exposes api/accounts.ts at /api/accounts; rename and archive are PATCH with the id in the body, so no dynamic [id] route is needed.
- Migration 0006 is hand-written with a snapshot, because drizzle-kit generate may need a database; the orchestrator validates it against a real database.
- Audit events use actorType 'user' and a null ipAddress (minimum data).
- No other live plan touches the accounts or schema files; STF-61's files do not overlap.

## Out of scope

- Any accounts UI (separate ticket)
- Seeding on login
- Transaction posting rules and VAT box computation from account type
- Hard-delete protection beyond never exposing delete
- Changing account type via API (always refused)

## Tasks

- [x] **Task 1: Add accounts.archived_at column and migration 0006**
  - Intent: Add a nullable archivedAt timestamptz column to the accounts table in schema.ts. Hand-write migration 0006 (ALTER TABLE accounts ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone) and add its journal entry. Add a 0006 snapshot copied from 0005 with the new column, so drizzle-kit generate stays a no-op and the graph keeps a single head. It must apply on a fresh database and on one at 0005. The unique (user_id, code) index already backs the owner filter and the code ordering, so no new index is needed; say so in a comment.
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/0006_accounts_archived_at.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0006_snapshot.json`, `server/src/db/schema.test.ts`
  - Acceptance criteria the planner set:
    - schema.ts accounts has a nullable archivedAt column mapped to archived_at
    - Migration 0006 uses ADD COLUMN IF NOT EXISTS and has no numeric/float types
    - The journal has idx 6 with a 'when' value greater than 0005's, and the snapshot id/prevId chain to 0005
    - A schema.test.ts assertion checks that migrations contain archived_at on accounts
    - npm run typecheck and npm test pass
  - Risk: Opus at high: schema and migration work. The hand-built snapshot must match what drizzle-kit would generate. No Docker is available, so the orchestrator validates applying it to a database.
  - Commit: `adabcbd38ce4`

- [x] **Task 2: Default UK sole-trader chart of accounts constant**
  - Intent: Create src/lib/chartOfAccounts.ts: a typed readonly DEFAULT_ACCOUNTS list of about 18 entries with code, name, accountType, taxCategory slug and isSystem. Income: sales, other business income. Expenses map to HMRC self-employment categories: cost-of-goods, travel, premises, admin-office, advertising, professional-fees, finance-costs, other-allowable, plus a disallowable account. System accounts: bank (asset), trade debtors (asset), VAT control (liability), owner's capital and drawings (equity). Reuse the AccountInsert type from the schema; add no new abstraction. A test checks codes are unique, size is 15 to 20, every expense has a taxCategory, and every system account has isSystem set.
  - Files: `src/lib/chartOfAccounts.ts`, `src/lib/__tests__/chartOfAccounts.test.ts`
  - Acceptance criteria the planner set:
    - Between 15 and 20 default accounts with unique codes
    - Income, expense, asset, liability and equity types are all present
    - The five required system accounts exist with isSystem true
    - Expense accounts cover all of the named HMRC categories including disallowable
    - npm run lint, typecheck and test pass
  - Commit: `ac402c32c010`

- [x] **Task 3: Accounts store, seeding and audit logic (injected, DB-free tests)** (after 1, 2)
  - Intent: Create api/_lib/accounts.ts following the vatNumber.ts pattern, with an AccountStore interface and databaseAccountStore. Operations: seedDefaults (insert DEFAULT_ACCOUNTS with onConflictDoNothing on (userId, code)); list (userId filter, active via archived_at IS NULL or archived on request, ordered by code, explicit LIMIT, explicit columns); create; rename; archive. Each of create, rename and archive writes an audit_events row (actorType 'user', resourceType 'account', before/after snapshots) in the same transaction as the change, with no network calls inside. Every query filters on the session userId, including update and archive by (id, userId). Pure rules are unit-tested: name/code validation, refusing archive of a system account, refusing a retype, mapping unique violation 23505 to a duplicate-code error. Tests use an in-memory fake store. Mark the queries as registered for the query audit in a comment, as vatNumber.ts does.
  - Files: `api/_lib/accounts.ts`, `api/_lib/__tests__/accounts.test.ts`
  - Acceptance criteria the planner set:
    - Seeding twice leaves exactly one copy of each default
    - Archive sets archived_at and the account leaves the default list but appears in the archived list
    - Archiving a system account, or changing its type, is refused
    - A duplicate code surfaces a typed duplicate-code error
    - create, rename and archive each write an audit event with before and after snapshots
    - No query uses a client-supplied user id, and every select has a limit
    - Audit rows and account changes are written in one transaction with no I/O inside
    - npm run lint, typecheck and test pass
  - Risk: Opus at high: tenant isolation, auditing and a transactional write path.
  - Commit: `9dc4058e4fba`

- [x] **Task 4: Accounts API route with auth, 409 handling and route tests** (after 3)
  - Intent: Add api/accounts.ts, default-exporting { fetch: createAccountsHandler(store, authDeps) } wrapped in withAuth, like api/settings/vat-number.ts. GET lists accounts, seeding defaults first on the first call (never in the login path), with ?archived=true for archived. POST creates; PATCH renames or archives by a uuid id in the JSON body. Use the refuse() { ok:false, error, code } shape: 400 bad input, 404 unknown or other-owner id, 405 other methods, 409 with a clear message for a duplicate code, and a refusal for archiving or retyping a system account. Never read userId from the body or query. Route tests (vi.mock('../db')) cover: every method refused without a token, duplicate 409, archive then list, system archive refused, system rename allowed, another user's id refused, seed on first GET. Use .js relative imports so apiRoutes.test.ts passes.
  - Files: `api/accounts.ts`, `api/_lib/__tests__/accountsRoute.test.ts`
  - Acceptance criteria the planner set:
    - Unauthenticated GET, POST and PATCH each return 401
    - A duplicate code returns 409 with a clear message
    - Archiving removes the account from the default list; ?archived=true shows it
    - Archiving a system account is refused; renaming one succeeds
    - A second user's account id is refused
    - npm run lint, typecheck, test and build all pass
  - Risk: Opus at high: authorisation on a route that takes record ids.
  - Commit: `79ffb7b9699b`
