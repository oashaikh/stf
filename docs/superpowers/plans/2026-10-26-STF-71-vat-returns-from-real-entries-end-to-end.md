# STF-71: VAT returns from real entries: end-to-end tests and drill-down detail

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

- origin/dev (STF-67 form, STF-10 list API with from, to, search filters) is not yet in this branch and must be merged first.
- STF-10 has no entry-id filter, so the drill-down link uses from, to and search query params plus an #entry-<id> hash; STF-68's list is expected to read those params. If it reads different names, only the link builder in VatPage.tsx changes.
- dev lacks this branch's plan doc; keep the branch's copy when merging.
- STF-71 adds no migration.

## Out of scope

- Building any entries list or Expenses page changes (STF-68 owns the list)
- Dark-theme screenshots (project ships light only)
- An entry-id filter on the list API

## User journey

Starts at: Sign in, then open Expenses

1. Expenses: add income entry (`src/pages/ExpensesPage.tsx`)
   - Before: Add entry form exists (STF-67), unchanged by this ticket
   - After: Owner saves an income entry with 20% VAT dated in the open VAT period
   - Depends on: STF-67
2. VAT page with drill-down (`src/pages/VatPage.tsx`)
   - Before: Drill-down lines are text only; nil message shown when boxes 5, 6, 7 are zero
   - After: Box 1 and box 6 include the entry; drill-down lists date, description and amount, each linking to the Expenses page; nil message only when the period has no entries
3. Preview what will be sent (`src/pages/VatPreviewPanel.tsx`)
   - Before: Shows nil figures when there are no entries
   - After: Shows the entry in vatDueSales and totalValueSalesExVAT
4. Expenses list reached from a drill-down link (`src/pages/ExpensesPage.tsx`)
   - Before: List built by STF-68
   - After: Lands filtered by the link's date range and search
   - Depends on: STF-68

Also depends on:
- STF-66
- STF-67
- STF-10
- STF-68

## Tasks

- [x] **Task 1: Merge dev, then carry the entry id and an entry count through the VAT review**
  - Intent: Merge origin/dev into the branch first (brings STF-67 add-entry form, STF-10 list API; resolve conflicts, keep this branch's plan doc). Then DrillLine gets transactionId: loadLedgerLines in api/_lib/vatReturns.ts selects transactions.id and getReturnReview passes it through drillDown. Add a per-period count of counted entries to the review response so the UI can tell 'no entries' from 'entries netting to zero'. Same single joined query, still bounded by LEDGER_LINE_LIMIT, no new query. Existing in-memory fakes in vatReturns/vatPreviewRoute tests are updated to supply the id. Done when review JSON exposes transactionId per line plus entryCount, and typecheck and tests pass after the merge.
  - Files: `api/_lib/vatReturns.ts`, `api/_lib/__tests__/vatReturns.test.ts`, `api/_lib/__tests__/vatPreviewRoute.test.ts`, `api/_lib/__tests__/entriesRoute.test.ts`, `src/pages/VatPage.tsx`, `src/pages/VatPage.test.tsx`
  - Acceptance criteria the planner set:
    - origin/dev merged; npm ci, lint, typecheck, test all pass on the merged tree
    - Each drillDown line in the review response carries transactionId equal to transactions.id
    - Review response entryCount is 0 only when no confirmed or reconciled, non-deleted entry falls in the period
    - Test shows a period whose entries net to zero has entryCount > 0 and a period with none has 0
    - Owner scoping of the ledger query is unchanged
  - Risk: opus/high: touches the owner-scoped ledger loader every VAT path (review, confirm, preview, submit) uses, and carries a merge with conflict resolution. VatPage.tsx edit here is only the type so it still typechecks.
  - Commit: `fd9d95fdaf48`

- [x] **Task 2: End-to-end VAT tests from real entries (all boxes, refund, boundaries, stale, lock)** (after 1)
  - Intent: New api/_lib/__tests__/vatFromEntries.test.ts wiring one in-memory EntryStore and one in-memory VatReturnStore over the same saved rows (reuse the fake pattern in entriesRoute.test.ts). Create entries through createEntry and the entries handler, then run getReturnReview, confirmReturn, requireConfirmedReturn and previewVatReturnForUser. Cases: standard 20%, reduced 5%, zero-rated sales and purchases, asserting boxes 1 to 9 at least once; a refund period with box 5 negative as implemented in src/lib/vat.ts; entries on the first and last day of the period counted, day before and after excluded; editing an entry after confirmation makes requireConfirmedReturn refuse with the existing stale error; create, edit and void inside a filed period refused with PERIOD_LOCKED from STF-66; preview shows vatDueSales and totalValueSalesExVAT from the entries. Integer pence only, invented data. Check real exported names first; if a case exposes a real bug, report it rather than widening scope.
  - Files: `api/_lib/__tests__/vatFromEntries.test.ts`
  - Acceptance criteria the planner set:
    - Every VAT box 1 to 9 is asserted with figures that come from entries
    - Refund case asserts the negative box 5 behaviour as implemented
    - Stale-after-edit and filed-period lock cases fail if the respective guard is removed
    - Boundary cases cover first day, last day, day before, day after
    - No network or live database; npm test passes
  - Commit: `e8a3c4f3b1f0`

- [x] **Task 3: VAT drill-down links to the Expenses list, truthful nil-return message, component tests** (after 1)
  - Intent: In the DrillLine rows of BoxRows in src/pages/VatPage.tsx show date (UK format), description and amount (formatPence, right-aligned, tabular figures, one-line truncation with title tooltip, 44px tap target, labelled rows on phone), each linking with react-router Link to the Expenses page using STF-10's filter query: /expenses?from=<date>&to=<date>&search=<description> plus #entry-<id>, so it lands on the list STF-68 is building. Do not build a second list or edit ExpensesPage.tsx. Show the 'No VAT-relevant transactions' nil message only when entryCount is 0. Component tests: lines render with links, nil message hidden when entries exist but boxes net to zero, shown when count is 0.
  - Files: `src/pages/VatPage.tsx`, `src/pages/VatPage.test.tsx`
  - Acceptance criteria the planner set:
    - Each drill-down line shows date, description, amount and links to /expenses with from, to, search and the entry-id hash
    - Nil message absent when entries exist but boxes are zero; present when entryCount is 0
    - Link target for a known line is asserted in a test
    - npm run lint, typecheck and test pass
  - Risk: VatPage.tsx is shared with other VAT tickets; keep hunks local.
  - Commit: `768a3e14d22c`

- [ ] **Task 4: Update docs/workflows/vat-return.md on how entries reach the return** (after 2, 3)
  - Intent: Document the path: an entry is created through the posting rules, only confirmed or reconciled non-deleted entries are counted by loadLedgerLines, period dates are inclusive, entry lines map to boxes 1 to 9, how a refund shows in box 5, edit after confirming makes the confirmation stale, the STF-66 period lock after filing, the preview payload fields, and the drill-down link to the Expenses page and its filter query. Must match the code as built.
  - Files: `docs/workflows/vat-return.md`
  - Acceptance criteria the planner set:
    - Doc covers entry to box flow, boundaries, stale and lock behaviour, preview and the drill-down link
    - Statements match the tests in vatFromEntries.test.ts

- [ ] **Task 5: E2E journey with the real add-entry form, plus screenshots at 390 and 1440 px** (after 3)
  - Intent: Extend e2e/mockApi.ts so entries created through the STF-67 form on /expenses are held by the mock and flow into the VAT review (box 1, box 6, drill-down line with transactionId) and the preview (vatDueSales, totalValueSalesExVAT). Add a journey step to e2e/journey.spec.ts: sign in, open Expenses, use the real Add entry form to add an income entry with 20% VAT dated inside the open period, open VAT, assert box 1 and box 6, expand the drill-down and assert the line and its link, click Preview what will be sent and assert vatDueSales and totalValueSalesExVAT. Capture screenshots of the VAT page, drill-down and preview at 390 and 1440 px, light, committed as browser-evidence/STF-71/<width>-light-<step>.png. Invented data only.
  - Files: `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `browser-evidence/STF-71`
  - Acceptance criteria the planner set:
    - Journey drives the real Add entry form, then asserts box 1, box 6, the drill-down line and the preview fields
    - Screenshots exist for each changed screen at 390 and 1440 px named browser-evidence/STF-71/<width>-light-<step>.png
    - No .env file read or written; npm run lint, typecheck, test and build pass
  - Risk: STF-90 also edits e2e/mockApi.ts and e2e/journey.spec.ts; keep additions in separate hunks.
