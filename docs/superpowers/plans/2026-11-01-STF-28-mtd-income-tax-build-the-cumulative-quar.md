# STF-28: MTD Income Tax: build the cumulative quarterly update and preview it

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

- STF-25 (api/_lib/taxYearSummary.ts, src/lib/taxYearSummary.ts) and STF-84 (api/hmrc/its-obligations.ts, ITS obligation helpers in client.ts) are already merged in this worktree. I found both.
- Quarters are the standard HMRC periods ending 5 Jul, 5 Oct, 5 Jan and 5 Apr. Calendar-quarter election is not handled.
- The cumulative endpoint is expected to be PUT /individuals/business/self-employment/{nino}/{businessId}/cumulative/{taxYear} in the Self Employment Business (MTD) API. I could not confirm this against HMRC's live docs, so the implementer must check endpoint, version and field names before coding.
- The preview route sits under api/hmrc/ and is gated by HMRC_ITSA_ENABLED like its-obligations. No UI is built, so the ticket stays backend only.
- The preview is for the self-employment business already chosen in Settings (itsBusinessId), so no business id is accepted from the client.

## Out of scope

- Submitting the cumulative update to HMRC (STF-85)
- A UI panel or Tax page button for the preview
- Final declaration, adjustments and the property business type
- Calendar-quarter election and consolidated expenses for turnover under the threshold
- Any change to the VAT preview

## Tasks

- [ ] **Task 1: Cumulative period payload type and pure mapping from the tax year summary**
  - Intent: Add the HMRC cumulative self-employment payload type to src/lib/hmrc/client.ts, with a path builder and the API version header. Add a pure function in a new src/lib/itsCumulativeUpdate.ts. It takes the TaxYearSummary (src/lib/taxYearSummary.ts) for 6 April to the quarter end and returns the payload. Quarter ends are 5 Jul, 5 Oct, 5 Jan and 5 Apr. Money stays in integer pence until one conversion at the end that writes pounds with two decimals, using integer arithmetic with no float maths (reuse src/lib/money.ts if it has a suitable helper). Field names to confirm against HMRC's Self Employment Business API docs at build time: the endpoint (expected PUT /individuals/business/self-employment/{nino}/{businessId}/cumulative/{taxYear}), the version header, periodDates {periodStartDate, periodEndDate}, periodIncome {turnover, other}, and periodExpenses. Category slugs from src/lib/chartOfAccounts.ts map as: cost-of-goods to costOfGoods, travel to carVanTravelExpenses, premises to premisesRunningCosts, admin-office to adminCosts, advertising to advertisingCosts, professional-fees to professionalFees, finance-costs to the HMRC finance field named in the docs, other-allowable to otherExpenses. Disallowable expenses are never sent. When expenseMethod is 'allowance', send periodAllowances.tradingIncomeAllowance in place of expenses, because HMRC does not accept both. Record the doc URL and version checked in a comment. A quarter with no activity yields explicit zero figures, and categories with no spend are omitted or zero as the docs require. Tests (new src/lib/itsCumulativeUpdate.test.ts) cover: a normal quarter with every category, a quarter with no activity, the pence-to-pounds boundary (0, 5, 100, 123456 pence and a negative loss), the allowance method, disallowable excluded, and the quarter end dates for each of Q1 to Q4.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/itsCumulativeUpdate.ts`, `src/lib/itsCumulativeUpdate.test.ts`
  - Acceptance criteria the planner set:
    - client.ts exports a cumulative period summary payload type and a path builder, with field names that match the HMRC docs checked at build time; the doc version is noted in a comment
    - The mapping function is pure, takes integer pence, and returns pounds with two decimals only in the returned payload, with no floating-point arithmetic on money
    - Disallowable expenses and uncategorised accounts never appear in the payload
    - A tax year summary with no activity produces a valid payload of zeros
    - Unit tests cover the quarter with no activity, the boundary conversion, each quarter end date and the allowance method
    - npm run lint, typecheck and test pass
  - Risk: Money mapping against an external API spec. The implementer must verify field names against the live HMRC docs rather than memory; the ticket says to confirm the endpoint and version at build time.

- [ ] **Task 2: Income Tax quarterly update preview route with audit event** (after 1)
  - Intent: Add api/_lib/itsCumulativePreview.ts and a route file api/hmrc/its-cumulative-preview.ts (POST), modelled on api/_lib/vatPreview.ts and api/vat/preview.ts. Input is validated with zod and holds only taxYear (YYYY-YY, must be a key of TAX_BANDS, reuse parseTaxYearPeriod's rule) and quarter (1 to 4). The NINO and business id are never taken from the client. The route is gated the way api/hmrc/its-obligations.ts is: HMRC_ITSA_ENABLED=true, sandbox/live mode check (LIVE_MODE_REFUSED), HMRC connected, ITS scope present, business selected and NINO present. It loads the summary with getTaxYearSummary(databaseTaxYearSummaryStore, userId, period) over 6 April to quarter end, then maps it with the function from task 1. It makes no HMRC call and writes no HMRC state. It returns the endpoint (method, url using hmrcApiBase() with the NINO masked via maskNino and the business id masked), the exact body, and the headers with Authorization hidden, like the VAT preview. The only write is an audit event (action 'its_update.previewed', resourceType 'its_cumulative_update', metadata taxYear, quarter and sandbox only, never the body or NINO) into auditEvents. Dependencies are injected so tests use fakes. Tests, in the style of api/_lib/__tests__/vatPreview*.test.ts, cover: 405 for non-POST, 400 for bad input, 404 when ITSA is disabled, 403 when the mode is refused, 409 for each missing prerequisite, the happy path returning the exact payload, the audit event written with no body and no NINO, no fetch called, and the unauthenticated 401 from withAuth. Add the route to docs/security/input-inventory.md, since api/_lib/__tests__/inputInventory.test.ts fails otherwise. The route must default-export { fetch } and use .js import extensions, as apiRoutes.test.ts checks. Check whether e2e/mockApi.ts or the journeyWriteGuard test needs an entry.
  - Files: `api/_lib/itsCumulativePreview.ts`, `api/hmrc/its-cumulative-preview.ts`, `api/_lib/__tests__/itsCumulativePreview.test.ts`, `api/_lib/__tests__/itsCumulativePreviewRoute.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - POST with a valid taxYear and quarter returns ok:true with endpoint, body and headers, and no HMRC fetch is made
    - Exactly one audit event is written per preview, carrying only tax year, quarter and sandbox flag
    - The response never contains the full NINO or an Authorization token
    - Missing or invalid input, disabled ITSA, refused live mode and each missing prerequisite return the same error shapes as its-obligations
    - The userId comes from the session, never the request
    - The input inventory test, the apiRoutes tests, lint, typecheck, test and build all pass
  - Risk: Authenticated route that handles a NINO, HMRC mode gating and an audit write. This is permission and identifier work, so opus at high.

- [ ] **Task 3: Document the cumulative quarterly update workflow** (after 2)
  - Intent: Add docs/workflows/its-quarterly-update.md describing the quarter-end dates, the field mapping table (STF category to HMRC field), the allowance versus actual expenses rule, the preview route's request and response and its audit event, and the HMRC doc version confirmed at build time. State plainly that submission is STF-85 and not done here.
  - Files: `docs/workflows/its-quarterly-update.md`
  - Acceptance criteria the planner set:
    - The doc names the real file paths and route, and the mapping table matches the code
    - The doc states that nothing is sent to HMRC by this ticket
    - No secrets, NINOs or real data appear in the doc
