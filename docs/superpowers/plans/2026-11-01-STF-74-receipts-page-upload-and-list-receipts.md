# STF-74: Receipts page: upload and list receipts

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

- STF-6 is merged: POST/PATCH/DELETE on api/receipts.ts and the receipts table exist, but there is no list endpoint or signed read URL, so this ticket adds both.
- Extraction status shown is receipts.ai_status; no extraction is run here, so it mostly reads pending.
- Migration 0021 is taken by STF-85, so 0022 is used; re-check the journal against main.
- The ticket's receipts route is api/receipts.ts, extended with GET.

## Out of scope

- Triggering AI extraction or the draft-confirmation flow
- Linking a receipt to a transaction
- Virus scanning of uploads ()
- Hard-deleting stored objects

## User journey

Starts at: Owner signs in and opens Receipts from the app navigation

1. Receipts page (/receipts) (`src/pages/ReceiptsPage.tsx, routed in src/App.tsx`)
   - Before: A heading and a 'Coming soon.' message
   - After: Upload area with camera input and progress, paged receipt list with thumbnail or icon, upload and extraction status, and Remove with confirmation
   - Depends on: STF-6 receipt upload routes (merged)

Also depends on:
- STF-6

## Tasks

- [x] **Task 1: Receipts index migration for the paged list**
  - Intent: Add an index on receipts (user_id, created_at, id) so the newest-first list query is served by an index (). Add it to the drizzle schema and generate one new migration with a version later than 0021 (held by STF-85), keeping a single head. Re-check the journal against main before finishing. Extend schema.test.ts to assert the index exists.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0022_receipts_user_created_idx.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0022_snapshot.json`
  - Acceptance criteria the planner set:
    - receipts has an index on (user_id, created_at, id) in schema.ts
    - Migration 0022 exists, uses a unique version, and the journal has a single head
    - Schema test covers the new index
    - npm run typecheck and npm test pass
  - Risk: Schema/migration work, and the journal file is shared with STF-85. Opus at high.
  - Commit: `fe74d26db675`

- [x] **Task 2: Receipts GET: paged list with extraction status and signed read URLs** (after 1)
  - Intent: Add a GET method to api/receipts.ts returning the signed-in owner's live receipts (deleted_at is null), newest first, with a limit and cursor/page parameter. Each item has id, fileName, mimeType, sizeBytes, uploadStatus, aiStatus (extraction status) and createdAt; ready uploads also get a short-lived signed read URL. Add presignRead to ReceiptStorage (GetObjectCommand via getSignedUrl) and a bounded list method to ReceiptStore scoped by session user id. Never expose fileKey. Validate query params. Presign outside any transaction. Register the query for the audit if the repo has an audit list. Update the input inventory. Tests: ordering, limit, user scoping, second user cannot see the first user's receipts, 503 when storage is unconfigured, presignRead.
  - Files: `api/receipts.ts`, `api/_lib/receipts.ts`, `api/_lib/receiptStorage.ts`, `api/_lib/__tests__/receiptsRoute.test.ts`, `api/_lib/__tests__/receiptStorage.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - GET /api/receipts returns only the caller's non-deleted receipts, newest first, never more than the limit, with a way to fetch the next page
    - Response never includes fileKey or userId; includes uploadStatus and aiStatus
    - Signed read URL is present only for ready uploads and expires in minutes
    - Invalid limit or cursor gives 400; unauthenticated gives 401
    - Tests cover cross-user refusal, ordering, paging and the storage-missing case
    - npm run lint, typecheck and test pass
  - Risk: Signed URLs and per-user data isolation. Opus at high.
  - Commit: `29e9d32cd173`

- [x] **Task 3: Receipts API client module** (after 2)
  - Intent: Add src/lib/receiptsApi.ts following the mileageApi.ts pattern: fetchReceipts(page), startReceiptUpload (POST), uploadToSignedUrl with progress via XMLHttpRequest, confirmReceiptUpload (PATCH) and removeReceipt (DELETE). Include client-side type and size checks mirroring the server (JPEG, PNG, WEBP, PDF, max 10 MB). Unit-test validation and request shapes with faked fetch and XHR.
  - Files: `src/lib/receiptsApi.ts`, `src/lib/__tests__/receiptsApi.test.ts`
  - Acceptance criteria the planner set:
    - Wrong type or oversize file is refused before any request, with a clear message
    - Upload sequence is POST, PUT to signed URL with progress callbacks, then PATCH
    - Server refusal messages are surfaced
    - No live network in tests
    - npm test and typecheck pass
  - Commit: (none — no code change for this task)

- [x] **Task 4: Receipts page: upload, list and remove with confirmation, plus component tests** (after 3)
  - Intent: Replace the Coming soon text in src/pages/ReceiptsPage.tsx. Add a react-dropzone area with a camera-friendly input, per-file progress, and clear errors for wrong type or size. Add a TanStack Query paged list, newest first, showing file name, date added, upload status and extraction status (plain-language, never as confirmed data), with a thumbnail from the signed URL or a file icon. Remove opens a confirm dialog naming the file, then soft-deletes. Use StateMessage for loading/empty/error, shared page gutters, 44px targets, single-line truncating rows, and labelled rows on phones. Component tests (receiptsApi mocked) cover upload success, wrong-type and oversize refusal, list loading/empty/error/populated states, remove confirm/cancel and load more. Add receipts mocks to e2e/mockApi.ts if needed. Capture screenshots at 390 and 1440 px as review evidence.
  - Files: `src/pages/ReceiptsPage.tsx`, `src/pages/ReceiptsPage.test.tsx`, `e2e/mockApi.ts`
  - Acceptance criteria the planner set:
    - Page lists receipts newest first with name, date added, upload status and extraction status, and loads more pages with a limit
    - Thumbnail or file icon shown per row
    - Wrong type and over 10 MB show a clear error and send nothing
    - Progress is visible during upload and the list refreshes on success
    - Remove asks for confirmation naming the file and soft-deletes only after confirm
    - Component tests cover upload success, refusal and the list states
    - Screenshots at 390 px and 1440 px produced
    - npm run lint, typecheck, test and build pass
  - Commit: `50b1c93be46a`

- [x] **Task 5: Fix (recovered): address 11 review findings (cycle 1)** (after 4)
  - Intent: Review left 11 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The server work (GET list with cursor paging, presigned read URLs, owner scoping, index migration) and the upload/list/remove flow are correct, and validation passed. Unde The agent is fixing them; nothing is needed from you.
  - Commit: `000ca1a98708`

- [x] **Task 6: Fix: address 11 review findings (cycle 0)** (after 5)
  - Intent: Review left 11 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The server work (GET list with cursor paging, presigned read URLs, owner scoping, index migration) and the upload/list/remove flow are correct, and validation passed. Unde The agent is fixing them; nothing is needed from you.
  - Commit: (none — no code change for this task)

- [x] **Task 7: Fix: address 33 review findings (cycle 1)** (after 6)
  - Intent: Review left 33 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Fix the field-name mismatch between the extraction store and the page. The extraction code (`api/_lib/receiptExtraction.ts:13`) stores `date`, `vendor`, `totalPence`, `vat The agent is fixing them; nothing is needed from you.
  - Commit: `c08812924e83`
