# STF-49: Mileage log at HMRC approved rates

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

- Miles are stored and claimed as whole integers; fractional miles are rejected at the API.
- The 10,000-mile threshold applies to cars and vans combined; motorcycles (24p) and bicycles (20p) are flat rate with no threshold. Rates are the long-standing HMRC values and must be re-verified on gov.uk by the implementer for 2024-25 to 2026-27.
- Trips within a tax year are ordered by date, then created_at, then id when applying the threshold.
- The ticket's 'void' means soft delete via deleted_at; voided trips are excluded from lists and claims.
- Migration number 0011 is chosen to avoid the 0010 prefix owned by the STF-9 plan; the implementer re-checks the journal head against the base branch.
- The Tax page only gains a Mileage section; the broader Tax Estimate feature stays out of scope.
- No dark theme is shipped, so light screenshots only.

## Out of scope

- Tax estimate calculation UI on TaxPage beyond the Mileage section
- Editing a trip (only add, list, void)
- Mileage for actual-cost vehicle claims or flagging conflicts with ledger vehicle running costs
- Passenger or business-use-of-home rates
- Scottish tax year variants
- Changes to e2e/mockApi.ts and e2e/journey.spec.ts (owned by STF-81)
- Receipts or CSV export of trips

## User journey

Starts at: Owner signs in and opens Tax from the main navigation (/tax)

1. Tax page, Mileage section (`src/pages/TaxPage.tsx and src/pages/MileageSection.tsx (route registered in src/App.tsx line 42)`)
   - Before: Heading 'Tax Estimate' with 'Coming soon.'
   - After: Mileage section with tax year selector, year claim and miles, add-trip form, trips list with per-trip claim and Void with confirmation
   - Depends on: STF-25 tax year summary (merged); api/mileage.ts from this ticket

Also depends on:
- STF-25

## Tasks

- [x] **Task 1: Mileage rates in taxBands.ts and pure claim function**
  - Intent: Add HMRC simplified-mileage rates keyed by tax year to src/lib/taxBands.ts (integer pence per mile: cars/vans 45p for the first 10,000 miles then 25p, motorcycles 24p flat, bicycles 20p flat; threshold 10,000 miles per tax year, counted across cars and vans together; verify against gov.uk simplified expenses and record the source in the file header like the existing bands, covering 2024-25 to 2026-27). Add src/lib/mileage.ts with a pure calculateMileageClaim(trips, taxYear) returning total claim pence plus per-trip claim pence. Trips are filtered to the tax year by date (6 April to 5 April inclusive, reuse taxYearPeriod from taxYearSummary.ts), ordered by date then createdAt then id, and the threshold runs cumulatively through that order so a trip crossing 10,000 miles is split between the 45p and 25p rate. Miles are whole integers, no floats; reject or ignore non-positive and non-integer miles at the validation layer in task 3, but the function must not use floating point. Tests cover: below threshold, exactly at threshold, one trip straddling the threshold, all trips after threshold, motorcycle and bicycle flat rates not consuming the car threshold, 5 April trip counted in the old year and 6 April trip in the new year with the threshold restarting at 6 April, a trip in a year with no rates throws like getTaxBands, and order independence of input array.
  - Files: `src/lib/taxBands.ts`, `src/lib/taxBands.test.ts`, `src/lib/mileage.ts`, `src/lib/mileage.test.ts`
  - Acceptance criteria the planner set:
    - Mileage rates live only in src/lib/taxBands.ts keyed by tax year; no rate literal in components or the API
    - calculateMileageClaim uses integer arithmetic only and returns pence
    - Tests exist and pass for threshold crossing within a year, exactly at threshold, and the 5/6 April boundary with threshold reset
    - npm run lint, typecheck and test pass
  - Risk: Money and tax logic; rate values must be checked against gov.uk before being committed.
  - Commit: `5e215cf89f44`

- [x] **Task 2: mileage_trips table, Drizzle schema and migration**
  - Intent: Add a mileageTrips table to server/src/db/schema.ts: id uuid pk, userId uuid not null referencing users, date date not null, fromPlace text not null, toPlace text not null, purpose text not null, miles integer not null (check > 0), vehicleType as a pgEnum ('car_van','motorcycle','bicycle'), createdAt, deletedAt (soft delete, void sets it; never DELETE). Index on (user_id, date) for the per-year loader and list, with a comment naming the queries it serves, matching the existing style. Add migration server/src/db/migrations/0011_mileage_trips.sql with matching meta/_journal.json entry (idx 11) and meta/0011_snapshot.json, using CREATE ... IF NOT EXISTS style like earlier files. Use 0011 rather than 0010 because the STF-9 plan owns 0010_invoices_list_indexes; parent on the current head and, before finishing, re-check against the base branch that the journal has a single head and no duplicate idx/prefix, rebasing the number if STF-9 has landed. Extend server/src/db/schema.test.ts to cover the new table and index. Generate with drizzle-kit if it works offline (no Docker); otherwise hand-write consistent with the snapshot format.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0011_mileage_trips.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0011_snapshot.json`
  - Acceptance criteria the planner set:
    - Table has user_id, deleted_at, vehicle type enum and an index on (user_id, date)
    - Migration, journal and snapshot agree and there is a single journal head
    - schema.test.ts asserts the new table/index
    - npm run typecheck and test pass
  - Risk: Schema and migration work; shared schema.ts and journal files are also edited by the STF-9 plan so keep hunks small and re-check the head.
  - Commit: `f059ea86c769`

- [x] **Task 3: Mileage API route: add, list, void trips scoped to the session owner** (after 1, 2)
  - Intent: Create api/_lib/mileage.ts with a MileageStore interface (injected so tests use a fake), validation (date YYYY-MM-DD real date, from/to/purpose non-empty trimmed with length caps, miles positive integer with a sane cap, vehicleType in the enum, id must be a uuid), list/add/void functions and a databaseMileageStore using Drizzle. Every query filters on userId from withAuth (never a client value), excludes deleted_at rows, has an explicit LIMIT (list takes a taxYear param parsed with parseTaxYearPeriod from api/_lib/taxYearSummary.ts and a MILEAGE_TRIP_LIMIT), and carries a 'Query audit' comment like api/_lib/taxYearSummary.ts. Void is an UPDATE setting deleted_at scoped by id AND user_id, returning 404 when no row matched so another user's id is refused. Create api/mileage.ts exporting createMileageHandler (GET list for ?taxYear=, POST add, PATCH or DELETE-method void with body id) and default { fetch }, in the same shape as api/accounts.ts. The GET response also returns the year's claim computed with calculateMileageClaim so the client does no tax maths. Tests in api/_lib/__tests__/mileageRoute.test.ts: unauthenticated refused, validation failures, owner id comes from the session and a client-supplied userId in the body is ignored, second user voiding the first user's trip id gets 404 and the trip stays, voided trips drop out of list and claim, list is bounded.
  - Files: `api/_lib/mileage.ts`, `api/mileage.ts`, `api/_lib/__tests__/mileageRoute.test.ts`
  - Acceptance criteria the planner set:
    - Route requires sign-in and every store call receives auth.userId
    - Void is soft (deleted_at) and a second user's id is refused with a test showing it
    - Every query has a user_id filter and an explicit limit; no select *
    - apiRoutes.test.ts still passes for the new route file (default fetch export, .js import extensions)
    - npm run lint, typecheck and test pass
  - Risk: Per-owner data access and authorisation on a record id; needs tenant-isolation tests.
  - Commit: `f98b91666511`

- [x] **Task 4: Feed the year's mileage claim into the tax year summary as travel** (after 3)
  - Intent: Change buildTaxYearSummary in src/lib/taxYearSummary.ts to take the mileage claim pence (default 0 not needed; make it an explicit argument and update callers) and add it to the 'travel' expense category total, so allowableExpensesPence and netProfitPence include it; if no travel category exists yet create the row. Update getTaxYearSummary and the TaxYearSummaryStore in api/_lib/taxYearSummary.ts to also load the owner's non-deleted trips for the period (one bounded, user-scoped query, reuse the loader from api/_lib/mileage.ts rather than writing a second one) and compute the claim with calculateMileageClaim for the tax year of the period. Update taxYearSummary.test.ts and taxYearSummaryRoute.test.ts (fake store gains the trips loader): claim adds to travel alongside ledger travel spend, zero trips changes nothing, voided trips excluded, net profit drops by the claim.
  - Files: `src/lib/taxYearSummary.ts`, `src/lib/taxYearSummary.test.ts`, `api/_lib/taxYearSummary.ts`, `api/_lib/__tests__/taxYearSummaryRoute.test.ts`
  - Acceptance criteria the planner set:
    - Summary travel total equals ledger travel plus the mileage claim and net profit reflects it
    - The trips query is scoped by session user id and bounded
    - Existing summary tests updated and passing; lint, typecheck and test pass
  - Commit: `365c3c607733`

- [x] **Task 5: Mileage section on the Tax page with API client** (after 3)
  - Intent: Add src/lib/mileageApi.ts (fetch client in the style of entriesApi.ts/accountsApi.ts: list for a tax year, add, void, using the shared money formatter for display, never floats) and src/pages/MileageSection.tsx rendered from src/pages/TaxPage.tsx under the existing h1 (replace the 'Coming soon' placeholder only as needed; keep the Tax Estimate heading). Section shows a tax year selector (default currentTaxYear, options from TAX_BANDS keys), the year's claim total and miles, an add-trip form (date, from, to, purpose, miles, vehicle type) with inline validation and a draft-free direct save, a list of trips with the per-trip claim, and a Void button that asks for confirmation naming the trip and the effect on the claim (). Include a short note that simplified mileage means no actual running costs can be claimed for that vehicle. Use shared loading/empty/error components, type-scale and colour tokens, 44 px tap targets, right-aligned tabular money, rows that collapse on a phone (follow EntriesList.tsx and ReportsPage.tsx patterns and the shared page container, not a page-level max-width), visible focus. Component tests with the API client mocked in src/pages/MileageSection.test.tsx: renders trips and claim, add flow posts the right body, void confirm flow, error state.
  - Files: `src/lib/mileageApi.ts`, `src/pages/MileageSection.tsx`, `src/pages/MileageSection.test.tsx`, `src/pages/TaxPage.tsx`
  - Acceptance criteria the planner set:
    - Tax page at /tax shows the Mileage section reachable from the existing nav
    - Add and void work against /api/mileage and the claim comes from the server response
    - Void requires confirmation that says what it affects
    - Component tests pass with the API client mocked; lint, typecheck, test and build pass
  - Commit: `3f3147f42409`

- [x] **Task 6: Screenshots and workflow doc** (after 4, 5)
  - Intent: Run the app against a mocked or throwaway API with invented trips and capture the Tax page Mileage section at 390 px and 1440 px (light only; no dark theme is shipped unless the repo has one) as browser-evidence/STF-49/390-light-tax.png and browser-evidence/STF-49/1440-light-tax.png, plus the empty and error states if cheap. Do not edit e2e/mockApi.ts or e2e/journey.spec.ts (STF-81 owns them); use a throwaway Playwright script or route interception outside the repo. Add docs/workflows/mileage.md covering rates and where they live, the threshold and 5/6 April rule, void semantics, that the claim feeds the tax year summary travel line, and the no-actual-costs caveat. Fixtures invented only.
  - Files: `browser-evidence/STF-49/390-light-tax.png`, `browser-evidence/STF-49/1440-light-tax.png`, `docs/workflows/mileage.md`
  - Acceptance criteria the planner set:
    - Both screenshots exist at the stated paths and show only invented records
    - docs/workflows/mileage.md exists
    - npm run lint, typecheck, test and build pass on the final tree
  - Commit: `b22a1aa640c7`
