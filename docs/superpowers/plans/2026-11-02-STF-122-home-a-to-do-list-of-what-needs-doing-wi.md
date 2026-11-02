# STF-122: Home: a to-do list of what needs doing, with a short money summary

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

- STF-119 has merged, so /home is the menu's first item and already routes to DashboardPage.
- Setup-skipped to-dos need STF-123's setup progress, which is not merged. Home takes an optional skipped-steps list, empty for now; wiring it up is a small follow-up once STF-123 lands. Confirm in the ticket conversation whether that belongs in STF-122.
- 'Receipts waiting to be checked' means receipts with ai_status 'extracted' and no linked entry; they stay drafts until confirmed.
- Existing routes /tax/vat and /tax/update/:taxYear/:quarter are the flows the VAT and Income Tax to-dos open. The sort-payments flow does not exist yet, so unsorted payments open /bank.
- 'Tax to set aside' reuses fetchTaxEstimate (setAsidePence); no new tax calculation.

## Out of scope

- The guided 'sort bank payments' and 'add a receipt' flows (separate tickets)
- First-time setup (STF-123) and the plain-words/official-name component (STF-120)
- Any new database migration or change to bank or receipt schemas
- Changes to HMRC clients or submission behaviour

## User journey

Starts at: The user signs in and lands on Home (/home), the first item of the six-item menu.

1. Home (`src/pages/DashboardPage.tsx`)
   - Before: Cards for income, expenses, profit, VAT collected and paid, a 'Box 5' VAT card, a drafts link and a latest-entries list.
   - After: A dated to-do list, soonest first, overdue on top saying how late, one button per item. Below it a short summary of money in, money out and tax to set aside, each opening the payments behind it. When nothing is due it says so with the next date.
   - Depends on: STF-119 (menu, merged)
2. Flow opened by a to-do button (VAT return, Income Tax update, Bank, Receipts) (`src/App.tsx`)
   - Before: Reached only from the Tax, Bank and Money out menu pages.
   - After: Reached directly from the matching Home to-do via existing routes /tax/vat, /tax/update/:taxYear/:quarter, /bank and /money-out/receipts.
   - Depends on: STF-121 (VAT flow, merged)

Also depends on:
- STF-119
- STF-123 (setup-skipped to-dos, follow-up)

## Tasks

- [x] **Task 1: Dashboard API: add counts of unsorted bank payments and receipts to check**
  - Intent: GET /api/dashboard also returns `unsortedBankCount` (bank_transactions with status 'unmatched', joined through bank_connections to the session user, connection not soft-deleted) and `receiptsToCheckCount` (the user's receipts with ai_status 'extracted', no transaction_id, deleted_at null). Each is one bounded count query inside the existing DashboardStore, run in the existing Promise.all, and added to the query-audit comment. No migration, so there is no clash with the 0022 to 0024 migrations other tickets are planning. If the receipts count needs an index, mark it with a `ponytail:` comment pointing at STF-74's receipts_user_created_idx rather than adding a migration. The store stays injectable and user-id scoping is tested with fakes. The mock `/api/dashboard` response in e2e gets the two new fields.
  - Files: `api/_lib/dashboard.ts`, `api/_lib/__tests__/dashboard.test.ts`, `e2e/mockApi.ts`
  - Acceptance criteria the planner set:
    - DashboardSummary includes numeric unsortedBankCount and receiptsToCheckCount
    - Both queries filter by the session user id, and the audit comment lists their index and bound
    - A test with a fake store shows both counts are passed through, and that another user's rows are not counted
    - Existing dashboard tests, `npm run typecheck` and `npm test` pass
  - Risk: Default model and effort. Read-only count, but it must be scoped to the user; tenant-isolation tests are required.
  - Commit: `73bc1e261da7`

- [x] **Task 2: Pure builder for the Home to-do list**
  - Intent: Add `src/lib/homeTodos.ts` with a pure function `buildHomeTodos(input, today)`. Inputs: open VAT obligations, open Income Tax obligations (ItsObligationRow), unsortedBankCount, receiptsToCheckCount, the bank consent state (existing consentState in bankApi), and an optional list of skipped setup steps. Each item has an id, plain-words title, optional due date, days-late figure for overdue items, button label and target route. Overdue items come first, most late first, saying how late ('3 days late'). The rest follow soonest first. Undated items (unsorted payments, receipts) go after dated ones. Bank expiry reads 'Your bank connection runs out in N days'. When the list is empty return the 'nothing due' state with the next upcoming date ('You're up to date. Your next VAT return is due 7 March.'). Use wording from docs/design/ease-of-use.md section 1 and the plain-words table. Targets: VAT to /tax/vat, Income Tax to /tax/update/:taxYear/:quarter, unsorted payments and expiring bank to /bank, receipts to /money-out/receipts. The setup-skipped input is a plain optional array so this task does not depend on STF-123.
  - Files: `src/lib/homeTodos.ts`, `src/lib/homeTodos.test.ts`
  - Acceptance criteria the planner set:
    - Tests cover ordering: overdue first, soonest first, undated last
    - Tests cover 'N days late' wording and singular/plural forms
    - Tests cover the nothing-due state with the next VAT or Income Tax date, and the no-dates-at-all state
    - Tests cover the bank expiry item shown for 'expiring' but not 'active'
    - No raw jargon in titles (obligation, reconcile, Box N)
    - `npm run typecheck`, `npm run lint` and `npm test` pass
  - Commit: `342c533f8c28`

- [x] **Task 3: Replace the Dashboard content with the Home to-do list and money summary** (after 1, 2)
  - Intent: Rewrite `src/pages/DashboardPage.tsx` (route /home) to answer 'what needs doing'. Use existing queries and keys: useVatObligations ('vat-obligations', mocks must always return defined data), fetchItsObligations ('its-obligations'), fetchBankStatus, fetchDashboard, fetchTaxEstimate. Render buildHomeTodos as a list with one button per item, overdue items marked with text as well as colour, and the nothing-due message. Below is a short money summary: money in this month, money out this month, tax to set aside. Each figure is a link: money in to /money-in, money out to /money-out, tax to /tax/income-tax (confirm with the owner, since the spec says each figure opens the payments behind it). Use formatPence, right-aligned tabular figures. Remove the old cards (Box 5, VAT collected, drafts, latest entries). Use the shared StateMessage for loading and error states. Each query fails soft so one failing source does not blank the page. Use min-h-11 tap targets. Rewrite DashboardPage.test.tsx. Pass an empty setup-skipped list until STF-123 merges.
  - Files: `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`
  - Acceptance criteria the planner set:
    - With an overdue VAT return, an Income Tax update due soon, 9 unsorted payments and an expiring bank connection, Home shows them in the right order, each with one button linking to its flow
    - With nothing due, Home shows the up-to-date sentence with the next date
    - The money summary shows money in, money out and tax to set aside as formatted GBP, each a link
    - If one data source fails, the other to-dos and the summary still render and the failure is reported in plain words
    - Ledger, obligation, reconcile and 'Box 5' do not appear on screen
    - Tests mock fetch and the vat-obligations mock always returns defined data
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass
  - Risk: DashboardPage.tsx is also edited by STF-123 and STF-120; keep the rewrite compact and expect a merge conflict at PR time. Do not touch SetupTodos.tsx (STF-123).
  - Commit: `fff59e9b463b`

- [x] **Task 4: Update the end-to-end walk-through and capture the Home evidence** (after 3)
  - Files: `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `browser-evidence/STF-122/captions.md`, `browser-evidence/STF-122/review-notes.md`, `browser-evidence/STF-122/`
  - Acceptance criteria the planner set:
    - The journey spec's Home step passes against the updated mock
    - Every image under browser-evidence/STF-122/ has a captions.md entry with a plain-English title
    - Images cover 1440 and 390 px in light and dark for each Home state
    - review-notes.md lists deviations from the spec and why
    - No real data in the images or mock
  - Risk: e2e/mockApi.ts is also edited by STF-123 and STF-74; keep hunks small. Dark capture only applies if the app ships a dark theme; if not, say so in the notes.
  - Commit: `0a6905884572`

- [x] **Task 5: Fix: One check failed while testing: FAIL  App.test.tsx > first sign-in redirect > keeps Home when the setup state cannot be loaded.** (after 4)
  - Intent: One check failed while testing: FAIL  App.test.tsx > first sign-in redirect > keeps Home when the setup state cannot be loaded. The agent is fixing it; nothing is needed from you.
  - Commit: `8ca5765729de`

- [x] **Task 6: Fix: address 7 review findings (cycle 1)** (after 5)
  - Intent: Review left 7 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Add a to-do for an expired bank connection in src/lib/homeTodos.ts. Today a lapsed connection produces no item, so Home says "You're up to date" when the bank feed has sto The agent is fixing them; nothing is needed from you.
  - Commit: `60ff78290f43`
