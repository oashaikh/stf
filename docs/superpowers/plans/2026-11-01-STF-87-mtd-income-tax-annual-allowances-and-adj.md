# STF-87: MTD Income Tax: annual allowances and adjustments submission

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

- STF-85's checkItsReadiness, hmrcCall helpers and the confirm/claim/receipt pattern in api/_lib/itsSubmit.ts are reused, not rewritten.
- The STF-31 trading allowance choice is already stored and surfaced as TaxYearSummary.expenseMethod.
- HMRC annual submission is a PUT to .../self-employment/{nino}/{businessId}/annual/{taxYear}; exact field names must be rechecked against current HMRC docs.
- Annual submissions get their own table rather than a nullable quarter on its_submissions.
- Migration prefix 0023 is used because STF-74 plans 0022.
- docs/design/ease-of-use.md does not exist in this worktree, so the flow follows the owner's 1 Nov ticket comment. Anything it does not cover is asked in the ticket, not guessed.
- No Home to-do list or dark theme exists yet; the Tax page link is the interim entry point and screenshots are light-only unless a dark theme lands first.

## Out of scope

- Final declaration / crystallisation
- Entering manual adjustments (balancing charges, capital allowances) not already in the books
- Building the Home to-do list or the six-item menu
- Retrieving or amending a previously submitted annual submission from HMRC

## User journey

Starts at: Signed-in owner opens the Tax page (later: the Home to-do list item for Income Tax year end)

1. Tax page link (`src/pages/TaxPage.tsx`)
   - Before: Tax page shows estimate, mileage, expense method choice and Income Tax obligations, with no way to send annual figures
   - After: A plain link 'Do your Income Tax year end' opens the guided flow
   - Depends on: STF-31 trading allowance choice on the same page
2. Year end guided flow, steps 1 to M-1 (`src/pages/YearEndFlow.tsx`)
   - Before: Does not exist
   - After: One figure or choice per screen with Step N of M, Back, Save and leave, pre-filled values and a 'Why is this amount?' link
   - Depends on: STF-85 HMRC connection, business and NINO set up in Settings
3. Year end guided flow, last step (`src/pages/YearEndFlow.tsx`)
   - Before: Does not exist
   - After: One plain sentence of what is being sent, the declaration and a Send to HMRC button with sandbox label
   - Depends on: Annual submission API routes
4. Route registration (`src/App.tsx`)
   - Before: No year end route
   - After: /tax/year-end behind sign-in

Also depends on:
- STF-85
- STF-31

## Tasks

- [x] **Task 1: Pure builder for the annual allowances and adjustments body**
  - Intent: Add src/lib/itsAnnualSubmission.ts exporting an AnnualSubmission type (HMRC pounds strings) and buildAnnualSubmission(summary), modelled on buildCumulativePeriodSummary. It takes the TaxYearSummary, whose expenseMethod is the STF-31 trading allowance choice and whose tradingAllowancePence comes from getTaxBands. 'allowance' emits allowances.tradingIncomeAllowance and no expense-type adjustments. 'actual' emits no trading allowance. Conversion uses the existing integer-pence to pounds helper; no floats, no hard-coded band values. Tests cover both choices, a zero amount, a loss year, and the rule that allowance and expenses are never both sent.
  - Files: `src/lib/itsAnnualSubmission.ts`, `src/lib/itsAnnualSubmission.test.ts`
  - Acceptance criteria the planner set:
    - buildAnnualSubmission is pure and has no I/O
    - 'allowance' choice yields tradingIncomeAllowance equal to the pounds string of the tax-year band value
    - 'actual' choice yields no tradingIncomeAllowance
    - Output amounts are two-decimal strings derived from integer pence
    - npm test, lint and typecheck pass
  - Commit: `da1c3381c94b`

- [x] **Task 2: HMRC client call for the annual submission, with sandbox test** (after 1)
  - Intent: Add submitAnnualSubmission to src/lib/hmrc/client.ts: PUT /individuals/business/self-employment/{nino}/{businessId}/annual/{taxYear} through hmrcFetch with fraud headers and the existing Accept version, next to submitCumulativePeriodSummary, with the same 'only call after confirmation' doc comment. Add a path helper and unit tests with a fake fetch. Add a describe.skipIf sandbox integration test, skipped when HMRC_CLIENT_ID, HMRC_SANDBOX_NINO or HMRC_SANDBOX_REFRESH_TOKEN are unset, always sandbox mode. Add a comment to recheck endpoint and field names against current HMRC docs.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `src/lib/hmrc/sandbox.integration.test.ts`
  - Acceptance criteria the planner set:
    - A unit test asserts method PUT, path, Accept header, fraud headers and JSON body
    - The integration test is skipped, not failed, without credentials
    - No live network call in the default test run
    - npm test passes
  - Commit: `227271766927`

- [ ] **Task 3: Table and migration to lock and audit annual submissions**
  - Intent: Add an its_annual_submissions table to server/src/db/schema.ts, modelled on its_submissions but keyed on (user_id, tax_year, sandbox) with no quarter. Columns: status confirmed/pending/submitted/rejected, confirmed_payload, confirmed_at, submitted_at. Add migration 0023_its_annual_submissions.sql (0022 is claimed by STF-74), the _journal.json entry with a unique tag, and snapshot; single migration head. Grant the new table to the app role. Update schema.test.ts. Records are never hard-deleted.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0023_its_annual_submissions.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0023_snapshot.json`
  - Acceptance criteria the planner set:
    - Unique index on (user_id, tax_year, sandbox) so a second submission is refused by the database
    - Migration is parented on the current head and the journal has a single head after rebasing on main
    - Grants for the new table are in the migration
    - npm test passes
  - Risk: Opus/high: schema, migration and role grants. Re-check the 0022 collision with STF-74 before finishing.

- [ ] **Task 4: Preview, confirm and submit logic and routes for the annual submission** (after 1, 2, 3)
  - Intent: Add api/_lib/itsAnnualSubmit.ts reusing checkItsReadiness, the hmrcCall helpers and the claim/confirm/receipt pattern from api/_lib/itsSubmit.ts. Three routes: preview (server recomputes the builder output from the tax year summary), confirm (stores the server-computed payload with the user's declaration), submit (claims the row atomically, calls submitAnnualSubmission outside any DB transaction, records the receipt or rejection). The payload is never taken from the request. Live submission needs HMRC_SANDBOX_MODE=false and user opt-in. Audit rows for confirm, submit and reject. Route tests: submit without confirmation refused, concurrent second submit refused, second user cannot submit another user's confirmation, ITSA disabled and live-mode refusals. Add the routes to docs/security/input-inventory.md. Check how its-* routes are registered and follow that.
  - Files: `api/_lib/itsAnnualSubmit.ts`, `api/hmrc/its-annual-preview.ts`, `api/hmrc/its-annual-confirm.ts`, `api/hmrc/its-annual-submit.ts`, `api/_lib/__tests__/itsAnnualSubmit.test.ts`, `api/_lib/__tests__/itsAnnualSubmitRoute.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Submit is refused with no stored confirmation or after a rejection
    - A concurrent second submit is refused by the claim
    - The HMRC call runs outside any DB transaction
    - The body sent equals the stored server-recomputed snapshot
    - Live mode requires HMRC_SANDBOX_MODE=false and the user opt-in
    - Audit rows are written for confirm, submit and reject
    - Route tests include a different-user refusal
    - npm test passes
  - Risk: Opus/high: HMRC submission, authorisation and idempotency lock. Needs the table (task 3) and client (task 2).

- [ ] **Task 5: Income Tax year end guided flow: steps, figures and send** (after 4)
  - Intent: Replace the Tax-page section with a guided step-by-step flow, per the owner's 1 Nov direction. Add src/lib/itsAnnualApi.ts (fetch wrappers for the three routes). Add src/pages/YearEndFlow.tsx: one thing per screen, 'Step N of M' header, Back and 'Save and leave' on every step (progress resumes on return from the server-side preview/confirm state; no new data collected). Steps: (a) trading allowance choice in plain words, pre-filled from the STF-31 choice and shown via formatPence from tax bands, (b) each remaining figure on its own screen, pre-filled from the preview, with the HMRC field name only in small muted text. Every figure has a 'Why is this amount?' disclosure explaining in plain words where it came from. Final step: one plain sentence of what will be sent, the declaration checkbox, and a 'Send to HMRC' button enabled only after the declaration is ticked and confirm has succeeded, with a sandbox label in sandbox mode. Use StateMessage for loading/empty/error, 44px tap targets, visible focus, design tokens, right-aligned tabular figures. Plain words, no accounting jargon in headings. Component tests mock itsAnnualApi and cover step navigation, Back, Save and leave, Why links, and Send gating. docs/design/ease-of-use.md is absent from this worktree, so follow the ticket comment; where it is silent (exact copy, step count, resume behaviour) ask in the ticket rather than guessing.
  - Files: `src/lib/itsAnnualApi.ts`, `src/lib/itsAnnualApi.test.ts`, `src/pages/YearEndFlow.tsx`, `src/pages/YearEndFlow.test.tsx`
  - Acceptance criteria the planner set:
    - One decision or figure per screen, each with 'Step N of M', Back and Save and leave
    - Every figure has a 'Why is this amount?' explanation; HMRC field names appear only as small muted text
    - Figures are pre-filled from the server preview and shown via formatPence
    - Final step has one plain sentence of what is sent, the declaration and a Send to HMRC button, disabled until the declaration is ticked and confirm has succeeded
    - Sandbox label shown in sandbox mode
    - Component tests mock the API client and pass; lint and typecheck pass

- [ ] **Task 6: Route, entry points and screenshots for the year end flow** (after 5)
  - Files: `src/App.tsx`, `src/App.test.tsx`, `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`, `docs/screenshots/`
  - Acceptance criteria the planner set:
    - The flow is reachable from a link on the Tax page and the route is behind sign-in
    - Existing TaxPage and App tests pass
    - Screenshots of each step at 1440 and 390 px, with captions, use invented data only
    - lint, typecheck, test and build pass

- [ ] **Task 7: Document the annual submission workflow** (after 4)
  - Intent: Add an annual submission section to docs/workflows/its-quarterly-update.md covering the endpoint, confirm and submit lifecycle, the lock, audit events, sandbox/live gating, the trading allowance rule, and the guided year end flow entry points (Tax page link now, Home to-do item later). Keep examples in line with the client code.
  - Files: `docs/workflows/its-quarterly-update.md`
  - Acceptance criteria the planner set:
    - The doc names the three routes and the status lifecycle
    - Examples match the field names in the builder
