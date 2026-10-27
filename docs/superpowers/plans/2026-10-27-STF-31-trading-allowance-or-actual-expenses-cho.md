# STF-31: Trading allowance or actual expenses, chosen per tax year

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

- Trading allowance is £1,000 in every year in TAX_BANDS (2024-25 to 2026-27), per HMRC's published rate.
- Gross income for the allowance is turnover plus other income in the summary; check whether 'other-income' counts as trading income.
- If no choice is stored, the method is 'actual'; the page only recommends the lower profit.
- A tie between the two methods is reported as 'actual'.
- Partial relief (allowance alongside expenses) is not offered; the owner picks one method.
- The estimate is rest-of-UK only, as documented in taxBands.ts.
- Migration 0012 is chosen to stay clear of 0010 (STF-9) and 0011 (STF-49).

## Out of scope

- Capital allowances and the Annual Investment Allowance (open question in the ticket).
- Property income allowance, partial relief, other income types.
- Changing /api/profit-and-loss, Reports or the dashboard card to use the chosen method.
- Scottish bands.
- HMRC submission of the chosen method.

## User journey

Starts at: Signed-in owner opens Tax from the main navigation

1. Tax page (/tax) (`src/pages/TaxPage.tsx`)
   - Before: Tax year picker and one estimate card built from actual expenses only
   - After: Same page plus a section comparing profit with actual expenses against profit with the £1,000 trading allowance, a hint on which is lower, and a choice saved per tax year; the estimate card follows the choice
   - Depends on: STF-25, STF-27 and STF-32, all merged

Also depends on:
- STF-25
- STF-27
- STF-32

## Tasks

- [x] **Task 1: Trading allowance amount in tax bands, plus the pure comparison function**
  - Intent: Add `tradingAllowancePence` (100000, £1,000, HMRC published) to the TaxBands interface and to every year entry in src/lib/taxBands.ts. Add src/lib/tradingAllowance.ts with a pure `compareExpenseMethods(grossIncomePence, allowableExpensesPence, taxYear)`. It returns profit under actual expenses (income - expenses, can be negative), profit under the allowance (max(0, income - allowance)), and `lowerProfitMethod` ('actual' | 'allowance'). A tie returns 'actual' because that is the default and needs no election. Integer pence only, with the allowance read through getTaxBands. Tests cover: income below the allowance (allowance profit 0), expenses exactly equal to the allowance (tie returns 'actual'), expenses above and below it, zero income, a loss under actual expenses, and an unknown tax year throwing.
  - Files: `src/lib/taxBands.ts`, `src/lib/taxBands.test.ts`, `src/lib/tradingAllowance.ts`, `src/lib/tradingAllowance.test.ts`
  - Acceptance criteria the planner set:
    - Every TAX_BANDS entry has tradingAllowancePence === 100000 and taxBands.test.ts asserts it
    - compareExpenseMethods has no floating point and takes the allowance only from getTaxBands
    - Tests cover turnover below the allowance and expenses equal to the allowance
    - npm run typecheck, npm test and npm run lint pass
  - Risk: Tax logic, but small, pure and fully unit-tested.
  - Commit: `b8e244335ec0`

- [ ] **Task 2: Per-tax-year method choice: table, migration, store with audit event, settings route** (after 1)
  - Intent: Add a `trading_allowance_choices` table (id, user_id FK to users, tax_year, method constrained to 'actual' | 'allowance', updated_at) to server/src/db/schema.ts, with a unique index on (user_id, tax_year) that also serves every lookup. Add migration 0012_trading_allowance_choices.sql with journal entry and snapshot. Do not reuse 0010 (STF-9) or 0011 (STF-49), and the journal `when` must be later than 1792986651124. Re-check against the base branch for a single head before finishing. Add api/_lib/tradingAllowance.ts, modelled on api/_lib/businessProfile.ts: a zod schema (taxYear must be in TAX_BANDS and pass taxYearPeriod; method is an enum) and an injected store with `get(userId, taxYear)` (limit 1) and `set(userId, taxYear, method)`. `set` upserts in a transaction, locking the existing row FOR UPDATE, and writes an auditEvents row (action 'trading_allowance.update', before and after snapshots) only when the method changes. Add api/settings/trading-allowance.ts (GET ?taxYear, PUT body) behind withAuth. The user id always comes from auth.userId; the response returns only the method. Add a query-audit comment and extend schema.test.ts as for other tables. Route tests: unauthenticated refused, bad year or method gives 400, another user's choice never visible or changeable, audit event written on change and not on a no-op, repeated PUT for the same year leaves one row.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0012_trading_allowance_choices.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0012_snapshot.json`, `api/_lib/tradingAllowance.ts`, `api/settings/trading-allowance.ts`, `api/_lib/__tests__/tradingAllowanceRoute.test.ts`
  - Acceptance criteria the planner set:
    - Migration is 0012, the journal has a single head, and the table has a unique (user_id, tax_year) index
    - Every query is filtered by the session user id and carries a limit
    - An audit_events row is written in the same transaction when the method changes, and none for a no-op
    - Tests show another user's id or choice cannot be read or changed, and an unauthenticated call is refused
    - npm run lint, typecheck, test and build pass
  - Risk: Schema migration plus per-user data access and audit; opus at high per the data and tenant-isolation rule.

- [ ] **Task 3: Tax year summary and estimate use the chosen method** (after 1, 2)
  - Intent: Make getTaxYearSummary in api/_lib/taxYearSummary.ts read the owner's stored choice for that tax year (default 'actual' when none) through the new store. It applies compareExpenseMethods and returns `expenseMethod`, `tradingAllowancePence`, `profitWithActualExpensesPence`, `profitWithAllowancePence` and `lowerProfitMethod`; `netProfitPence` becomes the profit under the chosen method. Add those fields to the TaxYearSummary type in src/lib/taxYearSummary.ts. buildTaxYearSummary stays the pure actual-expenses build. Gross income for the allowance is turnover + other income (see assumptions). getTaxEstimate already feeds summary.netProfitPence to estimateTax, so the estimate follows with no tax-maths change. Extend TaxEstimateResult with `expenseMethod` and the comparison fields the Tax page needs. Add `loadChoice` to TaxYearSummaryStore, keeping tests on fakes. Update the existing summary and estimate route tests and add tests: the choice changes net profit and the estimate, the default is 'actual', and choosing the allowance with turnover below it gives nil profit and nil tax. Do not touch /api/profit-and-loss or the dashboard.
  - Files: `src/lib/taxYearSummary.ts`, `src/lib/taxYearSummary.test.ts`, `api/_lib/taxYearSummary.ts`, `api/_lib/taxEstimate.ts`, `api/tax-estimate.ts`, `api/tax-year-summary.ts`, `api/_lib/__tests__/taxYearSummaryRoute.test.ts`, `api/_lib/__tests__/taxEstimateRoute.test.ts`
  - Acceptance criteria the planner set:
    - With method 'allowance' the summary netProfitPence equals max(0, income - 100000) and the estimate matches estimateTax on that figure
    - With no stored choice, results are identical to today's
    - The choice is looked up with the session user id only and has a limit
    - npm run lint, typecheck, test and build pass
  - Risk: STF-49 also edits taxYearSummary files; expect a merge conflict at PR time, so keep hunks small.

- [ ] **Task 4: Tax page: compare both methods and let the owner choose, with workflow note and screenshots** (after 3)
  - Intent: On /tax, show a section for the selected tax year with profit under actual expenses and under the £1,000 trading allowance, which is lower, and a two-option radio group for choosing the method (44px targets, labelled, keyboard reachable, shared container and tokens, money right-aligned and tabular via formatPence). Saving PUTs /api/settings/trading-allowance and invalidates the tax-estimate query so figures refresh. Add src/lib/tradingAllowanceApi.ts; the comparison fields come from the estimate response already loaded. Use shared loading and error states. State that this is an estimate and that claiming the allowance means no expenses can be deducted. Add TaxPage tests (api client mocked) for both figures, the recommendation, saving the choice, and a save error. Add docs/workflows/tax-year-method.md. Capture browser-evidence/STF-31/{1440,390}-light-tax.png (plus dark if the app ships a dark theme).
  - Files: `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`, `src/lib/taxEstimateApi.ts`, `src/lib/tradingAllowanceApi.ts`, `docs/workflows/tax-year-method.md`, `browser-evidence/STF-31/1440-light-tax.png`, `browser-evidence/STF-31/390-light-tax.png`
  - Acceptance criteria the planner set:
    - Changing the method on /tax persists it and the estimate on the page updates
    - Both profit figures and the lower-profit hint are visible at 1440 and 390 px with no sideways scroll
    - Screenshots exist at both widths under browser-evidence/STF-31/
    - npm run lint, typecheck, test and build pass
  - Risk: STF-49 also edits TaxPage.tsx; keep this change in its own block.
