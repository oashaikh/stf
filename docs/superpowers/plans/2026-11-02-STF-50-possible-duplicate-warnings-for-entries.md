# STF-50: Possible duplicate warnings for entries and receipts

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

- Entries have no supplier column, so supplier is the entry reference (receipt confirm writes it there), falling back to description.
- 'Within a few days' means 3 days either side; amount is gross pence; supplier match ignores case and extra spaces.
- Dismissals live in localStorage, as the VAT flow does; they do not follow the owner across devices.
- File hash is computed in the browser because uploads go straight to signed storage; it is advisory only.
- Entry form and list use the existing GET /api/entries date filter; no new endpoint.
- Migration 0033 is reserved by STF-110, so this ticket uses 0034.
- STF-75 and STF-76 are merged.

## Out of scope

- Blocking saves or auto-merging/deleting suspected duplicates
- Duplicate detection for invoices, income or bank lines
- Fuzzy supplier matching or image similarity
- Server-side storage of dismissals
- A dedicated duplicates review page
- Backfilling hashes for receipts uploaded before this change

## User journey

Starts at: Money out menu item, then Expenses or Receipts

1. Expenses: add or edit an entry (`src/pages/ExpensesPage.tsx`)
   - Before: The form saves with no hint that the payment is already there.
   - After: A dismissible note shows beside the form; saving is unchanged.
2. Expenses list (`src/pages/EntriesList.tsx`)
   - Before: Duplicate-looking rows look like any other.
   - After: Likely duplicates carry a small dismissible notice.
3. Receipts list (upload) (`src/pages/ReceiptsPage.tsx`)
   - Before: A file uploaded twice gives two unremarkable rows.
   - After: The second row says you already added this file; dismissible.
4. Receipt review (`src/pages/ReceiptReview.tsx`)
   - Before: Review and confirm with no duplicate check.
   - After: Notices for a repeated file and a matching existing expense; Confirm works as before.

Also depends on:
- STF-75 (receipt confirm) and STF-76 (receipt review), both merged

## Tasks

- [x] **Task 1: Duplicate rule, dismissal memory and shared notice component**
  - Intent: Add a pure function that flags likely duplicate expenses: same gross amount in pence, same supplier (the entry reference, falling back to the description, compared ignoring case and extra spaces), dates within 3 days. Each flag carries a stable key. Add a small dismissal store backed by localStorage (as vatFlowState.ts does) that records dismissed keys and reports them as dismissed on later loads. Add one shared notice component (plain words, Dismiss button, 44px tap target) for the screens to reuse. Never changes or blocks anything. Mark the localStorage choice with a ponytail: comment (ceiling: dismissals do not follow the owner across devices; upgrade: a server table).
  - Files: `src/lib/duplicateEntries.ts`, `src/lib/duplicateEntries.test.ts`, `src/lib/duplicateDismissals.ts`, `src/lib/duplicateDismissals.test.ts`, `src/components/DuplicateNotice.tsx`, `src/components/DuplicateNotice.test.tsx`
  - Acceptance criteria the planner set:
    - Unit tests cover same amount and supplier 0, 3 and 4 days apart; different amount; different supplier; case and whitespace differences; an entry never matched with itself
    - All amounts are integer pence, no floating-point
    - A test shows a dismissed key stays dismissed after re-reading storage
    - The notice renders the message and calls onDismiss from a keyboard-reachable button
    - npm run lint, typecheck and test pass
  - Commit: (none — no code change for this task)

- [x] **Task 2: Receipt file fingerprint: store it and flag repeat uploads on the server**
  - Intent: Add nullable file_hash (hex SHA-256) and duplicate_of_receipt_id columns to receipts, an index on (user_id, file_hash), and migration 0034 with journal entry (0033 is taken by STF-110). Client hashes the chosen file with crypto.subtle.digest and sends it in the receipt-create body. api/_lib/receipts.ts validates 64 hex chars, optional. On insert one bounded indexed query finds the owner's live receipt with the same hash and stores its id. Create response and list rows expose duplicateOfId. Never blocks the upload or changes existing records. Update column grants and input inventory.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0034_receipt_file_hash.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0034_snapshot.json`, `api/_lib/receipts.ts`, `api/receipts.ts`, `api/_lib/__tests__/receipts.test.ts`, `api/_lib/__tests__/receiptsRoute.test.ts`, `src/lib/receiptsApi.ts`, `src/lib/__tests__/receiptsApi.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Single new migration head with an unused version prefix, columns granted per repo pattern
    - Test: same hash twice gives duplicateOfId on the second create, null on the first
    - Test: another user's receipt and soft-deleted receipts never match
    - Test: missing hash still uploads fine; malformed hash refused
    - No response exposes file_key, user_id or the hash
    - Lookup is one indexed query with LIMIT 1, outside any transaction
    - npm run lint, typecheck, test and build pass
  - Risk: Opus high: schema migration plus an owner-scoped query where a cross-user leak would be a tenant-isolation bug.
  - Commit: `bf68680d00ff`

- [x] **Task 3: Show duplicate warnings on the entry form and the Expenses list** (after 1)
  - Intent: In AddEntryForm (ExpensesPage.tsx), once date, amount and supplier are filled, fetch the owner's expense entries within date ±3 days (one bounded fetchEntries call) and run the Task 1 rule. Show a dismissible DuplicateNotice naming the other entry. Saving is never blocked or altered. On the Expenses list (EntriesList.tsx) run the rule once over loaded rows and show a small notice on flagged rows; rows stay one line and collapse at 390px. Plain wording; dismissed stays dismissed after reload.
  - Files: `src/pages/ExpensesPage.tsx`, `src/pages/ExpensesPage.test.tsx`, `src/pages/EntriesList.tsx`, `src/pages/EntriesList.test.tsx`, `src/lib/entriesApi.ts`
  - Acceptance criteria the planner set:
    - Test: matching amount, supplier and date shows the warning and Save posts the same body as without it
    - Test: dismissed warning stays hidden after remount and refetch
    - Test: list shows notices on both matching rows only
    - Editing an entry does not flag it against itself
    - vat-obligations mocks return defined data
    - Screenshots at 390 and 1440 px of the form and list with a warning
    - npm run lint, typecheck, test and build pass
  - Commit: `c8606ec353ef`

- [x] **Task 4: Show duplicate warnings on the receipt review and Receipts list, with screenshots** (after 1, 2, 3)
  - Intent: In ReceiptReview.tsx show a DuplicateNotice if the receipt has duplicateOfId, and run the Task 1 rule against existing expenses using the supplier, total and date as edited. Both dismissible; confirm and discard unchanged. In ReceiptsPage.tsx show the file-level notice on the row after upload. Add a Playwright spec and mock data to capture 390 and 1440 px screenshots of each changed screen.
  - Files: `src/pages/ReceiptReview.tsx`, `src/pages/ReceiptReview.test.tsx`, `src/pages/ReceiptsPage.tsx`, `src/pages/ReceiptsPage.test.tsx`, `src/pages/__tests__/jargonRender.test.tsx`, `e2e/mockApi.ts`, `e2e/duplicate-warnings.spec.ts`, `browser-evidence/STF-50/captions.json`
  - Acceptance criteria the planner set:
    - Test: receipt with duplicateOfId shows the notice on review and list, and Confirm sends the same request as before
    - Test: entry-match notice appears and clears as fields are edited
    - Test: dismissed notice stays dismissed after refetch and remount
    - Jargon render test still passes
    - Screenshots at 390 and 1440 px of all four changed screens in browser-evidence/STF-50 with captions
    - npm run lint, typecheck, test and build pass
  - Commit: (none — no code change for this task)
