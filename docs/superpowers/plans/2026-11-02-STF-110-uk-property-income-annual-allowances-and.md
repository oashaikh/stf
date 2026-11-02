# STF-110: UK property income: annual allowances and adjustments, and inclusion in the final declaration

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

- STF-87 (self-employment annual flow, YearEndFlow) and STF-109 (property cumulative updates, uk-property business id) are merged, as the Nov 2 comment says and the repo shows.
- The property allowance is £1,000 per year and is mutually exclusive with claiming actual property expenses, as the trading allowance already is. It lives in taxBands.ts.
- The allowance-or-actual choice is made in the flow and passed with preview and confirm as a validated enum; the server recomputes all figures. No new settings column is needed.
- STF records no property adjustments, so only allowances and the choice are sent, as for self-employment. HMRC v6 annual field names need rechecking against the published spec at build time.
- The existing /tax/year-end/:taxYear route hosts the property steps, so no new route or menu item is added.

## Out of scope

- Recording property adjustments or capital allowances as ledger data
- Any change to VAT return building, preview or submission (frozen by the owner)
- Non-UK (foreign) property and furnished holiday lets
- HMRC production approval request and live submission

## User journey

Starts at: Tax page, Income Tax section, 'Year end' action for a tax year

1. Year-end flow (`src/pages/YearEndFlow.tsx`)
   - Before: Self-employment steps only: trading allowance or actual costs, preview, declare, send
   - After: Extra property steps: rental income and costs, the £1,000 allowance or actual costs, preview, declare, send
   - Depends on: STF-87, STF-109
2. Final declaration flow (`src/pages/FinalDeclarationFlow.tsx`)
   - Before: The user can ask for HMRC's calculation without annual figures having been sent
   - After: If a business's yearly figures are missing, the user sees a plain message and a button back to the year-end flow; otherwise the flow continues as before
   - Depends on: STF-30

Also depends on:
- STF-109
- STF-87
- STF-30

## Tasks

- [x] **Task 1: Property annual figures: tax data, pure builder, HMRC client call, schema**
  - Intent: Add everything the property annual submission needs underneath the API. First, a property allowance amount per tax year in src/lib/taxBands.ts, next to tradingAllowancePence. Second, a pure builder in src/lib/itsAnnualSubmission.ts that takes the property summary and the owner's choice ('allowance' or 'actual') and returns HMRC's UK property annual body, with money as integer pence and converted only at the edge. The allowance and actual expenses are mutually exclusive, and the builder sends no allowance when the owner claims actual costs. Third, a submitPropertyAnnualSubmission client function and path helper in src/lib/hmrc/client.ts, using Property Business API v6 (PUT /individuals/business/property/uk/{nino}/{businessId}/annual/{taxYear}). Field names must be rechecked against the published HMRC spec. Fourth, migration 0033 following 0031: add a business_kind column to its_annual_submissions with a CHECK constraint, and widen the unique key to (user_id, tax_year, sandbox, business_kind). Update server/src/db/schema.ts and the drizzle meta journal and snapshot, with a single migration head. Unit tests for the builder (both choices, zero income, rounding) and for the client call using a fake fetch.
  - Files: `src/lib/taxBands.ts`, `src/lib/itsAnnualSubmission.ts`, `src/lib/itsAnnualSubmission.test.ts`, `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/0033_its_annual_business_kind.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0033_snapshot.json`
  - Acceptance criteria the planner set:
    - Property allowance pence is read from TAX_BANDS by tax year, with no hard-coded amount in components or api
    - The property builder returns the allowance when the choice is 'allowance' and no allowance when it is 'actual'; all arithmetic is integer pence
    - submitPropertyAnnualSubmission PUTs to the property annual path with the v6 Accept header and a fake-fetch test asserts URL, method and body
    - Migration 0033 is idempotent, defaults existing rows to 'self-employment', and the unique key includes business_kind
    - drizzle journal has one head and 0033 parents on 0032
    - npm run typecheck, lint and test pass
  - Risk: Opus at high: schema and migration work, plus an HMRC money payload whose field names are unverified against live docs.
  - Commit: `5555add6e4c8`

- [x] **Task 2: Property annual submission API: preview, confirm, submit** (after 1)
  - Intent: Extend the existing annual flow in api/_lib/itsAnnualSubmit.ts with a business parameter ('self-employment' by default, or 'uk-property') rather than copying the file. The input schema stays strict. For property, add a choice field ('allowance' or 'actual') on preview and confirm. The server recomputes the body from the ledger; client figures are never trusted. checkItsReadiness is called with 'property', and the store find/saveConfirmed/claim methods filter on business_kind and user_id. Preview is a dry run: no HMRC call, only an audit event, with NINO and business id masked. Confirm requires the declaration. Submit requires confirm:true, takes its body from the stored confirmation, locks the row atomically, and treats an unknown outcome as 'do not resend'. Existing self-employment behaviour must not change. The api/hmrc/its-annual-*.ts routes accept the new fields. Route and unit tests cover: a second user's year is refused, the live-mode gate, double submit, HMRC 4xx releasing the lock, a 5xx leaving it pending, and the choice being validated.
  - Files: `api/_lib/itsAnnualSubmit.ts`, `api/hmrc/its-annual-preview.ts`, `api/hmrc/its-annual-confirm.ts`, `api/hmrc/its-annual-submit.ts`, `api/_lib/__tests__/itsAnnualSubmit.test.ts`, `api/_lib/__tests__/itsAnnualSubmitRoute.test.ts`, `src/lib/itsAnnualApi.ts`, `src/lib/itsAnnualApi.test.ts`
  - Acceptance criteria the planner set:
    - Preview for uk-property returns the masked PUT endpoint and body, and makes no HMRC call
    - Submit sends nothing without confirm:true and a stored confirmation, and a second concurrent submit gets 409
    - A user cannot read or submit another user's annual row, and a test proves it
    - With the sandbox setting not matching, the call is refused with LIVE_MODE_REFUSED
    - Existing self-employment annual tests pass unchanged
    - npm run typecheck, lint and test pass
  - Risk: Opus at high: it sends money to HMRC and enforces the confirmation gate, the idempotency lock and per-user isolation.
  - Commit: `3f5833f95f71`

- [x] **Task 3: Final declaration checks every business has its yearly figures in** (after 2)
  - Intent: Before HMRC's calculation is requested, previewItsFinalForUser in api/_lib/itsFinalDeclaration.ts must check that each business the user has (self-employment and UK property, from the stored business ids) has an annual row with status 'submitted' for that year and sandbox mode. The check is one bounded query on the unique key, with no per-row loop. If any is missing, refuse early with a distinct code (ANNUAL_FIGURES_MISSING) whose message names the business, says nothing has been sent, and says what to do next. Confirm and submit repeat the check so it cannot be skipped. Only final-declaration files change; VAT code is untouched. Tests cover: both submitted passes, property missing, self-employment missing, a user with one business, and a pending or rejected row blocking.
  - Files: `api/_lib/itsFinalDeclaration.ts`, `api/_lib/__tests__/itsFinalDeclaration.test.ts`, `api/_lib/__tests__/itsFinalDeclarationRoute.test.ts`
  - Acceptance criteria the planner set:
    - The HMRC trigger-calculation call is never made while any business's annual figures are not 'submitted'
    - The refusal names the missing business in plain words and points to the year-end step
    - The check is a single query filtered by user_id and tax_year
    - A property-only user and a self-employment-only user are each handled correctly
    - npm run typecheck, lint and test pass
  - Commit: `f8b0d55f6a91`

- [x] **Task 4: Year-end flow: guided property steps and final declaration pointer** (after 2, 3)
  - Intent: Extend src/pages/YearEndFlow.tsx following docs/design/ease-of-use.md. When the user has a UK property business, add guided steps with 'Step N of M': what you earned and spent on your rental, then a plain-English choice between a flat £1,000 rental allowance and claiming actual costs, showing which leaves more tax-free, with each figure explaining itself. Official names sit in small muted text via OfficialName. Then a preview of what will be sent, an explicit declaration, and send, with plain error messages. Money uses formatPence and shared StateMessage components. The final declaration page shows ANNUAL_FIGURES_MISSING as a plain message with a button back to the year-end flow. Tap targets at least 44px, works at 390px. Component tests mock the API client and cover choice, resume, error and success. The ease-of-use jargon test must pass. VAT pages are untouched.
  - Files: `src/pages/YearEndFlow.tsx`, `src/pages/YearEndFlow.test.tsx`, `src/pages/FinalDeclarationFlow.tsx`, `src/pages/FinalDeclarationFlow.test.tsx`, `e2e/mockApi.ts`
  - Acceptance criteria the planner set:
    - A user with a property business sees the property steps and a choice between the allowance and actual costs, in plain words
    - Nothing is sent before the declaration is ticked and send is pressed
    - A missing-figures refusal on the final declaration page links to the year-end flow
    - No 'Never on screen' jargon outside OfficialName text
  - Commit: `157e38b51a63`

- [x] **Task 5: Sandbox tests for each endpoint and workflow docs** (after 3)
  - Intent: Add gated sandbox integration tests in src/lib/hmrc/sandbox.integration.test.ts, in the style of the existing ones, for the property annual PUT and the self-employment annual PUT. They skip without sandbox credentials and use invented data. Add docs/workflows/its-property-annual.md, add the final declaration annual gate to its-final-declaration.md, check doc examples match the code (NINO mask, business id), and note in the sandbox runbook how to run the new tests.
  - Files: `src/lib/hmrc/sandbox.integration.test.ts`, `docs/workflows/its-property-annual.md`, `docs/workflows/its-final-declaration.md`, `docs/runbooks/hmrc-sandbox-integration.md`
  - Acceptance criteria the planner set:
    - Sandbox tests run only with sandbox credentials present and are skipped, not failed, in CI
    - No real data or secrets appear in fixtures or docs
    - Docs describe the property annual flow and the final declaration gate accurately against the code
    - npm test passes without network access
  - Commit: `e7c4b0fba6e2`

- [x] **Task 6: Fix: address 13 review findings (cycle 1)** (after 5)
  - Intent: Review left 13 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Correctness lens: a property-only owner cannot reach the rental year-end steps, yet the new final-declaration gate demands those figures. Everything else I traced held up: The agent is fixing them; nothing is needed from you.
  - Commit: `97a26514898c`

- [x] **Task 7: Fix: address 13 review findings (cycle 1)** (after 6)
  - Intent: Review left 13 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Correctness lens: a property-only owner cannot reach the rental year-end steps, yet the new final-declaration gate demands those figures. Everything else I traced held up: The agent is fixing them; nothing is needed from you.
  - Commit: (none — no code change for this task)
