# STF-19: HMRC MTD VAT submit (sandbox → production)

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

- users.hmrc_sandbox_mode=false is the 'user opt-in' flag; api/hmrc/connect.ts already refuses connect when it disagrees with HMRC_SANDBOX_MODE, and no Settings control sets it yet, hence task 5.
- The period to submit is the STF-16 obligation periodKey passed by the client; the server recomputes boxes via STF-18's requireConfirmed and never trusts client boxes.
- Existing boxesToHmrcPayload in src/lib/vat.ts is reused for the payload (it uses parseFloat at the API boundary on already-integer pence; HMRC needs decimal JSON numbers).
- A new vat_submissions table is preferable to columns on vat_return_drafts so a sandbox rehearsal never blocks the live filing; the unique key is the idempotency lock.
- Audit events go in the existing audit_events table (no schema change) with request/response in afterSnapshot, minus Authorization/tokens.
- No Docker/DB is needed: all new store logic is tested through injected fakes like the existing vatReturns tests.
- Plan has to stay in 7 tasks; tasks 5 and 6 can run in parallel after 2 and 4 respectively, but file overlap on hmrcStore.ts/vatReturns.ts argues for running sequentially.

## Out of scope

- Reconciling a 'pending / outcome unknown' submission automatically against HMRC obligations or the VAT returns view endpoint
- Amending or re-filing a submitted return, and payments/liabilities/penalties endpoints
- Fraud-prevention header test-endpoint validation against HMRC (needs credentials)
- Any live HMRC call or credentials; every test mocks HMRC
- Making the SPA send the x-stf-* browser fraud headers if not already sent by the existing client
- Rate limiting infrastructure if the repo has none

## Tasks

- [x] **Task 1: Add vat_submissions table and migration 0003**
  - Intent: Create the persistence for submissions: a new append-friendly table vat_submissions (id, user_id FK, period_key, sandbox boolean, status enum pending|submitted|failed, form_bundle_number, processing_date, submitted_at, created_at, updated_at) with UNIQUE(user_id, period_key, sandbox). That unique key is the idempotency lock: a period can only ever have one pending/submitted row per HMRC environment. A separate table (not columns on vat_return_drafts) means a sandbox rehearsal never blocks the real filing and the draft row stays untouched. Add the drizzle schema entry, exported row types, generated migration 0003 chained after 0002 in meta/_journal.json with its snapshot, and extend schema.test.ts. Single migration head. No financial row is ever deleted; failed attempts are flipped to 'failed', never removed.
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/0003_vat_submissions.sql`, `server/src/db/migrations/meta/0003_snapshot.json`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/schema.test.ts`
  - Acceptance criteria the planner set:
    - Migration 0003 is parented on 0002 and the journal has a single head with a fresh unique 'when' value
    - vat_submissions has a unique constraint on (user_id, period_key, sandbox) which doubles as the lookup index
    - Only receipt fields needed by the feature are stored (form bundle number, processing date); no tokens or Authorization headers
    - schema.test.ts asserts the new table, its unique constraint and the status enum values
    - npm run typecheck and npm test pass
  - Risk: Schema/migration and the idempotency lock are data work where a mistake permits a double filing with HMRC; opus high.
  - Commit: `e2def7f066f3`

- [x] **Task 2: Submission store: atomic claim, receipt, release, audit, and reopen guard** (after 1)
  - Intent: Extend VatReturnStore in api/_lib/vatReturns.ts (and databaseStore) with: claimSubmission(userId, period, sandbox) as one INSERT ... ON CONFLICT DO NOTHING (or conditional UPDATE failed->pending) RETURNING, so two concurrent requests cannot both win; recordReceipt(...) which sets status=submitted plus form bundle number and processing date AND writes the audit event vat_return.submitted in one transaction; markFailed(...) for definite HMRC rejections (4xx) that releases the claim and writes a vat_return.submit_failed audit event; ambiguous outcomes (network error, 5xx, timeout) leave the row pending so a retry is refused. The audit afterSnapshot stores the full request payload and the full HMRC response body (or error body) and the fraud headers, but never the Authorization header or tokens. No network call inside any transaction (claim commits first, HMRC call happens after, receipt is a second transaction). Also fix the shared saveDraft and confirm paths so a non-sandbox submitted/pending return cannot be reopened or re-confirmed (change the shared function once, not the routes). Queries are keyed on (user_id, period_key, sandbox), bounded, and scoped by userId.
  - Files: `api/_lib/vatReturns.ts`, `api/_lib/__tests__/vatReturns.test.ts`
  - Acceptance criteria the planner set:
    - Two concurrent claims for the same user/period/mode: exactly one succeeds (tested against the in-memory fake store contract and the SQL shape is a single conditional statement)
    - A pending or submitted row blocks a second claim; a failed row can be re-claimed
    - Audit event payload contains request and response but a test asserts it contains no Authorization value or token strings
    - saveDraft(reopen) and confirm are refused for a production-submitted period; sandbox-submitted periods are not locked
    - Receipt write and audit insert occur in one transaction; no HMRC call happens between begin and commit
    - npm test passes
  - Risk: Idempotency, audit integrity and token-leak avoidance in a financial submission path; opus high.
  - Commit: `8885ddc945df`

- [x] **Task 3: Submit domain function with confirmed gate and sandbox/production gate** (after 2)
  - Intent: Add submitVatReturnForUser in a new api/_lib/vatSubmit.ts (kept out of vatReturns.ts to stay near the size guide). Flow: (1) requireConfirmed from STF-18 recomputes boxes server-side and rejects NOT_CONFIRMED/STALE_CONFIRMATION, so client-sent boxes are never trusted; (2) mode gate: sandbox unless process.env.HMRC_SANDBOX_MODE==='false' AND the user's stored opt-in (users.hmrc_sandbox_mode===false via HmrcStore.sandboxMode) are BOTH set; if the user flag and env disagree, refuse with 409 (same rule as api/hmrc/connect.ts) and never fall through to production; (3) require HMRC connected and vatNumber; (4) claim the submission; (5) build payload with the existing boxesToHmrcPayload (finalised true, periodKey from the request, which comes from STF-16 obligations) and call submitVatReturn through withHmrcToken with the same refresh/persist pattern as api/vat/obligations.ts and buildFraudHeaders (WEB_APP_VIA_SERVER, Gov-Client-User-IDs, Gov-Vendor-Version); (6) on success record receipt + audit; on HmrcError 4xx mark failed; on anything else leave pending and return an explicit 'outcome unknown, do not resubmit' error. Duplicate HMRC response (DUPLICATE_SUBMISSION) is treated as submitted-elsewhere, not retried. Tests use fake fetch and fake stores only, never live HMRC, and include: a nil return (all nine boxes zero) end to end, 401 refresh-and-retry, mode-gate matrix (env x opt-in, all four combos), double submit refused, ledger-changed refused, other-user refused.
  - Files: `api/_lib/vatSubmit.ts`, `api/_lib/__tests__/vatSubmit.test.ts`, `src/lib/vat.ts`
  - Acceptance criteria the planner set:
    - Production URL is reachable only when env HMRC_SANDBOX_MODE==='false' AND user opt-in is true; the other three combinations use sandbox or refuse, asserted by test
    - Nil return with all nine boxes 0 submits against a mocked HMRC and stores the receipt
    - Request carries Gov-Client-Connection-Method WEB_APP_VIA_SERVER, Gov-Client-User-IDs and Gov-Vendor-Version stf=<version> (asserted on the mocked fetch)
    - Second submit for same period returns 409 without calling HMRC
    - HMRC 500/network error leaves row pending and a retry is refused
    - No test reaches the network; npm test passes
    - If boxesToHmrcPayload is touched, its doc comment path is corrected and existing vat.test.ts still passes
  - Risk: Money going to a tax authority plus the production gate and token handling; opus high.
  - Commit: `7a1a90092a46`

- [x] **Task 4: POST /api/vat/submit route** (after 3)
  - Intent: Add api/vat/submit.ts as a thin handler wrapped in withAuth (), validating the body with periodSchema (periodKey/start/end) plus a literal confirm check, rejecting non-POST with 405, mapping VatReturnError/HmrcError to the shared vatErrorResponse shape, and returning only the receipt (formBundleNumber, processingDate, sandbox) per. Handler is injectable (store, hmrc store, fetchFn, refresh, now) following api/vat/obligations.ts and return-confirm.ts. Rate limit follows whatever the repo uses for other vat routes (note if none exists). Route tests cover 401 unauthenticated, 405, 400 bad body, 409 states, 200 receipt, and a second user's period being refused.
  - Files: `api/vat/submit.ts`, `api/_lib/__tests__/vatSubmit.test.ts`
  - Acceptance criteria the planner set:
    - Unauthenticated request is refused before any DB or HMRC access
    - Response body contains only receipt fields and sandbox flag, no tokens, no echo of HMRC raw body
    - Another user's periodKey cannot be submitted or read (no cross-user row touched)
    - npm run lint, typecheck and test pass
  - Risk: Auth and tenant isolation on a new write route; opus high.
  - Commit: `aab055222cbc`

- [x] **Task 5: Settings opt-in for live HMRC submission** (after 2)
  - Intent: Give users the 'user opt-in in Settings' half of the gate. Add a small authenticated endpoint api/hmrc/mode.ts (GET current opt-in, POST {live: boolean}) that writes users.hmrc_sandbox_mode via an HmrcStore method (setSandboxMode), and a Settings section with a clearly worded checkbox/toggle: default off, explains live filing is only possible when the server is also in production mode, requires explicit confirmation text when switching on, and shows the effective mode. Changing the flag also needs the user to reconnect HMRC because tokens are per environment (connect.ts already enforces); surface that hint. Add settingsApi helpers and tests (SettingsPage.test.tsx with the API mocked, store test for the new method). Controls meet 44px targets, focus states and shared tokens.
  - Files: `api/hmrc/mode.ts`, `api/_lib/hmrcStore.ts`, `api/_lib/__tests__/hmrc.test.ts`, `src/lib/hmrc/settingsApi.ts`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`
  - Acceptance criteria the planner set:
    - Default for a new user remains sandbox (opt-in off)
    - POST validates a boolean body, requires auth and only touches the caller's row
    - Settings page shows the toggle, its confirmation wording and the effective mode; test covers off->on requiring confirmation
    - UI screenshots at 1440 and 390 px are produced for the PR
    - lint, typecheck, test, build pass
  - Risk: Flips the switch that permits live tax filing; permission-related, so opus high for the endpoint and store change.
  - Commit: `91b4149b76c7`

- [x] **Task 6: Submit button, receipt display and API client on the VAT page** (after 4)
  - Intent: Wire the UI: add submitVatReturn call to src/lib/hmrc/vatApi.ts, extend reviewState (vatReviewState.ts) with submit states (confirmed and not stale -> can submit; submitting; submitted showing form bundle number and processing date; sandbox label 'Sandbox test submission' so a rehearsal is never mistaken for a real filing; unknown-outcome state telling the user not to retry and to check HMRC). VatPage shows a submit button after confirmation with a confirm dialog that states the period, net VAT in the page's money format (formatPence, right aligned, tabular) and whether this goes to HMRC sandbox or live; no HMRC submit without the dialog (). Uses shared loading/error components and the existing query patterns; no new dependency. Tests: vatReviewState.test.ts for each state, vatApi.test.ts with fetch mocked.
  - Files: `src/lib/hmrc/vatApi.ts`, `src/lib/hmrc/vatApi.test.ts`, `src/pages/vatReviewState.ts`, `src/pages/vatReviewState.test.ts`, `src/pages/VatPage.tsx`
  - Acceptance criteria the planner set:
    - Submit is disabled until the return is confirmed and not stale, and disabled again after a successful submit
    - Dialog names period, amount and sandbox/live before the request is sent; Escape closes it and focus is trapped
    - Receipt (form bundle number, processing date) renders after success and on reload
    - Nil return renders and submits without special casing
    - lint, typecheck, test, build pass
  - Commit: `ed4cd2e08088`

- [x] **Task 7: Docs and env example for submission** (after 4)
  - Intent: Document the flow: update docs/workflows/vat-return.md with the submit step, the double gate (HMRC_SANDBOX_MODE=false AND Settings opt-in), idempotency states (pending/submitted/failed and what 'outcome unknown' means), audit event names and what is stored, and that every test mocks HMRC. Add an .env.example comment on HMRC_SANDBOX_MODE (default true; production needs the Settings opt-in too) only if not already documented. No secrets, no real values.
  - Files: `docs/workflows/vat-return.md`, `.env.example`
  - Acceptance criteria the planner set:
    - Doc describes both gates, the three submission states and recovery for an unknown outcome
    - No credentials, job ids or machine paths appear
    - lint and typecheck pass
  - Commit: `1bad2bfcab7b`

- [x] **Task 8: Fix: address 6 review findings (cycle 1)** (after 7)
  - Intent: Review left 6 findings unresolved (NEEDS_WORK): **correctness** — APPROVED Correctness lens found nothing blocking. Idempotency uses a single conditional upsert on the unique key. The mode gate requires env and user opt-in to agree, with all four c The agent is fixing them; nothing is needed from you.
  - Commit: `73f23a889c53`
