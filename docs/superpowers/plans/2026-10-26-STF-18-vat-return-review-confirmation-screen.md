# STF-18: VAT return review + confirmation screen

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

- Period (period_key, start, end) arrives in the request and is validated for shape; checking it against an open HMRC obligation belongs to the submit/obligations work, since the obligations fetch UI is not built.
- Routes follow the existing Vercel api/ pattern with withAuth; draft is keyed by (user, period_key), so there is no raw record id route.
- No component-test library is installed and none is to be added, so UI logic is tested as pure functions.
- The legal declaration is stored as a timestamp only (declaration_accepted_at); the exact wording lives in the UI.

## Out of scope

- HMRC submit call and payload send (STF-19); this ticket only provides the gate it must call
- MTD obligations fetch
- VAT return history/status tracking
- Per-client API rate limiting () across the api/ routes
- Reopening a confirmed return beyond what the stale check needs

## Tasks

- [x] **Task 1: Add box drill-down selector to vat.ts**
  - Intent: Add a pure function in src/lib/vat.ts that returns the LedgerLines contributing to a given box (1/6 income, 4/7 expense, 3 and 5 both, 2/8/9 none) using the same inclusion rule as buildVatReturnFromLedger. Extract that rule into one shared predicate so the totals and the drill-down can never disagree (). Tests in vat.test.ts: each box's lines sum to the box value, voided/deleted/out-of-period lines are excluded, nil return gives empty lists and all-zero boxes.
  - Files: `src/lib/vat.ts`, `src/lib/vat.test.ts`
  - Acceptance criteria the planner set:
    - Totals from buildVatReturnFromLedger are unchanged (existing vat tests pass untouched)
    - New selector's contributing lines reproduce boxes 1,4,6,7 exactly in a test
    - Nil return test: every box's drill-down is empty
    - No floats introduced; all values integer pence
  - Commit: `c0b12c5fe4a3`

- [x] **Task 2: Schema and migration for VAT return drafts**
  - Intent: Add a vat_return_drafts table (id, user_id FK, period_key, period_start, period_end, status draft|confirmed, boxes as nine integer-pence columns or one jsonb snapshot of VatReturnBoxes, declaration_accepted_at nullable, confirmed_at nullable, created_at, updated_at) with unique(user_id, period_key) which doubles as the lookup index. No hard delete path. Export row types and re-export from src/model/types.ts. Generate a migration. STF-15 plans 0001_hmrc_token_expiry_index.sql and edits meta/_journal.json, so name this migration with idx 2 and tag 0002_vat_return_drafts and a later `when`, and keep a single journal head; re-check against main before finishing. Extend schema.test.ts to cover the new table.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0002_vat_return_drafts.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0002_snapshot.json`, `src/model/types.ts`
  - Acceptance criteria the planner set:
    - Migration is 0002 and the journal has one linear chain
    - Unique constraint on (user_id, period_key) is in the SQL
    - Only integer columns for money; no declaration text stored beyond a timestamp and the wording version if needed
    - npm run typecheck and npm test pass
  - Risk: Schema/migration work, and the journal collides with STF-15's planned 0001 migration; needs care to keep a single head.
  - Commit: `fd49ef43688e`

- [x] **Task 3: Server-side draft, confirm and submit-gate API** (after 1, 2)
  - Intent: Add api/_lib/vatReturns.ts with a store interface (injected like AuthDeps) and logic, plus routes under api/vat/ wrapped in withAuth, scoped by auth.userId on every query. (a) GET: load the caller's ledger lines for a period (period_key, start, end validated with zod), recompute boxes with buildVatReturnFromLedger, return boxes, the saved draft status, and drill-down lines per box (bounded, only needed fields, indexed filters via user_id; one joined query not per-row). (b) PUT: upsert the draft (status draft); refuse if already confirmed unless reopened. (c) POST confirm: requires declaration:true in the body, recomputes boxes server-side (never trusts client boxes), stores the snapshot, sets declaration_accepted_at and confirmed_at, writes an audit_events row; nil returns must confirm the same way. (d) Export requireConfirmedReturn(userId, periodKey) that STF-19 must call: it throws unless status is confirmed AND a fresh recompute equals the stored snapshot (ledger changed since confirmation means re-confirm). Do not implement the HMRC submit. No network/HMRC calls. Tests with fake store and fake auth: no declaration refused, client-supplied boxes ignored, second user's period returns nothing/refused, unauthenticated 401, nil return confirms, stale snapshot rejected by the gate, unconfirmed rejected by the gate.
  - Files: `api/_lib/vatReturns.ts`, `api/_lib/__tests__/vatReturns.test.ts`, `api/vat/return.ts`, `api/vat/return-confirm.ts`
  - Acceptance criteria the planner set:
    - Confirm without declaration:true returns 4xx and persists nothing
    - Stored boxes come from server recompute, test proves a tampered client payload is ignored
    - requireConfirmedReturn rejects draft, missing and stale-after-ledger-change returns and passes a fresh confirmed one
    - Every query filters by auth.userId; a second user's request for the first user's period gets no data
    - Nil return (all zeros) can be saved and confirmed
    - Error responses use ApiError shape and log no request body
  - Risk: Server-side enforcement of the acceptance criterion, per-user data isolation and legal confirmation; security-class work.
  - Commit: `3826153dc987`

- [x] **Task 4: Review and confirmation UI on VatPage** (after 3)
  - Intent: Replace the VatPage placeholder with the review flow: nine boxes in a right-aligned tabular-figure table using formatPence, each box expandable to its contributing transactions from the API, a legal declaration checkbox, and a Confirm button disabled until ticked (server still enforces). Draft state is loaded from the server on mount so the user can leave and return; show confirmed status and the stale case. Use react-query (already installed) for fetch/confirm, existing loading/empty/error patterns, 44px tap targets, focus states, tokens not raw hex. Do not add a submit button or call HMRC. Keep decision logic (button enabled, status label) in a small pure function with a vitest test since there is no component test library and no new dependency may be added. No money formatting outside src/lib/money.ts.
  - Files: `src/pages/VatPage.tsx`, `src/pages/vatReviewState.ts`, `src/pages/vatReviewState.test.ts`
  - Acceptance criteria the planner set:
    - Nine boxes shown with GBP formatting via formatPence; a refund (negative box 5) is clearly labelled
    - Each of boxes 1,3,4,5,6,7 can be expanded to the contributing transactions
    - Confirm is disabled until the declaration is ticked and while the request is pending; nil return shows the same flow
    - Reload shows the saved draft or confirmed state from the server
    - npm run lint, typecheck, test and build pass
  - Commit: `ed8ebc7d5393`

- [x] **Task 5: Document the review and confirm flow** (after 3)
  - Intent: Update docs/workflows/vat-return.md step 4 to describe the draft/confirm states, server recompute, the stale rule and the requireConfirmedReturn gate STF-19 must call, and tick the review item in PLAN.md if present.
  - Files: `docs/workflows/vat-return.md`, `PLAN.md`
  - Acceptance criteria the planner set:
    - Doc names the gate function and the routes
    - States that submission itself is STF-19
  - Commit: `2370e36ff334`

- [x] **Task 6: Fix: address 12 review findings (cycle 1)** (after 5)
  - Intent: Review left 12 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Server-side confirm and gate logic is sound: it needs a literal declaration:true, recomputes boxes server-side, scopes by user, and requireConfirmedReturn rejects missing, The agent is fixing them; nothing is needed from you.
  - Commit: `8077b2c1962b`

- [x] **Task 7: Fix: address 12 review findings (cycle 1)** (after 6)
  - Intent: Review left 12 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Server-side confirm and gate logic is sound: it needs a literal declaration:true, recomputes boxes server-side, scopes by user, and requireConfirmedReturn rejects missing, The agent is fixing them; nothing is needed from you.
  - Commit: `b46500b4eed0`

- [x] **Task 8: Fix: address 10 review findings (cycle 2)** (after 7)
  - Intent: Review left 10 findings unresolved (NEEDS_WORK): **correctness** — APPROVED The correctness lens found nothing blocking. I read the diff only and did not re-run the orchestrator's passing validation. Every cycle-1 correctness finding is fixed in thi The agent is fixing them; nothing is needed from you.
  - Commit: `986e7f603506`
