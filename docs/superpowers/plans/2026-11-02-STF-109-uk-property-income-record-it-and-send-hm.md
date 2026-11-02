# STF-109: UK property income: record it and send HMRC's quarterly property updates

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

- UK property is recorded by choosing property-prefixed accounts (same account-per-category model as self-employment), not a new column on entries.
- HMRC's Property Business API cumulative endpoint mirrors the self-employment one; the implementer must verify every field name against HMRC's current docs, since the existing client was written without doc access.
- Property obligations come from the same Obligations API as self-employment, filtered by business id.
- One UK property business per owner; foreign property is excluded.
- Migration prefixes 0025 and 0026 are free: the journal head is 0024.

## Out of scope

- Foreign property, furnished holiday lets, rent-a-room as a separate flow
- Property annual submission and final declaration
- Property losses and a property-specific tax estimate
- Any change to how VAT returns are built, previewed or submitted
- Applying for HMRC production approval

## User journey

Starts at: Tax page (src/pages/TaxPage.tsx), after connecting HMRC

1. Tax page, rental property switch (`src/pages/TaxPage.tsx`)
   - Before: No mention of rental property
   - After: A plain prompt asks whether the owner lets out a UK property and turns on rental categories
   - Depends on: STF-83 HMRC business connection
2. Money in and Money out forms (`src/pages/MoneyInPage.tsx, src/pages/MoneyOutPage.tsx`)
   - Before: Only business categories
   - After: A labelled 'Rental property' group of categories
3. Tax page, updates due (`src/pages/ItsObligationsSection.tsx`)
   - Before: Self-employment quarterly updates only
   - After: Rental property updates listed alongside, each with an action to start the update
4. Guided rental update (`src/pages/ItsUpdatePage.tsx`)
   - Before: Self-employment update flow only
   - After: Step-by-step flow: figures, exact request preview, declaration, 'Send to HMRC', with the test-mode label
   - Depends on: STF-86 quarterly update

Also depends on:
- STF-86
- STF-119
- STF-120
- STF-122
- STF-123

## Tasks

- [x] **Task 1: Find the UK property business id and add the HMRC Property Business client calls**
  - Intent: Done means STF finds the owner's UK property business id from HMRC business details next to the self-employment one, and stores it. src/lib/hmrc/client.ts gets the Property Business API calls: the cumulative path for property, a submit function, and a lister for uk-property businesses. Every call takes the fraud headers and uses the existing hmrcFetch. Add a nullable users.hmrc_its_property_business_id column with migration 0025_uk_property_business (parent: current head 0024, single head, snapshot and journal updated, column granted per). Extend the HmrcStore status and credentials, and api/hmrc/its-businesses.ts, to return and store the property id. Self-employment choice behaviour must not change. A reconnect that changes scope clears the property id the same way it clears the self-employment id. Field names must be checked against HMRC's current Property Business API docs (repo memory says the existing client was never verified), with a comment naming the doc URL. VAT code paths are untouched.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/0025_uk_property_business.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0025_snapshot.json`, `server/src/db/schema.test.ts`, `api/_lib/hmrcStore.ts`, `api/hmrc/its-businesses.ts`, `api/_lib/__tests__/itsBusinessesRoute.test.ts`, `src/lib/hmrc/settingsApi.ts`
  - Acceptance criteria the planner set:
    - client.ts exports a property cumulative path builder, a submit function that sends fraud headers, and a function that lists businesses of type uk-property; unit tests with a fake fetch cover path, headers, accept header and error mapping
    - Migration 0025 adds only the nullable column, leaves one head in the journal, and does not reuse the 0022 prefix
    - its-businesses route stores and returns the property business id; a test shows a user with no property business gets a clear empty result, not an error
    - Existing self-employment tests still pass unchanged; no VAT file is modified
    - npm run lint, typecheck, test and build pass
  - Risk: Opus/high: schema migration and a change to the route that handles HMRC credentials.
  - Commit: `836ec603689a`

- [x] **Task 2: Property income and cost categories, kept apart from self-employment figures**
  - Intent: Done means an owner can record income and expenses against HMRC's UK property categories (rent received, repairs and maintenance, finance costs, premises running costs, professional fees, cost of services, travel, other). Use dedicated accounts with a property- prefixed taxCategory, defined in src/lib/chartOfAccounts.ts as a separate PROPERTY_ACCOUNTS list (not in DEFAULT_ACCOUNTS, so people without a rental see no extra categories). Add an idempotent ensurePropertyAccounts in api/_lib/accounts.ts, exposed through the existing accounts route. Category names are plain words. Update buildTaxYearSummary and getTaxYearSummary so property categories never appear in self-employment income, expenses, profit or the uncategorised list. No new column on entries.
  - Files: `src/lib/chartOfAccounts.ts`, `src/lib/__tests__/chartOfAccounts.test.ts`, `src/lib/taxYearSummary.ts`, `src/lib/taxYearSummary.test.ts`, `api/_lib/taxYearSummary.ts`, `api/_lib/accounts.ts`, `api/_lib/__tests__/accounts.test.ts`, `api/_lib/__tests__/accountsRoute.test.ts`, `api/_lib/__tests__/taxYearSummaryRoute.test.ts`, `src/lib/accountsApi.ts`
  - Acceptance criteria the planner set:
    - ensurePropertyAccounts creates the property accounts once for the caller only and is safe to call twice; a second user cannot see or create them for another user
    - A tax year summary with property income and expenses gives the same self-employment turnover, expenses, profit and uncategorised list as without them
    - All amounts stay integer pence
    - Lint, typecheck, test and build pass
  - Commit: `5219d00c9b4e`

- [x] **Task 3: Build the cumulative property update and its dry-run preview** (after 1, 2)
  - Intent: Done means a pure function maps tax-year-to-date property totals onto HMRC's cumulative property request (fromDate, toDate, ukProperty income and expenses). Pounds strings use the existing pence-to-pounds helper, no floats; only categories HMRC accepts are sent. Add a property summary alongside getTaxYearSummary totalling property- accounts from 6 April to the quarter end. Add api/hmrc/its-property-preview.ts and api/_lib/itsPropertyPreview.ts following the self-employment preview pattern: same schema checks, sandbox guard, audit event, fraud-header dry run, and the exact request body shown. Reuse quarterEndDate and existing helpers. VAT code untouched.
  - Files: `src/lib/itsPropertyUpdate.ts`, `src/lib/itsPropertyUpdate.test.ts`, `api/_lib/itsPropertyPreview.ts`, `api/_lib/__tests__/itsPropertyPreview.test.ts`, `api/_lib/__tests__/itsPropertyPreviewRoute.test.ts`, `api/_lib/taxYearSummary.ts`, `api/hmrc/its-property-preview.ts`, `src/lib/hmrc/itsUpdateApi.ts`
  - Acceptance criteria the planner set:
    - Unit tests cover pence to pounds, empty categories omitted, negative amounts, and each HMRC field mapped from the right category
    - Route test: unauthenticated refused, a user with no property business id gets a plain 409, and a user cannot see another user's figures
    - Preview returns the exact body that would be sent and the fraud headers are present on the dry run
    - Lint, typecheck, test and build pass
  - Commit: `e5d416463238`

- [x] **Task 4: Confirm and submit the property update through the same confirmation gate** (after 1, 3)
  - Intent: Done means property updates are confirmed then submitted exactly like the self-employment update (STF-85): declaration recorded first, payload compared on submit (STALE_CONFIRMATION), claim row blocks double filing, a 4xx marks the row rejected, a 5xx or network failure leaves it pending with OUTCOME_UNKNOWN. Add a business_kind column ('self-employment' | 'uk-property', default 'self-employment') to its_submissions and widen the unique key to include it, in migration 0026 (single head, snapshot, journal, grants). Parameterise the existing itsSubmit.ts by kind rather than copying it. Add property confirm and submit routes. Sandbox default and the live-needs-both-switches guard are kept. Existing self-employment submissions and tests are unaffected; VAT untouched.
  - Files: `api/_lib/itsSubmit.ts`, `api/_lib/__tests__/itsSubmit.test.ts`, `api/_lib/__tests__/itsSubmitRoute.test.ts`, `api/_lib/__tests__/itsPropertySubmitRoute.test.ts`, `api/hmrc/its-property-confirm.ts`, `api/hmrc/its-property-submit.ts`, `api/hmrc/its-cumulative-confirm.ts`, `api/hmrc/its-cumulative-submit.ts`, `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0026_its_submissions_business_kind.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0026_snapshot.json`, `src/lib/hmrc/itsUpdateApi.ts`
  - Acceptance criteria the planner set:
    - Submit without confirm is refused; changed figures after confirm give STALE_CONFIRMATION; a second submit gives ALREADY_SUBMITTED
    - A self-employment and a property submission for the same quarter can both exist and do not block each other
    - Another user's quarter cannot be confirmed or submitted
    - No network call occurs while a database transaction is open
    - Migration leaves one head; existing rows get 'self-employment'
    - Lint, typecheck, test and build pass
  - Risk: Opus/high: schema change to the submission lock and a filing path where a mistake could file twice or lose a receipt.
  - Commit: `f6b0fd790ac3`

- [x] **Task 5: Fetch and cache property obligations next to the self-employment ones** (after 1)
  - Intent: Done means the quarterly updates due for the UK property business come from HMRC's obligations endpoint (using the property business id), are cached and returned tagged by business kind so the Tax page can tell them apart. Extend api/hmrc/its-obligations.ts, api/_lib/itsObligations.ts and getItsIncomeAndExpenditureObligations to take a business id and tag rows. Property rows must not overwrite self-employment rows in its_obligations_cache (store both inside the existing jsonb payload, no migration unless unavoidable). Owners with no property business see no change.
  - Files: `api/hmrc/its-obligations.ts`, `api/_lib/itsObligations.ts`, `api/_lib/__tests__/itsObligations.test.ts`, `api/_lib/__tests__/itsObligationsRoute.test.ts`, `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `src/lib/hmrc/itsObligationsApi.ts`
  - Acceptance criteria the planner set:
    - With a property business id the route returns both sets, each tagged; without one it returns what it returns today
    - A failed property fetch does not hide self-employment obligations and gives a plain-words error for property
    - Cache holds both without one overwriting the other
    - Lint, typecheck, test and build pass
  - Commit: `3ced49b9b327`

- [ ] **Task 6: Let owners switch on UK property and record rental money in plain words** (after 2)
  - Intent: Done means an owner who lets a UK property can turn on property categories (calls ensurePropertyAccounts) from a plain-worded prompt on the Tax page, then pick 'Rent received', 'Repairs' and the like when adding money in or out. The UK-property group is labelled and separated from business categories in the picker. Plain words per docs/design/ease-of-use.md, official names only in small muted text. Follow UI rules (tokens, 44px targets, focus, shared loading/empty/error). Screenshots at 1440 and 390 px in browser-evidence/STF-109. VAT screens untouched.
  - Files: `src/pages/MoneyInPage.tsx`, `src/pages/MoneyInPage.test.tsx`, `src/pages/MoneyOutPage.tsx`, `src/pages/MoneyOutPage.test.tsx`, `src/pages/ChartOfAccountsSection.tsx`, `src/pages/ChartOfAccountsSection.test.tsx`, `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`, `src/lib/accountsApi.ts`, `e2e/mockApi.ts`, `browser-evidence/STF-109/`
  - Acceptance criteria the planner set:
    - Without turning property on, the category pickers look as before
    - After turning it on, property categories appear in a labelled group and an entry can be saved against one
    - No screen text uses terms from the design doc's 'never on screen' table
    - Component tests mock the API client; screenshots at 1440 and 390 px are in the diff
    - Lint, typecheck, test and build pass
  - Risk: Design doc does not say where the property switch lives; assumed the Tax page. If unclear, ask in the ticket rather than guess.

- [ ] **Task 7: Guided property update flow and property rows on the Tax page** (after 3, 4, 5)
  - Intent: Done means the Tax page lists property updates due beside self-employment ones (labelled 'Rental property'), and each opens a guided step-by-step flow at /tax/update/property/:taxYear/:quarter reusing ItsUpdatePage and ItsQuarterlyReview: show figures with explanations, preview the exact request, then a final step with one plain sentence ('You're telling HMRC you received £X in rent for ...'), a declaration, and a 'Send to HMRC' button. Test (sandbox) mode labelled each time; errors say what happened, whether a filing is affected and what to do. Parameterise the existing review component by business kind rather than copying. Screenshots at 1440 and 390 px. VAT screens untouched.
  - Files: `src/App.tsx`, `src/App.test.tsx`, `src/pages/ItsObligationsSection.tsx`, `src/pages/ItsObligationsSection.test.tsx`, `src/pages/ItsUpdatePage.tsx`, `src/pages/ItsUpdatePage.test.tsx`, `src/pages/ItsQuarterlyReview.tsx`, `src/pages/ItsQuarterlyReview.test.tsx`, `src/lib/hmrc/itsObligationsApi.ts`, `src/lib/hmrc/itsUpdateApi.ts`, `e2e/mockApi.ts`, `browser-evidence/STF-109/`
  - Acceptance criteria the planner set:
    - Tax page shows property rows only when the owner has a property business; self-employment rows render as before
    - Flow cannot reach Send without the declaration; money is right-aligned in tabular figures; mobile rows collapse to labelled rows
    - Sandbox label shown on preview and send steps; rejected or unknown-outcome sends show plain advice and no retry for unknown outcome
    - Tests with mocked API clients cover happy path, rejection and unknown outcome
    - Lint, typecheck, test and build pass

- [ ] **Task 8: Sandbox tests for every property endpoint and documentation** (after 1, 3, 4, 5)
  - Intent: Done means src/lib/hmrc/sandbox.integration.test.ts calls each Property Business and obligations endpoint the app uses (list businesses, property obligations, cumulative PUT, any retrieve call used), with fraud headers and Gov-Test-Scenario where useful, skipped without sandbox credentials and pinned to sandbox mode, so HMRC sees them in its logs. Write docs/workflows/its-property-update.md covering mapping, pence-to-pounds, gate and failure states. Update docs/runbooks/hmrc-sandbox-integration.md and docs/security/input-inventory.md for the new routes. Check doc examples match the code.
  - Files: `src/lib/hmrc/sandbox.integration.test.ts`, `docs/workflows/its-property-update.md`, `docs/runbooks/hmrc-sandbox-integration.md`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Each property endpoint used by the app has one sandbox test, skipped cleanly without credentials, and none can run against production
    - Docs list every new route and column and match the code's field names
    - npm test passes without credentials; lint, typecheck and build pass
  - Risk: Sandbox tests cannot be run without credentials, so the first real run happens in CI or by the owner.
