# STF-68: Expenses page: entries list with filters, search, edit and void

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

- STF-10, STF-66, STF-67 are merged on this branch (head 633f645); re-check with git log before starting.
- The list endpoint excludes voided entries and has no voided filter, so 'voided shows as voided' is met by keeping the row visible as Voided for the session after a void. No API change planned.
- List rows carry netPence and vatPence but not the VAT rate; the edit form derives 0/5/20 in integer arithmetic.
- VAT-quarter preset comes from existing HMRC obligations and is unavailable when not connected.
- Only the light theme ships, so screenshots are light only.

## Out of scope

- Any change to api/_lib/entries.ts or api/entries.ts, including a voided filter
- Amount-range filters
- Receipt upload/view; icon is display only
- Changes to e2e/journey.spec.ts and e2e/mockApi.ts
- Dark theme
- Bulk actions

## User journey

Starts at: Sign in at /, land on Dashboard, open Expenses from the app shell navigation.

1. Expenses: entries list (`src/pages/ExpensesPage.tsx, src/pages/EntriesList.tsx`)
   - Before: Plain list of date, description, status and amount under Add entry; no filters, load more or actions.
   - After: Filterable list, newest first, with category, amount, Draft badge, receipt icon, load more and an empty state explaining how to add the first entry.
2. Expenses: filters and search (`src/pages/EntriesList.tsx, src/lib/entryFilters.ts`)
   - Before: No way to narrow the list.
   - After: Money in/out, date range with tax-year and VAT-quarter presets, category, status and description search narrow the list.
3. Expenses: edit entry (`src/pages/ExpensesPage.tsx`)
   - Before: Form only adds entries.
   - After: Edit opens the same form pre-filled; saving updates the row.
4. Expenses: void confirmation and voided row (`src/pages/EntryActions.tsx`)
   - Before: Entries cannot be removed.
   - After: Confirmation dialog names the entry; afterwards the row shows as Voided.
5. Expenses: locked-period refusal (`src/pages/EntryActions.tsx, src/pages/VatPage.tsx`)
   - Before: None.
   - After: Edit/void/confirm in a confirmed or filed VAT period shows a plain-words message with a link to /vat.
   - Depends on: STF-66 PERIOD_LOCKED refusal on the entries API

Also depends on:
- STF-10 entries list API
- STF-66 entries edit, void, confirm API
- STF-67 add entry form

## Tasks

- [x] **Task 1: Entries client and filter helpers: list params, cursor, edit, void, confirm, locked refusal**
  - Intent: Done means src/lib/entriesApi.ts can drive every call the list needs, and a pure helper builds the filter presets. (1) Widen ApiEntry to the STF-10 list row: categoryAccountId, categoryName, netPence, vatPence, hasReceipt. (2) fetchEntries(filters, cursor) builds the query string for from, to, kind, categoryAccountId, status, search, cursor and returns { entries, nextCursor }; empty filters are left out. (3) Add editEntry (PUT /api/entries?id=), voidEntry (DELETE), confirmEntry (PATCH {status:'confirmed'}). (4) Refusals with code PERIOD_LOCKED throw a distinct PeriodLockedError carrying the server message; other refusals reuse EntryRefusedError. (5) New pure src/lib/entryFilters.ts: filter state type with defaults, conversion to request params, tax-year range from a tax-year string (2026-27 gives 2026-04-06 to 2027-04-05, reusing currentTaxYear from src/lib/taxBands.ts), and VAT-quarter range picked from the obligations (the one containing today). ENTRIES_QUERY_KEY stays the prefix so existing invalidation refreshes filtered lists. Unit tests with mocked fetch cover param building, the 5/6 April boundary, quarter selection and locked-error mapping.
  - Files: `src/lib/entriesApi.ts`, `src/lib/entryFilters.ts`, `src/lib/entryFilters.test.ts`, `src/lib/__tests__/entriesApi.test.ts`
  - Acceptance criteria the planner set:
    - fetchEntries sends only non-empty filters plus cursor and returns nextCursor (null when no more)
    - A 409 body with code PERIOD_LOCKED rejects with PeriodLockedError carrying the server message
    - taxYearRange('2026-27') returns 2026-04-06 and 2027-04-05; the quarter helper returns undefined when no obligation contains today
    - No floating-point money introduced
    - npm run lint, typecheck and test pass
  - Commit: `d512bb3bf2fa`

- [x] **Task 2: Entries list with filters, search, load more, draft badge, receipt icon and empty state** (after 1)
  - Intent: Replace the simple EntryList in src/pages/ExpensesPage.tsx with a child component src/pages/EntriesList.tsx under the form. Rows (one line, truncate with title tooltip): formatDate date, description, category name, formatPence amount (right-aligned, tabular-nums, with In/Out text), Draft badge for drafts, accessible receipt icon when hasReceipt. Collapses to labelled rows at 390 px. Filter bar: date from/to, presets 'This tax year' and 'This VAT quarter' (quarter via useVatObligations; disabled with a reason when unavailable), Money in/out/both, Category (fetchAccounts), Status, and a search box. Any filter change resets and refetches. Load more uses useInfiniteQuery with nextCursor and hides when null. Loading/error/empty states; empty state explains how to add the first entry; filtered-empty offers Clear filters. 44 px targets, visible focus, labels, colour tokens (). Update existing ExpensesPage.test.tsx fixtures to {entries, nextCursor}. Component tests (fetch mocked): each filter changes the request URL; load more sends the cursor and appends; empty states; badge and receipt icon.
  - Files: `src/pages/EntriesList.tsx`, `src/pages/EntriesList.test.tsx`, `src/pages/ExpensesPage.tsx`, `src/pages/ExpensesPage.test.tsx`
  - Acceptance criteria the planner set:
    - Tests show each filter changes the request query
    - Load more sends the cursor, appends rows, button disappears when nextCursor is null
    - Rows show date, description, category, formatPence amount, Draft badge, receipt icon only when hasReceipt
    - Empty state tells the owner how to add the first entry
    - No nested scroll regions or sideways table scroll at 1440 px
    - lint, typecheck, test and build pass
  - Risk: ExpensesPage.tsx is also edited by STF-71; keep the edit here to swapping out the old EntryList so hunks merge cleanly.
  - Commit: `dd21ea384b8c`

- [x] **Task 3: Row actions: confirm draft, void with confirmation, locked-period message** (after 2)
  - Intent: Add per-row actions. Confirm (drafts only) calls confirmEntry and invalidates ENTRIES_QUERY_KEY. Void opens a confirmation dialog naming the entry (date, description, amount) and saying it is marked voided and stays on record; dialog follows layout, traps focus, closes on Escape. On success the row stays for the session as 'Voided' (struck through, no actions) because the list API excludes voided entries and the journey says voided shows as voided; a refetch drops it. A PeriodLockedError from confirm, void or edit shows a plain-words alert ('This entry is in a VAT period that has been confirmed or filed, so it cannot be changed') with a react-router Link to /vat (44 px target). Other failures show a retryable error. Tests: cancel sends no request; confirm void sends DELETE with id and row shows Voided; confirm draft sends PATCH; 409 PERIOD_LOCKED shows message and /vat link; Escape closes dialog.
  - Files: `src/pages/EntriesList.tsx`, `src/pages/EntriesList.test.tsx`, `src/pages/EntryActions.tsx`
  - Acceptance criteria the planner set:
    - Void asks for confirmation naming the entry; cancel sends no request
    - After a confirmed void the row shows Voided with no actions
    - Locked refusal renders plain-words message with link to /vat
    - Confirm button only on draft rows and clears the Draft badge after success
    - lint, typecheck, test and build pass
  - Commit: `ec0e55777d1d`

- [x] **Task 4: Edit an entry: reuse the STF-67 form pre-filled** (after 3)
  - Intent: Give AddEntryForm in src/pages/ExpensesPage.tsx an edit mode rather than a second form. Edit on a row opens the form pre-filled from the list row: kind, date, description, reference, category, gross amount in pounds via existing entryForm/money helpers (amountIs gross), VAT rate derived from integer vatPence/netPence (0, 5 or 20, integer arithmetic). Submit reads Save changes and sends editEntry (PUT) keeping the original status. On success close the form and invalidate ENTRIES_QUERY_KEY; Cancel returns to the list. Field refusals use existing FORM_FIELD mapping. PeriodLockedError reuses the locked-message component from task 3. Tests: pre-fill, PUT with changed amount and id in URL, list shows update, locked refusal message.
  - Files: `src/pages/ExpensesPage.tsx`, `src/pages/ExpensesPage.test.tsx`, `src/pages/EntriesList.tsx`, `src/lib/entryForm.ts`, `src/lib/entryForm.test.ts`
  - Acceptance criteria the planner set:
    - Edit pre-fills the form with amount in pounds via shared money helper
    - Saving sends PUT /api/entries?id=<id> with integer pence and original status
    - Locked period refusal shown in plain words with link to /vat
    - Existing add-entry tests still pass
    - lint, typecheck, test and build pass
  - Risk: ExpensesPage.tsx is also edited by STF-71; keep changes additive and small.
  - Commit: `c71a5607a153`

- [x] **Task 5: Screenshots at 390 and 1440 px for each journey step** (after 4)
  - Intent: Run the app with mocked API responses and capture /expenses steps as review evidence, committed as browser-evidence/STF-68/<width>-light-<name>.png: list, filtered, edit pre-filled, voided row, locked-period refusal, each at 390 and 1440 px, light only. Use existing Playwright setup or an ad hoc script; do not edit e2e/journey.spec.ts or e2e/mockApi.ts (STF-71, STF-90 edit them). Invented data only. Fix any layout defect found (sideways scroll, targets under 44 px) in the earlier tasks' files.
  - Files: `browser-evidence/STF-68/1440-light-expenses-list.png`, `browser-evidence/STF-68/390-light-expenses-list.png`, `browser-evidence/STF-68/1440-light-expenses-filtered.png`, `browser-evidence/STF-68/390-light-expenses-filtered.png`, `browser-evidence/STF-68/1440-light-expenses-edit.png`, `browser-evidence/STF-68/390-light-expenses-edit.png`, `browser-evidence/STF-68/1440-light-expenses-voided.png`, `browser-evidence/STF-68/390-light-expenses-voided.png`, `browser-evidence/STF-68/1440-light-expenses-locked.png`, `browser-evidence/STF-68/390-light-expenses-locked.png`
  - Acceptance criteria the planner set:
    - Ten PNGs exist under browser-evidence/STF-68/
    - No page-level horizontal scroll at 390 or 1440 px
    - Only invented records shown
    - lint, typecheck, test and build pass on final tree
  - Commit: `70471587cb4f`

- [x] **Task 6: Fix: address 23 review findings (cycle 1)** (after 5)
  - Intent: Review left 23 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Correctness of the list, filters, load more, edit (PUT), void, confirm and locked-period handling checks out against api/entries.ts and the entry list query schema. Two pr The agent is fixing them; nothing is needed from you.
  - Commit: `eef0bf86b45a`
