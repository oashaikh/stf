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

## Out of scope

- Final declaration / crystallisation
- Entering manual adjustments (balancing charges, capital allowances) not already in the books
- A UI for the quarterly update
- Retrieving or amending a previously submitted annual submission from HMRC

## User journey

Starts at: Signed-in owner opens the Tax page

1. Tax page, annual allowances and adjustments section (`src/pages/TaxPage.tsx and src/pages/ItsAnnualSection.tsx`)
   - Before: Tax page shows estimate, mileage, expense method choice and Income Tax obligations, with no way to send annual figures
   - After: New section previews annual figures with the trading allowance choice, then offers Confirm (declaration) and Submit, with a sandbox label
   - Depends on: STF-31 trading allowance choice on the same page; STF-85 HMRC connection, business and NINO set up in Settings

Also depends on:
- STF-85
- STF-31

## Tasks

- [ ] **Task 1: Pure builder for the annual allowances and adjustments body**
  - Intent: Add src/lib/itsAnnualSubmission.ts exporting an AnnualSubmission type (HMRC pounds strings) and buildAnnualSubmission(summary), modelled on buildCumulativePeriodSummary. It takes the TaxYearSummary, whose expenseMethod is the STF-31 trading allowance choice and whose tradingAllowancePence comes from getTaxBands. When the choice is 'allowance' it emits allowances.tradingIncomeAllowance and no expense-type adjustments. When 'actual' it emits no trading allowance. Conversion uses the existing integer-pence to pounds helper; no floats, no hard-coded band values. Tests cover both choices, a zero amount, a loss year, and the rule that allowance and expenses are never both sent.
  - Files: `src/lib/itsAnnualSubmission.ts`, `src/lib/itsAnnualSubmission.test.ts`
  - Acceptance criteria the planner set:
    - buildAnnualSubmission is pure and has no I/O
    - 'allowance' choice yields tradingIncomeAllowance equal to the pounds string of the tax-year band value
    - 'actual' choice yields no tradingIncomeAllowance
    - Output amounts are two-decimal strings derived from integer pence
    - npm test, lint and typecheck pass

- [ ] **Task 2: HMRC client call for the annual submission, with sandbox test** (after 1)
  - Intent: Add submitAnnualSubmission to src/lib/hmrc/client.ts: PUT /individuals/business/self-employment/{nino}/{businessId}/annual/{taxYear} through hmrcFetch with fraud headers and the existing Accept version, next to submitCumulativePeriodSummary, with the same 'only call after confirmation' doc comment. Add a path helper and unit tests with a fake fetch. Add a describe.skipIf sandbox integration test, skipped when HMRC_CLIENT_ID, HMRC_SANDBOX_NINO or HMRC_SANDBOX_REFRESH_TOKEN are unset, always sandbox mode. Add a comment to recheck endpoint and field names against current HMRC docs.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `src/lib/hmrc/sandbox.integration.test.ts`
  - Acceptance criteria the planner set:
    - A unit test asserts method PUT, path, Accept header, fraud headers and JSON body
    - The integration test is skipped, not failed, without credentials
    - No live network call in the default test run
    - npm test passes

- [ ] **Task 3: Table and migration to lock and audit annual submissions**
  - Intent: Add an its_annual_submissions table to server/src/db/schema.ts, modelled on its_submissions but keyed on (user_id, tax_year, sandbox) with no quarter. Columns: status confirmed/pending/submitted/rejected, confirmed_payload, confirmed_at, submitted_at. Add migration 0023_its_annual_submissions.sql (0022 is claimed by STF-74), the _journal.json entry with a unique tag, plus a snapshot if the repo keeps them. Include the unique index and grants (). Add a schema test mirroring the 0021 one.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0023_its_annual_submissions.sql`, `server/src/db/migrations/meta/_journal.json`
  - Acceptance criteria the planner set:
    - Migration version is not used by any other live plan and leaves a single head
    - Unique index exists on user_id, tax_year, sandbox
    - New table is granted only to the roles that use it
    - Schema test and typecheck pass
  - Risk: Opus/high: schema and migration work. Shares schema.ts, schema.test.ts and _journal.json with STF-74; hunks should not overlap but re-check against base before finishing.

- [ ] **Task 4: Preview, confirm and submit logic and routes for the annual submission** (after 1, 2, 3)
  - Intent: Add api/_lib/itsAnnualSubmit.ts as the annual counterpart of itsSubmit.ts. Preview reuses checkItsReadiness and the summary store and builds the body server-side. Confirm requires declaration:true, recomputes and stores the snapshot, writes an audit event. Submit requires confirm:true, claims confirmed to pending atomically (the lock), calls submitAnnualSubmission with fraud headers via withUserTokens/requestFraudHeaders outside any transaction, then records receipt and audit, or marks rejected on an HMRC error; unknown outcome stays pending. Add routes api/hmrc/its-annual-preview.ts, its-annual-confirm.ts, its-annual-submit.ts mirroring the cumulative routes (withAuth, strict zod schema on taxYear, no body in logs). Tests: store flow with fakes, and route tests for the gate (submit without confirmation refused, double submit refused, second user cannot submit another user's confirmation, ITSA disabled and live-mode refusals, payload never taken from the request). Add the routes to docs/security/input-inventory.md.
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

- [ ] **Task 5: Annual allowances and adjustments section on the Tax page** (after 4)
  - Intent: Add src/lib/itsAnnualApi.ts (fetch wrappers for the three routes). Add src/pages/ItsAnnualSection.tsx, following the ItsObligationsSection pattern, and mount it in src/pages/TaxPage.tsx under the expense method section. Preview button shows the trading allowance choice and figures (formatPence, right-aligned tabular figures). A declaration checkbox enables Confirm; Submit is enabled only after a confirmed state, with a sandbox label. Use shared StateMessage for loading/empty/error, 44px tap targets, focus states, design tokens. Component tests mock the API client and cover the gating states. Capture screenshots at 390 and 1440 px (light and dark if both exist) for the PR.
  - Files: `src/lib/itsAnnualApi.ts`, `src/pages/ItsAnnualSection.tsx`, `src/pages/ItsAnnualSection.test.tsx`, `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`
  - Acceptance criteria the planner set:
    - Submit stays disabled until the declaration is ticked and confirm has succeeded
    - Section shows the chosen trading allowance and amounts via formatPence
    - Existing TaxPage tests still pass with new queries mocked to return defined data
    - Screenshots at 390 and 1440 px captured
    - lint, typecheck, test and build pass

- [ ] **Task 6: Document the annual submission workflow** (after 4)
  - Intent: Add an annual submission section to docs/workflows/its-quarterly-update.md covering the endpoint, confirm and submit lifecycle, the lock, audit events, sandbox/live gating and the trading allowance rule. Keep examples in line with the client code.
  - Files: `docs/workflows/its-quarterly-update.md`
  - Acceptance criteria the planner set:
    - The doc names the three routes and the status lifecycle
    - Examples match the field names in the builder
