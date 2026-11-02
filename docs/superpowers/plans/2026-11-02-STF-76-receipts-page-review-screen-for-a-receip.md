# STF-76: Receipts page: review screen for a receipt draft

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

- STF-75 (NEW-13) will provide an endpoint that confirms a receipt with the owner's edited values and creates the entry. It is not in this tree. Task 2 checks first and stops to ask in the ticket if it is missing.
- The low-confidence line is 0.7 (700 thousandths), taken from the extraction prompt wording.
- The review is one page with the receipt beside the fields, as the ticket says, not the one-field-per-screen flow the receipt-extraction doc describes. The PR notes this difference.
- Entry creation and its VAT and period-lock rules stay server-side in the STF-75 endpoint.

## Out of scope

- Building the confirm-with-edits and entry-creation endpoint (STF-75)
- Changing how receipts are uploaded, listed or extracted
- Receipt line items or multi-receipt batches
- Re-running AI extraction from the review screen

## User journey

Starts at: Money out > Receipts

1. Receipts list (`src/pages/ReceiptsPage.tsx`)
   - Before: A receipt with unconfirmed details shows a 'confirm' button that accepts the suggestions as they are
   - After: The same row shows a 'Check details' action that opens the review screen
   - Depends on: STF-74
2. Receipt review (`src/pages/ReceiptReview.tsx`)
   - Before: Does not exist
   - After: Receipt image or PDF beside editable suggested fields with confidence markers, low-confidence fields highlighted, Confirm and Discard buttons, and a link to the new entry after confirming
   - Depends on: STF-75
3. Money out entries (`src/pages/MoneyOutPage.tsx`)
   - Before: Expenses list
   - After: The new entry opened from the link after Confirm
   - Depends on: STF-75

Also depends on:
- STF-74
- STF-75
- STF-7

## Tasks

- [ ] **Task 1: Return per-field confidence from the receipts list**
  - Intent: GET /api/receipts already returns each read field as {value, confirmed}. Add a confidence figure in integer thousandths (0-1000, from receipt_extractions.confidence, already stored) to each field. Extend the ReceiptDetails type in src/lib/receiptsApi.ts with the same. Export one LOW_CONFIDENCE_THOUSANDTHS constant (700, matching the 'below 0.7' wording in the extraction prompt) so the UI and server share one line. Select only the extra column, in the existing single extractions query (no new query, no N+1). Add a route test asserting confidence is returned and that another user's receipt is not. Done = existing tests still pass and the new field is visible to the client.
  - Files: `api/_lib/receipts.ts`, `api/receipts.ts`, `api/_lib/__tests__/receiptsRoute.test.ts`, `src/lib/receiptsApi.ts`, `src/lib/__tests__/receiptsApi.test.ts`
  - Acceptance criteria the planner set:
    - List response details[field] includes an integer confidence (null when missing)
    - No floating-point is stored or sent; the threshold constant is an integer
    - Route test covers confidence in the response and a second user being refused the first user's receipt
    - npm run lint, typecheck and test pass
  - Risk: Touches the shared list function used by the existing Receipts page; the ReceiptDetails type change must not break readReceiptDetails or ReceiptsPage.test.tsx.

- [ ] **Task 2: Client calls for confirming a draft with edits and discarding it** (after 1)
  - Intent: First check whether STF-75 (NEW-13, confirm a receipt draft with the owner's edited values and create the entry) is on main. The repo today has only PUT /api/receipts, which marks the AI values confirmed unedited, and DELETE, which soft-deletes. If the STF-75 endpoint exists, add typed wrappers in src/lib/receiptsApi.ts: confirmReceiptDraft(id, edited fields, amount as integer pence) returning the new entry id, and discardReceiptDraft(id) (the existing DELETE soft-delete). If the endpoint does NOT exist, stop and ask in the ticket conversation; do not invent a server contract or write entry-creation logic here. Reuse refusalMessage and the EntryRefusedError pattern. Add tests with fetch mocked.
  - Files: `src/lib/receiptsApi.ts`, `src/lib/__tests__/receiptsApi.test.ts`
  - Acceptance criteria the planner set:
    - confirmReceiptDraft sends the edited values (amount in integer pence) to the STF-75 endpoint and returns the new entry id
    - discardReceiptDraft soft-deletes via the existing DELETE call
    - Server refusals surface as plain messages, not codes
    - Unit tests with mocked fetch cover both calls and a refusal
    - npm run lint, typecheck and test pass
  - Risk: Blocked on STF-75 not being in this tree. Wrong guess at the contract would ship a broken confirm.

- [ ] **Task 3: Build the receipt review screen component** (after 2)
  - Intent: New ReceiptReview component: receipt image or PDF beside the suggested fields (stacked on phones at 390 px). Use readUrl: img for images, an embedded viewer or open-link fallback for PDFs. Each field (date, who it was from, total including tax, tax paid, category) is an editable input with a confidence marker that uses text as well as colour (e.g. 'Sure' or 'Check this one'). Fields under LOW_CONFIDENCE_THOUSANDTHS are highlighted. Category is a select of the owner's active expense accounts (reuse fetchAccounts(false) filtered to type expense). Money is shown with formatPence and parsed with parsePence, as integer pence. Copy says plainly these are suggestions to check, with plain words per docs/design/ease-of-use.md (official names only in small muted text via OfficialName). Buttons: 'Confirm' (calls confirmReceiptDraft with the edited values, then shows a link to the new entry) and 'Discard' (asks for confirmation naming what it removes, then discardReceiptDraft). Use the shared StateMessage for loading, empty and error states, the page container, type-scale and colour tokens, 44 px targets and visible focus. Component tests (API mocked): low-confidence field is highlighted and high is not; an edited value, not the original suggestion, is what gets sent; discard path asks first and calls discard; confirm shows the entry link; a refusal is shown beside the fix.
  - Files: `src/pages/ReceiptReview.tsx`, `src/pages/ReceiptReview.test.tsx`
  - Acceptance criteria the planner set:
    - Fields below the low-confidence line carry a visible highlight and a text marker
    - Editing a field then pressing Confirm sends the edited values, with the amount as integer pence
    - Category options are only active expense accounts
    - Discard asks for confirmation, then calls the discard path and returns the owner to the list
    - After confirm a link to the new entry is shown
    - Screen text says the values are suggestions to check and uses no word from the 'never on screen' list
    - Component tests for highlight, edited-values-sent and discard pass; lint, typecheck and test pass
  - Risk: Money handling: parsing the edited amount must stay integer pence with no float maths.

- [ ] **Task 4: Open the review from the Receipts page and capture screenshots** (after 3)
  - Intent: Wire the review in: the 'needs checking' action on each ReceiptRow in src/pages/ReceiptsPage.tsx opens ReceiptReview (route /money-out/receipts/:receiptId, added under MoneyOutPage or App routes, with the existing redirects left intact). The current row 'confirm' mutation, which confirms unedited values, is replaced by this review path so nothing is confirmed without a look. After discard or confirm the owner returns to the list, and the list refreshes via receiptsQueryKey (and ENTRIES_QUERY_KEY after confirm). Add the screen to the jargon render test. Update ReceiptsPage.test.tsx and make mocks return defined data for every query key (vat-obligations flake noted in repo memory). Capture screenshots at 390 and 1440 px, light and dark, with a captions file (plain-English title per image) under browser-evidence/STF-76/, using invented receipts only. In the PR note where the screen differs from docs/design/ease-of-use.md (one review page rather than one field per screen, as the ticket specifies).
  - Files: `src/pages/ReceiptsPage.tsx`, `src/pages/ReceiptsPage.test.tsx`, `src/pages/MoneyOutPage.tsx`, `src/pages/MoneyOutPage.test.tsx`, `src/App.tsx`, `src/pages/__tests__/jargonRender.test.tsx`, `docs/agents/receipt-extraction.md`, `browser-evidence/STF-76/captions.md`
  - Acceptance criteria the planner set:
    - From the Receipts list an owner can open a draft, edit, confirm and reach the new entry link, or discard
    - No receipt can be confirmed from the list without opening the review
    - Jargon test passes with the new screen included
    - Screenshots at 390 and 1440 px (light and dark) with captions are in browser-evidence/STF-76/, showing only invented data
    - docs/agents/receipt-extraction.md describes the review screen accurately
    - npm run lint, typecheck, test and build all pass
  - Risk: Edits the existing Receipts page and routing, which the other receipt tickets also touch; keep hunks small so they merge cleanly.
