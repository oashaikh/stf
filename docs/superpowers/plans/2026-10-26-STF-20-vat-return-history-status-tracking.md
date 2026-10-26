# STF-20: VAT return history + status tracking

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

- STF-19's vat_submissions rows are the HMRC receipt store, and vat_return_drafts holds the per-period box snapshot. No new table is added, as the operator comment requires.
- 'Accepted' means a vat_submissions row in status 'submitted' with a stored receipt (HMRC returned 201). 'Submitted' means a pending claim whose outcome is unconfirmed. This mapping is not stated in the ticket.
- Immutability is already enforced server-side for live filings: refuseIfFiledLive blocks save, reopen and confirm on a period that has a non-failed live submission. This ticket adds the view-only history UI over that and does not change it. Sandbox filings deliberately do not lock a period.
- History shows one row per period (a live receipt outranks a sandbox one) and is capped at a fixed number of recent periods with no paging UI.

## Out of scope

- Changing the submit, confirm or reopen flows, or adding DB-level triggers for immutability
- Pagination or filtering of history beyond a fixed bounded list
- Showing HMRC-side return history fetched from the HMRC returns API
- PDF or CSV export of returns

## Tasks

- [x] **Task 1: Add history index migration on vat_return_drafts**
  - Intent: The history list reads one user's drafts newest first with a LIMIT, so it needs an index on (user_id, period_end) behind the filter and sort (). Add the index in schema.ts and as migration 0004, with the drizzle snapshot and journal entry. 0004 must be the only head and parent on 0003. No new table or column: history reads the existing vat_return_drafts and vat_submissions (operator: no second store). Run `npm run db:generate` if it works offline, otherwise hand-write the files in the style of 0003.
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/0004_vat_return_drafts_history_index.sql`, `server/src/db/migrations/meta/0004_snapshot.json`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/schema.test.ts`
  - Acceptance criteria the planner set:
    - Migration uses CREATE INDEX IF NOT EXISTS on vat_return_drafts (user_id, period_end)
    - schema.ts declares the same index and the journal has exactly one new entry, idx 4
    - server/src/db/schema.test.ts has an assertion that the index exists in the migration SQL
    - npm run typecheck and npm test pass
  - Risk: Schema/migration work: the journal and snapshot must stay consistent with a single head.
  - Commit: `4fec61ba2ae3`

- [x] **Task 2: Server: per-user VAT return history query, status derivation and GET /api/vat/history** (after 1)
  - Intent: Add `listReturnHistory(userId)` to VatReturnStore in api/_lib/vatReturns.ts and implement it in databaseStore. It reads vat_return_drafts for the user ordered by period_end desc with a LIMIT (e.g. 40). It reads that user's vat_submissions for those period keys in one extra query, not one per row. Status is derived by one pure function: 'draft' for a draft row, 'confirmed' for a confirmed row, 'submitted' when a submission is pending (sent, outcome not confirmed), and 'accepted' when a submission is 'submitted' with a stored receipt. Failed submissions fall back to the draft status. Each item returns periodKey, start, end, status, the stored box values (integer pence from the draft row, never recomputed from the ledger), and the receipt (formBundleNumber, processingDate ISO, sandbox) when present. A live receipt outranks a sandbox one, as in getReturnReview. Reuse that selection logic by extracting it into a shared function rather than duplicating it. Add `api/vat/history.ts`: a GET-only handler wrapped in withAuth (the vatReturnHandler/default-export pattern), scoped by auth.userId, with no userId from the client. Select only the needed columns. Update the fake VatReturnStore objects in existing tests so typecheck passes.
  - Files: `api/_lib/vatReturns.ts`, `api/vat/history.ts`, `api/_lib/__tests__/vatReturns.test.ts`, `api/_lib/__tests__/vatSubmit.test.ts`, `api/_lib/__tests__/vatSubmitRoute.test.ts`, `api/_lib/__tests__/vatHistory.test.ts`
  - Acceptance criteria the planner set:
    - GET /api/vat/history without a valid token returns 401; non-GET returns 405
    - Test: user B never sees user A's periods or receipts
    - Test: each status maps correctly (draft, confirmed, pending submission -> submitted, submitted+receipt -> accepted, failed -> back to confirmed or draft)
    - Test: a live receipt is preferred over a sandbox one, and sandbox=true is surfaced
    - Test: boxes returned are the stored draft values even when the ledger has changed since confirmation
    - Query is bounded by LIMIT, run once per request, and has no per-row query; every value is a bound parameter
    - All money fields are integer pence
    - npm run lint, typecheck and test pass
  - Risk: Per-user data access and auth route: tenant isolation must be enforced on the server and tested.
  - Commit: `6bf0db69e9f3`

- [ ] **Task 3: UI: VAT return history list with read-only submitted view and HMRC receipt** (after 2)
  - Intent: Add `fetchVatHistory(token)` to src/lib/hmrc/vatApi.ts (follow the existing fetch/ApiResponse pattern). Add a `VatHistoryList` component, in the style of VatObligationsList.tsx, and render it in VatPage below the review. It lists past returns with a status label (Draft, Confirmed, Submitted, Accepted), net VAT due (box5) and the period. Sandbox receipts carry a visible label. Accepted and submitted rows open a view-only detail with the stored boxes 1-9 and the stored HMRC receipt (form bundle number, processing date), and no Edit, Reopen, Confirm or Submit control. Reuse BOX_LABELS and boxLabel from vatReviewState.ts, formatPence from src/lib/money.ts, and the shared loading/empty/error components if present. Include empty, loading and error states. Money is right-aligned in tabular figures, rows are one line with truncation and a tooltip, tables collapse to labelled rows at 390px, tap targets are at least 44px, status is never colour-only, and fonts and colours use tokens. Add a short History section to docs/workflows/vat-return.md. Capture 1440 and 390 px screenshots of the list and detail with invented data for the PR ().
  - Files: `src/lib/hmrc/vatApi.ts`, `src/lib/hmrc/vatApi.test.ts`, `src/pages/VatHistoryList.tsx`, `src/pages/VatHistoryList.test.tsx`, `src/pages/VatPage.tsx`, `src/pages/vatReviewState.ts`, `docs/workflows/vat-return.md`
  - Acceptance criteria the planner set:
    - Component test with a mocked API: rows show correct labels and formatPence amounts for draft, confirmed, submitted and accepted
    - Test: opening an accepted return shows the stored receipt and no action buttons
    - Test: sandbox receipt is labelled; empty and error states render
    - No raw hex or px font sizes, and no floats for money
    - vatApi.test.ts covers fetchVatHistory success and error
    - npm run lint, typecheck, test and build pass
