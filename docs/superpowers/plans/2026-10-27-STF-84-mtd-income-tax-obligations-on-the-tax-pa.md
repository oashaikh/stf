# STF-84: MTD Income Tax obligations on the Tax page

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

- HMRC_ITSA_ENABLED is referenced only in the STF-83 plan doc on this branch, not in code; the operator says dev has it, so the implementer must merge dev first and reuse the flag it finds, adding a minimal reader only if still absent.
- HMRC Obligations API v3.0 paths are /obligations/details/{nino}/income-and-expenditure and /crystallisation; the exact response shape must be matched to the fixtures recorded from the sandbox.
- Tax year strings and bounds come from src/lib/taxBands.ts and the existing currentTaxYear helper; the latest migration is 0017_hmrc_its_business.
- The stored last-known copy holds only dates and statuses, no NINO.

## Out of scope

- Submitting quarterly updates or the final declaration
- Cumulative or annual submission APIs
- Notifications or reminders for due obligations
- Multiple self-employment businesses beyond the selected business id

## User journey

Starts at: Signed-in user opens the Tax page from the main navigation

1. Tax page (`src/pages/TaxPage.tsx`)
   - Before: Tax estimate, expense method and mileage sections only
   - After: A new Income Tax obligations section lists quarterly updates and the final declaration for the current and previous tax year, with due dates, the next due one highlighted, and a last-known notice if HMRC could not be reached; hidden when HMRC_ITSA_ENABLED is off
   - Depends on: STF-83 HMRC Income Tax connection and selected business id (Settings)

Also depends on:
- STF-83

## Tasks

- [x] **Task 1: HMRC client: ITSA obligations calls plus recorded sandbox fixtures**
  - Intent: Add getItsIncomeAndExpenditureObligations(nino, businessId, fromDate, toDate, status?, ...) and getItsFinalDeclarationObligations(nino, fromDate, toDate, status?, ...) to src/lib/hmrc/client.ts, built on hmrcFetch like getVatObligations. Paths: /obligations/details/{nino}/income-and-expenditure (typeOfBusiness=self-employment, businessId) and /obligations/details/{nino}/crystallisation. The Obligations API needs Accept version 3.0, so pass it via options.headers (hmrcFetch lets options.headers override HMRC_JSON_HEADERS). Export response types (period start/end, due, status Open/Fulfilled, received). Check client.test.ts with a fake fetchFn and recorded sandbox response fixtures (invented NINO/ids, no real data): URL, query, headers incl. fraud headers, status filter, error mapping to HmrcError.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `src/lib/hmrc/fixtures/itsObligations.json`
  - Acceptance criteria the planner set:
    - Both functions only live in client.ts and go through hmrcFetch
    - Tests assert path, query string, Accept 3.0 header and fraud headers on the fake fetch
    - Tests use recorded-shape fixtures with invented identifiers
    - npm run typecheck and npm test pass
  - Commit: `8ddfe98825d1`

- [x] **Task 2: Store last known obligations per user (migration, schema, store methods)**
  - Intent: Persist the last successful obligations result so the route can serve it when HMRC fails. Add a new table (user_id + tax_year key, jsonb payload, fetched_at) in migration 0018 parented on 0017_hmrc_its_business (single head, update drizzle meta journal), the drizzle schema entry, and HmrcStore methods saveItsObligations/lastItsObligations scoped to the caller's user id. Owner-scoped queries, primary-key index, bounded result (two tax years). Include any role grants the existing migrations use. Register the query for the query audit if the repo has one. Test the store against the existing fake/in-memory store pattern, including a second user being unable to read the first user's row. Stored data is financial dates only, no NINO; state retention (replaced on each fetch, deleted with the user).
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/0018_its_obligations_cache.sql`, `server/src/db/migrations/meta/_journal.json`, `api/_lib/hmrcStore.ts`, `api/_lib/__tests__/hmrc.test.ts`
  - Acceptance criteria the planner set:
    - Migration 0018 is the only new migration and the journal has a single head after re-checking against main
    - Store reads and writes filter by user id; a test shows another user gets nothing
    - Saving twice for the same user and tax year replaces the row
    - typecheck and test pass
  - Risk: Schema, migration and per-user data isolation work.
  - Commit: `ff1fa0097519`

- [x] **Task 3: Route GET /api/hmrc/its-obligations with live double switch, flag and stale fallback** (after 1, 2)
  - Intent: New api/hmrc/its-obligations.ts modelled on api/hmrc/its-businesses.ts and api/vat/obligations.ts. Behind withAuth, GET only. Refuse with LIVE_MODE_REFUSED unless user sandbox mode matches HMRC_SANDBOX_MODE (same check as its-businesses). Honour HMRC_ITSA_ENABLED (default off): the merged STF-83 code on this branch has no reference to it outside the plan doc, so after merging dev check whether it exists; reuse it if so, otherwise add one small server-side reader and list it in .env.example. Flag off returns a disabled response and no HMRC call. Needs credentials, NINO (decrypt as its-businesses does), selected business id and ITS scope; return plain-coded 409s otherwise. Compute current and previous tax year from src/lib/taxBands.ts helpers (no hard-coded dates), fetch quarterly and final-declaration obligations for both years via callHmrcAsUser (fraud headers, token refresh), with no DB transaction open during HMRC calls. Add a pure function (e.g. api/_lib/itsObligations.ts) that normalises, adds overdue, and marks the single next-due open item (earliest due date of open items, ties by period start). On success, save to the last-known store and return {ok, obligations, nextDue, stale:false}. On HMRC failure return the stored last known state with stale:true, fetchedAt and a plain-words error message (no raw HMRC body, no NINO in logs or responses); with nothing stored return the error alone. Tests: fake HMRC client and recorded fixtures, flag off, live mode refused, not connected, no business id, success, failure with and without stored state, another user cannot see stored data, next-due selection and overdue edge cases. Register the route in apiRoutes.test.ts.
  - Files: `api/hmrc/its-obligations.ts`, `api/_lib/itsObligations.ts`, `api/_lib/__tests__/itsObligations.test.ts`, `api/_lib/__tests__/itsObligationsRoute.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - With the flag off no HMRC call is made and the response says Income Tax is off
    - Live mode is refused unless both HMRC_SANDBOX_MODE=false and the user opted in
    - Open and fulfilled obligations for current and previous tax year are returned with period start/end and due dates
    - Exactly one open obligation is flagged nextDue
    - On HMRC failure the last stored state is returned with stale true and a plain-words error
    - Tests use a fake fetch/client only; lint, typecheck and test pass
  - Risk: Authorisation, live-mode gate and tenant-scoped data.
  - Commit: `a80a6026eba5`

- [x] **Task 4: Tax page: Income Tax obligations section** (after 3)
  - Intent: Add src/lib/hmrc/itsObligationsApi.ts (fetch wrapper in vatApi/settingsApi style, browser fraud headers via browserFraudHeaders) and a hook, then an ObligationsSection component rendered from src/pages/TaxPage.tsx. Render nothing when the flag is off or HMRC/ITS is not connected (follow how Settings uses itsBusinessId/needsItsReconnect, and link to Settings to connect or choose a business). List quarterly updates and the final declaration, open and fulfilled, grouped by tax year, with period dates and due date; highlight the next due one with text ('Next due', not colour alone) and mark overdue. Dates formatted consistently, rows one line with truncation, use shared loading/empty/error components and the existing type-scale and colour tokens, 44px targets, mobile collapse to labelled rows (). When stale, show 'Showing last known dates from <date>' plus the plain-words error. Tests with the API mocked (): flag off hides section, next-due highlight, overdue, stale banner, error with no data, empty.
  - Files: `src/lib/hmrc/itsObligationsApi.ts`, `src/pages/ItsObligationsSection.tsx`, `src/pages/ItsObligationsSection.test.tsx`, `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`
  - Acceptance criteria the planner set:
    - Section absent when the flag is off, with no request visible to the user
    - Next due obligation shows a text label and distinct styling
    - Error text is plain words and last known data still shows when stale
    - Component tests pass; lint, typecheck, test, build pass
  - Commit: (none — no code change for this task)

- [ ] **Task 5: E2E mock, screenshots at 390 and 1440, workflow docs** (after 4)
  - Intent: Add GET /api/hmrc/its-obligations to e2e/mockApi.ts (flag on, one next-due, one fulfilled, plus a stale variant) and a Tax page scenario in the e2e journey; capture screenshots of the changed Tax page at 1440 px and 390 px (light; dark only if the app ships it) into browser-evidence/STF-84/ using invented data. Write docs/workflows/its-obligations.md (flag, double switch, fraud headers, stale behaviour, retention of the stored copy) and add a line to docs/runbooks/hmrc-sandbox-integration.md. e2e/mockApi.ts and e2e/journey.spec.ts are also being edited by STF-79, so keep hunks small and additive. Run lint, typecheck, test and build; skip anything needing Docker.
  - Files: `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `browser-evidence/STF-84/tax-obligations-1440.png`, `browser-evidence/STF-84/tax-obligations-390.png`, `docs/workflows/its-obligations.md`, `docs/runbooks/hmrc-sandbox-integration.md`
  - Acceptance criteria the planner set:
    - Two screenshots exist at 1440 and 390 px showing the new section with a highlighted next-due item
    - Mock changes are additive and do not alter existing routes
    - Workflow doc covers flag, live double switch and stale fallback
    - npm run lint, typecheck, test and build all pass
