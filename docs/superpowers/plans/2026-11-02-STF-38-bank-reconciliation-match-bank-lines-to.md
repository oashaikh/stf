# STF-38: Bank reconciliation: match bank lines to entries

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

- Only confirmed entries are proposed; 'reconciled' already exists in the transaction_status enum.
- Match window is 3 days.
- The sort screen lives on the Bank page as a child component; ExpensesPage is unchanged.
- Bank line sign: positive is money in, negative is money out; verify against api/_lib/bankImport.ts.
- One route file with an action field keeps the function count low.
- Migration number 0025 may need bumping if STF-74 lands a migration first.

## Out of scope

- Per-payee 'same for all' rules and AI category suggestions
- Auto-marking invoices paid on bank payment
- Changes to the bank importer or TrueLayer provider
- Split matches of one bank line to several entries
- Shared page container component ()

## User journey

Starts at: Home to-do 'Sort N bank payments' or the Bank item in the six-item menu

1. Home (`src/pages/DashboardPage.tsx / src/lib/homeTodos.ts`)
   - Before: To-do about unsorted bank payments
   - After: The to-do links to /bank
   - Depends on: STF-122
2. Bank (`src/pages/BankPage.tsx, src/pages/BankSortSection.tsx`)
   - Before: Only the bank connection card
   - After: A 'Sort your bank payments' list with suggested matches, Undo, Set aside, Add as new payment; all-sorted message when done
   - Depends on: STF-36, STF-66
3. Money in / Money out (`src/pages/EntriesList.tsx`)
   - Before: Drafts and confirmed entries
   - After: A draft created from a bank payment appears for the owner to confirm
   - Depends on: existing entries API

Also depends on:
- STF-36
- STF-66
- STF-119
- STF-120
- STF-122

## Tasks

- [x] **Task 1: Pure bank-line matching function**
  - Intent: Add src/lib/bankMatching.ts: a pure function taking unmatched bank lines (id, date, signed amountPence, description) and confirmed entries (id, date, signed gross pence) and returning proposals. Rule 1: same amount and same date, marked 'exact'. Rule 2: same amount within 3 days, nearest date first, marked 'close'. Each entry is proposed to at most one line (exact claimed before close, ties broken by id for stable output). Integer pence only, no I/O. Tests in src/lib/bankMatching.test.ts cover exact, close, outside window, opposite sign, one entry wanted by two lines, ties, empty input, and a fully matched set leaving no unmatched lines.
  - Files: `src/lib/bankMatching.ts`, `src/lib/bankMatching.test.ts`
  - Acceptance criteria the planner set:
    - Same amount and same date yields an 'exact' proposal; same amount within 3 days yields 'close'; 4 days apart yields none
    - Income line never proposed against an expense entry of the same absolute amount
    - An entry is never proposed for two lines and output order is deterministic
    - No floating-point money arithmetic
    - npm test, typecheck and lint pass
  - Commit: (none — no code change for this task)

- [x] **Task 2: Migration and schema: link bank lines to entries, dismiss reason**
  - Intent: bank_transactions has status unmatched/matched/dismissed but no link to an entry. Add nullable matched_transaction_id (uuid FK to transactions.id) and dismissed_reason (text), plus an index on matched_transaction_id. Add migration 0025_bank_reconciliation.sql (re-check the next free number against base branch; single head), update meta/_journal.json and snapshot, schema.ts and schema.test.ts, and any column grants the repo uses. Nothing is deleted.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0025_bank_reconciliation.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0025_snapshot.json`
  - Acceptance criteria the planner set:
    - Migration idempotent in the style of 0022 and the journal has one new entry
    - schema.ts exposes matchedTransactionId and dismissedReason with an index on the former
    - schema.test.ts asserts the new columns and index
    - npm test, typecheck and build pass
  - Risk: Opus/high: schema change on financial data. STF-74 also adds a migration, so re-check the number against main.
  - Commit: (none — no code change for this task)

- [x] **Task 3: Reconciliation API: proposals, match, unmatch, dismiss, create draft** (after 1, 2)
  - Intent: Add api/_lib/bankReconcile.ts (store, rules, database store, audit) and one route api/bank/reconcile.ts wrapped in withAuth. GET returns up to 100 unmatched lines for the session owner's connections plus the owner's confirmed entries in the same date window (LIMIT), runs the matcher and returns proposals. POST with zod-validated action: match {lineId, entryId} sets line matched and entry confirmed->reconciled in one transaction with no network call inside; unmatch {lineId} reverses to unmatched and confirmed; dismiss {lineId, reason 1-200 chars}; undismiss; createEntry {lineId, categoryAccountId, vatRatePercent} uses the existing createEntry to make a DRAFT only, linked to the line. Every query is scoped to auth.userId (line ownership via its connection, entry via transactions.user_id); another owner's id gets 404. Each action writes an audit_events row with before/after snapshots. Already-matched lines, entries matched elsewhere, voided or deleted entries are refused. Tests with fake stores for each action, audit, double-match, cross-user refusal, unauthenticated, bad bodies. Register the route in docs/security/input-inventory.md and route tests.
  - Files: `api/_lib/bankReconcile.ts`, `api/bank/reconcile.ts`, `api/_lib/__tests__/bankReconcile.test.ts`, `api/_lib/__tests__/bankReconcileRoute.test.ts`, `api/_lib/__tests__/maliciousInputRoutes.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Every query filters by the session user id and has a LIMIT
    - Match sets entry reconciled; unmatch returns it to confirmed; dismiss stores the reason; createEntry makes a draft only
    - Each action writes one audit event and nothing is hard-deleted
    - A second user sending the first user's line or entry id is refused (tested)
    - input-inventory.md lists the route and inputInventory.test.ts passes
    - npm test, typecheck and lint pass
  - Risk: Opus/high: tenant isolation, financial status changes and audit trail.
  - Commit: `9c84d2a95e12`

- [x] **Task 4: Client API and 'Sort your bank payments' screen** (after 3)
  - Intent: Add src/lib/bankReconcileApi.ts and a child component src/pages/BankSortSection.tsx rendered in BankPage (ease-of-use.md puts sorting payments on the Bank page). Plain words only (match, sort; never reconcile). Each payment shows a suggested match with a reason ('Same amount, 2 days apart'), one-tap 'Yes, match it', 'No', 'Set aside' with reason, and 'Add as new payment' creating a draft. Undo after every action. Shared StateMessage for loading/empty/error, an all-sorted empty state, formatPence right-aligned tabular, 44px targets, focus rings, rows collapse on phones. Tests with the API module mocked. Check the Home to-do for bank payments links to /bank.
  - Files: `src/lib/bankReconcileApi.ts`, `src/pages/BankSortSection.tsx`, `src/pages/BankSortSection.test.tsx`, `src/pages/BankPage.tsx`, `src/pages/BankPage.test.tsx`, `src/pages/__tests__/jargonRender.test.tsx`, `src/lib/homeTodos.ts`
  - Acceptance criteria the planner set:
    - The words reconcile/reconciliation do not appear on screen; jargon tests pass
    - Accept, dismiss with reason and create draft each call the API once and refresh; Undo reverses the last action
    - A fully matched month shows the all-sorted state and no unmatched lines
    - Loading, empty and error states use StateMessage
    - npm test, lint, typecheck and build pass
  - Commit: `9944c2f0a882`

- [x] **Task 5: E2E mock and screenshot evidence at 390 and 1440 px** (after 4)
  - Intent: Extend e2e/mockApi.ts with an appended /api/bank/reconcile mock using invented data, add an e2e spec for the Bank sort flow, and capture screenshots at 390 px and 1440 px (light, and dark if shipped) into browser-evidence/STF-38 with captions.md.
  - Files: `e2e/mockApi.ts`, `e2e/bank-sort.spec.ts`, `browser-evidence/STF-38/captions.md`
  - Acceptance criteria the planner set:
    - Mock returns only invented records
    - Screenshots at 390 and 1440 px of proposals and all-sorted state exist and are listed in captions.md
    - lint, typecheck, test and build pass
  - Commit: `d70bb5fd3ba3`
