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

- There is no UI for adding entries today (nothing in src or e2e calls /api/entries), so the journey step 'add an income entry' is done by API in tests and by mocked data in e2e; building an entry form is not in this ticket.
- ExpensesPage.tsx is a stub; the minimum list view in task 3 is needed for the drill-down link to land anywhere.
- STF-66 has merged (HEAD 0013cea) so PERIOD_LOCKED and edit/void exist in api/_lib/entries.ts.
- The current nil-message condition (boxes 5,6,7 all zero) can misfire for entries that net to zero; the fix uses an entry count.

## Out of scope

- Entry creation/edit form UI
- Reworking VAT box calculation rules in src/lib/vat.ts
- HMRC submission changes

## User journey

Starts at: Signed in owner with a confirmed income entry (20% VAT) dated in the open VAT period, opens VAT from the nav

1. VAT page (`src/pages/VatPage.tsx`)
   - Before: Drill-down lines show text only, nil message depends on boxes 5/6/7 being zero
   - After: Box 1 and box 6 include the entry; drill-down lists date, description, amount, each linking to the entry; nil message only when no entries
   - Depends on: STF-66 entries
2. Preview what will be sent (`src/pages/VatPreviewPanel.tsx`)
   - Before: Shows nil figures
   - After: Shows entry in vatDueSales and totalValueSalesExVAT
3. Expenses page (`src/pages/ExpensesPage.tsx`)
   - Before: Coming soon placeholder
   - After: Lists entries; the linked entry row is highlighted via the URL hash

Also depends on:
- STF-66

## Tasks

- [ ] **Task 1: Carry the entry id through the VAT drill-down and fix the nil-return test**
  - Intent: DrillLine gets a transactionId. loadLedgerLines in api/_lib/vatReturns.ts selects transactions.id, getReturnReview passes it into drillDown, and the in-memory stores in existing tests supply it. Also add a per-period entry count (distinct counted lines across boxes, or ledger line count) to the review response so the UI can tell 'no entries' from 'entries that net to zero'. Use the existing response shape; no new query (same single joined query, still bounded by LEDGER_LINE_LIMIT). Done when the review JSON exposes transactionId per line and a count of counted entries.
  - Files: `api/_lib/vatReturns.ts`, `api/_lib/__tests__/vatReturns.test.ts`, `api/_lib/__tests__/entriesRoute.test.ts`, `api/_lib/__tests__/vatPreviewRoute.test.ts`
  - Acceptance criteria the planner set:
    - drillDown lines include transactionId taken from transactions.id
    - review response includes an entry count that is 0 only when no confirmed/reconciled non-deleted entry falls in the period
    - Existing store fakes updated; npm run typecheck and npm test pass
  - Risk: Touches the shared ledger loader every VAT path uses; check linesForBox/LedgerLine in src/lib/vat.ts still typecheck.

- [ ] **Task 2: End-to-end VAT tests from real entries (all boxes, refund, boundaries, stale, lock)** (after 1)
  - Intent: New test file that wires one in-memory EntryStore and one in-memory VatReturnStore over the same saved rows (reuse the fakes pattern in entriesRoute.test.ts), creates entries via createEntry/the entries handler, then runs getReturnReview, confirmReturn, requireConfirmedReturn and the preview in api/_lib/vatPreview.ts. Cases: standard 20%, reduced 5%, zero-rated sales and purchases (each box 1,4,6,7 asserted; 2,3,8,9 asserted per existing rules); refund period with box 5 negative (box3<box4, net is absolute value, check how vat.ts represents it); entries dated on the first and last day of the period counted, day before/after excluded; editing an entry after confirmation makes review stale and requireConfirmedReturn refuse with the existing stale error; entry creation/edit/void inside a filed period refused with PERIOD_LOCKED from STF-66; preview shows vatDueSales and totalValueSalesExVAT from the entries. Integer pence only.
  - Files: `api/_lib/__tests__/vatFromEntries.test.ts`
  - Acceptance criteria the planner set:
    - Every VAT box 1-9 is asserted at least once with figures from entries
    - Refund case asserts negative box 5 behaviour as implemented
    - Stale-after-edit and filed-period lock cases pass and fail if the guard is removed
    - No network or live DB used; npm test passes
  - Risk: Needs the real exported names in vatReturns.ts, vatPreview.ts and entries.ts; confirm them before writing. If a case exposes a real bug, report it rather than widening scope.

- [ ] **Task 3: Entries read list endpoint support and Expenses page showing entries with anchors** (after 1)
  - Intent: The drill-down must link to the entry on the Expenses page, but ExpensesPage.tsx is a 'Coming soon' stub and there is no list route. Add the minimum: Expenses page renders the owner's entries (date, description, amount) via the existing /api/entries read path (add a bounded, indexed list GET by owner, if none exists, in api/entries.ts and api/_lib/entries.ts and register it for the query audit), each row with id=entry-<id> and highlighted when the URL hash matches. Use shared loading/empty/error components, formatPence, right-aligned tabular money, truncating rows with tooltip. Server scopes by auth.userId. Test that another owner's entries are not listed.
  - Files: `src/pages/ExpensesPage.tsx`, `src/pages/ExpensesPage.test.tsx`, `api/entries.ts`, `api/_lib/entries.ts`, `api/_lib/__tests__/entriesRoute.test.ts`
  - Acceptance criteria the planner set:
    - GET /api/entries without id returns the caller's entries only, with a LIMIT, no select *
    - Expenses page lists entries and an element with id entry-<id> exists per row
    - Cross-owner list test passes; lint, typecheck, test pass
  - Risk: Auth/tenant-scoped query so opus; also the entries handler is shared with other tickets, so keep the edit to the GET branch. Check the query-audit registration convention in the repo.

- [ ] **Task 4: VAT page drill-down links, truthful nil-return message, component tests** (after 1, 3)
  - Intent: In BoxRows (src/pages/VatPage.tsx) render each line's date, description and amount, with the description/date a react-router Link to /expenses#entry-<transactionId> (44px tap target, focus state). Replace the box5/6/7 === 0 nil message condition with the entry count from task 1 so it shows only when the period has no entries. Extend DrillLine type. Update VatPage.test.tsx for link href and for a period whose entries net to zero not showing the nil message.
  - Files: `src/pages/VatPage.tsx`, `src/pages/VatPage.test.tsx`
  - Acceptance criteria the planner set:
    - Each drill-down line shows date, description, amount and links to /expenses#entry-<id>
    - Nil message absent when entries exist but boxes are zero; present when count is 0
    - npm run lint, typecheck, test pass
  - Risk: VatPage.tsx is also edited by other VAT tickets; keep hunks local.

- [ ] **Task 5: Update docs/workflows/vat-return.md on how entries reach the return** (after 2, 4)
  - Intent: Document the path: entry created through posting rules, confirmed/reconciled and non-deleted lines counted by loadLedgerLines for the period dates inclusive, box mapping, refund handling, stale confirmation on edit, STF-66 period lock after filing, preview payload, and the drill-down link to Expenses.
  - Files: `docs/workflows/vat-return.md`
  - Acceptance criteria the planner set:
    - Doc describes entry-to-box flow, boundaries, stale and lock behaviour, drill-down link
    - Matches the code as built

- [ ] **Task 6: E2E journey and screenshots for VAT page and preview at 390 and 1440 px** (after 4)
  - Intent: Extend e2e/mockApi.ts so the mock returns an income entry with 20% VAT in the drill-down and preview, and add a journey step opening VAT, expanding box 1 and box 6, clicking Preview what will be sent, asserting vatDueSales and totalValueSalesExVAT, then capture screenshots at 390 and 1440 px for VAT page, drill-down and preview (and the Expenses page) into docs/screenshots for the PR. Do not read or write .env files.
  - Files: `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `docs/screenshots`
  - Acceptance criteria the planner set:
    - Journey asserts box 1, box 6, drill-down line and preview fields
    - Screenshots at 390 and 1440 px exist for each changed screen using invented data only
    - npm run build passes
  - Risk: STF-90 also edits e2e/mockApi.ts, e2e/journey.spec.ts and docs/screenshots; expect merge conflicts, keep additions in separate hunks and use distinct screenshot filenames.
