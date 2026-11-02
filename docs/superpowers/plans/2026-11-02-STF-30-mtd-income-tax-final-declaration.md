# STF-30: MTD Income Tax: final declaration

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

- STF-87 and STF-119 to 123 are merged, so StateMessage, OfficialName, the six-item menu and the STF-87 helpers can be reused.
- The HMRC Individual Calculations API field names and version are confirmed from HMRC's docs when task 1 is built.
- The idempotency lock is a unique (user, tax year, sandbox) row, the same approach STF-87 used.
- The sandbox/live double switch reuses the existing helper STF-87 relies on.
- Migration 0026 is free: 0022 and 0025 are claimed by STF-74 and STF-38, 0023 and 0024 are merged.

## Out of scope

- Entering other income (employment, property, savings, pension contributions); needs a later ticket or owner decision.
- Paying the tax bill.
- Amending a declaration after it has been sent.
- Removing old crystallisation code beyond not building on it.

## User journey

Starts at: Tax page (Tax menu item)

1. Tax page (`src/pages/TaxPage.tsx`)
   - Before: Estimate, expense method and a link to the Income Tax year end
   - After: Also a link to the final declaration for the selected year
   - Depends on: STF-87 year-end flow
2. Final declaration: compare (`src/pages/FinalDeclarationFlow.tsx`)
   - Before: Does not exist
   - After: HMRC's income tax, National Insurance and total next to STF's estimate, with any difference explained in plain words
3. Final declaration: agree and send (`src/pages/FinalDeclarationFlow.tsx`)
   - Before: Does not exist
   - After: The owner ticks HMRC's wording, then sends; sandbox badge shown when in sandbox mode
4. Final declaration: done (`src/pages/FinalDeclarationFlow.tsx`)
   - Before: Does not exist
   - After: Confirmation that the declaration was sent

Also depends on:
- STF-87 year end submission (merged)
- HMRC connection and business set up in Settings

## Tasks

- [x] **Task 1: HMRC client: trigger and fetch the final-declaration tax calculation, and submit the declaration**
  - Intent: Add to src/lib/hmrc/client.ts three functions that follow the existing hmrcFetch pattern: trigger a calculation for the year (type final-declaration / intent-to-finalise), fetch the calculation by id, and submit the final declaration for that calculation id. Take the Individual Calculations API version, paths and Accept header from HMRC's docs at build time, and record the version as a named constant like SELF_EMPLOYMENT_API_ACCEPT. Parse the calculation response into integer pence only (income tax, Class 2 and Class 4 NIC, total). HMRC returns pounds as decimals, so convert with string/integer maths and never floating point. Add unit tests with a fake fetch and a sandbox integration test that is skipped when the sandbox env is unset, following sandbox.integration.test.ts.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `src/lib/hmrc/sandbox.integration.test.ts`
  - Acceptance criteria the planner set:
    - Trigger, get and final-declaration functions exist in client.ts, and no other file calls HMRC for them.
    - HMRC pound amounts are converted to integer pence with no floating-point arithmetic; a unit test covers decimals such as 1234.5 and 0.07.
    - Unit tests assert the path, method, version header and fraud headers using a fake fetch.
    - The sandbox integration test is skipped when the sandbox credentials are unset.
    - npm run typecheck and npm test pass.
  - Risk: Endpoint and field names must be checked against HMRC's live docs; repo memory says earlier client paths were never verified.
  - Commit: `89a85479c44e`

- [x] **Task 2: Pure comparison of HMRC's figures with STF's estimate, plus the declaration wording**
  - Intent: Add a pure module in src/lib that takes STF's estimate (TaxEstimateResult figures) and HMRC's calculated figures (pence) and returns the per-line difference (income tax, NIC, total) and a flag for whether they differ. Put HMRC's declaration wording in this module as one exported constant, copied from HMRC's docs, so the UI and the server check the same text. Add unit tests for equal, higher and lower cases. Do not hard-code any tax band values.
  - Files: `src/lib/finalDeclaration.ts`, `src/lib/finalDeclaration.test.ts`
  - Acceptance criteria the planner set:
    - Differences are integer pence with the sign defined (HMRC minus STF), and a test fails if the sign flips.
    - The module has no I/O and no floating point.
    - The declaration wording is a single exported constant.
    - npm test passes.
  - Commit: `d2b2da5641ec`

- [x] **Task 3: Database table that locks one final declaration per tax year and environment**
  - Intent: Add its_final_declarations modelled on its_annual_submissions: user_id, tax_year, sandbox, status (reuse the its_submission_status enum), HMRC calculation id, stored HMRC figures in pence, declaration_confirmed_at, hmrc_correlation_id, submitted_at, timestamps, with UNIQUE(user_id, tax_year, sandbox) as the idempotency lock. The user_id foreign key is covered by the unique index. No deletes; rows only change status. Use migration 0026, since 0022 and 0025 are claimed by other live plans, and parent it on the current journal head. Re-check the journal against main before finishing. Update schema.test.ts.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0026_its_final_declarations.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0026_snapshot.json`
  - Acceptance criteria the planner set:
    - The unique constraint on (user_id, tax_year, sandbox) exists in both schema.ts and the SQL.
    - The journal has a single head and the 0026 prefix is not used elsewhere.
    - Every stored money column is integer pence.
    - schema.test.ts covers the new table.
    - npm test passes.
  - Risk: Schema and migration work; the journal/snapshot can conflict with STF-38 and STF-74, which also edit it.
  - Commit: `72c3fabc3d9d`

- [x] **Task 4: Server: preview, tick-to-confirm and submit routes for the final declaration** (after 1, 2, 3)
  - Intent: Add api/_lib/itsFinalDeclaration.ts and three routes mirroring itsAnnualSubmit (api/hmrc/its-final-preview.ts, its-final-confirm.ts, its-final-submit.ts). Preview triggers and fetches HMRC's calculation through the client from task 1 and returns it with STF's estimate and the comparison. The HMRC calls happen outside any DB transaction. Confirm requires declaration: true and stores the calculation, then writes an audit event, and refuses without the tick. Submit requires confirm: true and a stored confirmation, claims the row atomically (the idempotency lock), then sends the final declaration for the stored calculation id. Submit also records its audit event, and the sandbox/live switch comes from the same helper STF-87 uses, so live needs HMRC_SANDBOX_MODE=false plus the Settings opt-in. Add route tests for the gate (no tick gives 400/refusal and no audit row; a second user's request is refused; a repeat submit does not call HMRC twice; a live attempt without the double switch is blocked) and unit tests for the lib. Add an entry to docs/security/input-inventory.md.
  - Files: `api/_lib/itsFinalDeclaration.ts`, `api/_lib/__tests__/itsFinalDeclaration.test.ts`, `api/_lib/__tests__/itsFinalDeclarationRoute.test.ts`, `api/hmrc/its-final-preview.ts`, `api/hmrc/its-final-confirm.ts`, `api/hmrc/its-final-submit.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Confirm without the declaration tick is rejected and writes no audit event; confirm with the tick writes one audit event.
    - Submit without a stored confirmation is rejected.
    - A second submit for the same user, tax year and environment sends nothing to HMRC.
    - Another user's request cannot read or submit the first user's declaration.
    - Live submission is refused unless HMRC_SANDBOX_MODE=false and the Settings opt-in are both set; sandbox is the default.
    - No network or subprocess call runs inside a DB transaction.
    - Logs and errors carry no NINO or token.
    - npm run typecheck and npm test pass.
  - Risk: HMRC submission, authorisation and idempotency work, so Opus at high.
  - Commit: `6da552ccca29`

- [x] **Task 5: Final declaration guided flow, API wrappers and routing** (after 4)
  - Intent: Add src/lib/itsFinalApi.ts (wrappers like itsAnnualApi.ts) and a guided step-by-step page, FinalDeclarationFlow, mounted at /tax/final-declaration/:taxYear following ease-of-use.md and the YearEndFlow pattern. Step 1: HMRC's figures for income tax, National Insurance and total next to STF's estimate, with a plain-words call-out of any difference and what it means (e.g. other income STF doesn't hold). Step 2: the owner ticks HMRC's wording, the Send button is disabled until then, and the server is the real gate. Step 3: done, with the sandbox badge when in sandbox mode. Use plain words, with official names in small muted OfficialName text, shared StateMessage for loading/error/empty, 44px targets, and the shared design tokens. Add the jargon test coverage as other screens do. The route goes in App.tsx and App.test.tsx.
  - Files: `src/lib/itsFinalApi.ts`, `src/lib/itsFinalApi.test.ts`, `src/pages/FinalDeclarationFlow.tsx`, `src/pages/FinalDeclarationFlow.test.tsx`, `src/pages/FinalDeclarationPage.tsx`, `src/pages/__tests__/jargonRender.test.tsx`, `src/App.tsx`, `src/App.test.tsx`, `e2e/mockApi.ts`
  - Acceptance criteria the planner set:
    - The flow shows HMRC's income tax, NIC and total beside STF's estimate, and states any difference in plain words.
    - Send is disabled until the wording is ticked, and the tick is posted to the confirm route before submit.
    - Money is right-aligned, tabular and formatted with formatPence.
    - Component tests mock the API wrappers.
    - The jargon render test passes for the new screens.
    - npm run lint, typecheck and test pass.
  - Risk: e2e/mockApi.ts and jargonRender.test.tsx are also edited by STF-38 and STF-74; keep the hunks small. Hunks in different places auto-merge.
  - Commit: `3ea04b5ed3bc`

- [x] **Task 6: Tax page entry point for the final declaration** (after 5)
  - Intent: In src/pages/TaxPage.tsx add a link to the final declaration flow for the selected year next to the existing year-end link, with a plain-words label. Leave homeTodos.ts alone, since STF-38 is editing it. Update TaxPage.test.tsx.
  - Files: `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`
  - Acceptance criteria the planner set:
    - The Tax page links to /tax/final-declaration/<selected year>.
    - The link is at least 44px high and uses plain words.
    - TaxPage tests cover the link.
    - npm run lint, typecheck and test pass.
  - Commit: `6d8f77bd926e`

- [x] **Task 7: Workflow doc and screenshots** (after 5, 6)
  - Intent: Write docs/workflows/its-final-declaration.md covering the calculation flow, the tick gate, the audit event, the idempotency lock, the sandbox/live double switch and the open question about non-self-employment income (STF holds only self-employment figures). Capture review-evidence screenshots of each new or changed screen at 390 and 1440 px, using invented data only, in browser-evidence/STF-30/ with a captions file like STF-87's. Run npm run lint, typecheck, test and build.
  - Files: `docs/workflows/its-final-declaration.md`, `browser-evidence/STF-30/captions.json`, `browser-evidence/STF-30/*.png`
  - Acceptance criteria the planner set:
    - The doc describes the non-self-employment income limitation.
    - Screenshots exist at 390 and 1440 px for the flow steps and the Tax page.
    - Screenshots show only invented records.
    - Lint, typecheck, test and build all pass.
  - Commit: `90fabe0a940e`

- [x] **Task 8: Fix: address 30 review findings (cycle 1)** (after 7)
  - Intent: Review left 30 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Replace the eight screenshots in browser-evidence/STF-30/ with real captures of the running app. They are hand-made mock pages, not the app: plain text on a white page, th The agent is fixing them; nothing is needed from you.
  - Commit: `4b85bf29601f`
