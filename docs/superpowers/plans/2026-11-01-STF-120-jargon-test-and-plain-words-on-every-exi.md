# STF-120: Jargon test and plain words on every existing screen

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

- The Never on screen list in docs/design/ease-of-use.md section 4 is the complete word list; scanner uses whole-word, case-insensitive match.
- Login, legal pages and the app menu count as 'every page' for the test, so they get wording fixes too.
- Whether dark mode ships is unverified; evidence task covers it only if it exists.
- VatPage, VatObligationsList, VatPreviewPanel and VatHistoryList are the VAT review/submit screens and are excluded from both rewrite and test until STF-121.

## Out of scope

- VAT review and send screens (STF-121)
- To-do list home, guided flows, six-item menu restructure (STF-119 and later)
- Any behaviour or layout change
- Server/API error message text (only what is shown on screen)

## User journey

Starts at: Signed-in user opens the app at Home

1. Home (Dashboard) (`src/pages/DashboardPage.tsx`)
   - Before: Accounting wording in summaries and errors
   - After: Plain words, same layout
2. Expenses and Invoices (`src/pages/ExpensesPage.tsx, src/pages/InvoicesPage.tsx`)
   - Before: Jargon labels and raw errors
   - After: Plain labels, errors say what happened and next step
3. Tax (`src/pages/TaxPage.tsx`)
   - Before: Obligation / period key / Submit wording
   - After: Quarter, update due, Send to HMRC; official names in small text
4. Reports (`src/pages/ReportsPage.tsx`)
   - Before: Accounting terms
   - After: Plain words
5. Settings (`src/pages/SettingsPage.tsx`)
   - Before: Chart of accounts, token, sync wording
   - After: Categories, connect, update wording

Also depends on:
- STF-119
- STF-121

## Tasks

- [x] **Task 1: Add the official-name component and the jargon scanner**
  - Intent: Create one small shared component (e.g. OfficialName) that renders small muted text marked with a data attribute, e.g. data-official-name. Add a pure scanner in src/lib that takes rendered DOM text, skips anything inside an official-name element, and returns the banned words from the spec's Never on screen column (ledger, posting, journal, nominal code, chart of accounts, reconcile/reconciliation, obligation, period key, payload, endpoint, token, sync, submit, Box 1/4/6, VAT due on sales etc, and raw error code patterns). Match whole words, case-insensitive, so words like 'tokenise' in unrelated text are not an issue. Unit-test the scanner and component only; the all-pages test comes later so the build stays green. Use the spec at docs/design/ease-of-use.md section 4 as the word list; do not invent extra words.
  - Files: `src/components/OfficialName.tsx`, `src/components/OfficialName.test.tsx`, `src/lib/jargon.ts`, `src/lib/jargon.test.ts`
  - Acceptance criteria the planner set:
    - OfficialName renders its text in small muted text using existing colour/type tokens and carries a marker attribute the scanner recognises
    - scanner flags each banned word in a plain element and returns the matched words
    - scanner ignores the same word inside an OfficialName element
    - npm run lint, typecheck and test pass
  - Commit: `4cf211efdefe`

- [x] **Task 2: Plain words on Dashboard, Reports, app menu, sign-in and legal pages** (after 1)
  - Intent: Rewrite visible text only in DashboardPage, ReportsPage, AppShell, LoginPage and LegalPages so none of the banned words appear outside OfficialName: plain English, short sentences, you/your, buttons saying what they do, errors saying what happened and what to do next. Do not change behaviour or layout, and do not restructure the home page into a to-do list (that is STF-119). Update the existing tests that assert on the old wording.
  - Files: `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`, `src/pages/ReportsPage.tsx`, `src/pages/ReportsPage.test.tsx`, `src/components/AppShell.tsx`, `src/components/AppShell.test.tsx`, `src/pages/LoginPage.tsx`, `src/pages/LoginPage.test.tsx`, `src/pages/LegalPages.tsx`
  - Acceptance criteria the planner set:
    - scanner run over these pages' rendered text finds no banned words
    - no change to routes, props, data fetching or layout classes
    - updated tests pass along with lint, typecheck and build
  - Risk: STF-119 edits AppShell, DashboardPage and ReportsPage in parallel; keep hunks to text strings only to avoid merge conflicts.
  - Commit: `d6b1551922ce`

- [x] **Task 3: Plain words on the Tax screens (not the VAT review and send screens)** (after 1)
  - Intent: Rewrite visible text in TaxPage, ItsObligationsSection (Income Tax updates; replace 'obligation', 'period key', 'submit', raw error text with 'update due', 'quarter', 'Send to HMRC', plain errors) and MileageSection. Use OfficialName for HMRC names worth keeping. Leave VatPage, VatObligationsList, VatPreviewPanel and VatHistoryList untouched; STF-121 rewrites them. Wording only. Update the matching tests.
  - Files: `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`, `src/pages/ItsObligationsSection.tsx`, `src/pages/ItsObligationsSection.test.tsx`, `src/pages/MileageSection.tsx`, `src/pages/MileageSection.test.tsx`
  - Acceptance criteria the planner set:
    - scanner finds no banned words in the rendered Tax page, Income Tax updates list and mileage section
    - VAT files are unchanged in git diff
    - buttons that send to HMRC read 'Send to HMRC' and behaviour is unchanged
    - lint, typecheck, test pass
  - Risk: STF-119 and STF-87 both edit TaxPage; keep changes to strings.
  - Commit: `6794259ad667`

- [x] **Task 4: Plain words on Expenses and Invoices** (after 1)
  - Intent: Rewrite visible text in ExpensesPage, EntriesList, EntryActions, InvoicesPage, InvoiceEditor and RecurringEntriesSection so no banned word shows (e.g. posting, journal, nominal code, category wording, sync, raw API errors). Errors say what happened, whether money is affected, and the next step. Wording only; layout and behaviour unchanged. Update matching tests, including hostileTextRender expectations only if they assert on old wording.
  - Files: `src/pages/ExpensesPage.tsx`, `src/pages/ExpensesPage.test.tsx`, `src/pages/EntriesList.tsx`, `src/pages/EntriesList.test.tsx`, `src/pages/EntryActions.tsx`, `src/pages/InvoicesPage.tsx`, `src/pages/InvoicesPage.test.tsx`, `src/pages/InvoiceEditor.tsx`, `src/pages/RecurringEntriesSection.tsx`, `src/pages/RecurringEntriesSection.test.tsx`
  - Acceptance criteria the planner set:
    - scanner finds no banned words in rendered Expenses, Invoices, editor and recurring sections including error and empty states
    - tests updated and passing; lint, typecheck, build pass
  - Risk: STF-119 edits several of these files; text-only hunks. Memory notes flaky vat-obligations query mocks in Invoices/Expenses tests; keep mocks returning defined data.
  - Commit: `e2b39607c953`

- [x] **Task 5: Plain words on Settings and its sections** (after 1)
  - Intent: Rewrite visible text in SettingsPage, AuthenticatorSection, BusinessProfileSection, ChartOfAccountsSection (shown as categories, never 'chart of accounts'), TaxIdentifiersSection and BankSection (replace token/sync/reconcile wording with connect/update/match). Keep HMRC sandbox/opt-in behaviour untouched. Wording only. Update matching tests.
  - Files: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `src/pages/AuthenticatorSection.tsx`, `src/pages/AuthenticatorSection.test.tsx`, `src/pages/BusinessProfileSection.tsx`, `src/pages/BusinessProfileSection.test.tsx`, `src/pages/ChartOfAccountsSection.tsx`, `src/pages/ChartOfAccountsSection.test.tsx`, `src/pages/TaxIdentifiersSection.tsx`, `src/pages/TaxIdentifiersSection.test.tsx`, `src/pages/BankSection.tsx`, `src/pages/BankSection.test.tsx`
  - Acceptance criteria the planner set:
    - scanner finds no banned words in rendered Settings and every section
    - tests updated and passing; lint, typecheck, build pass
  - Risk: STF-119 edits SettingsPage and BankSection; text-only hunks.
  - Commit: `0bfe5c96a75c`

- [x] **Task 6: Add the render-every-page jargon test** (after 2, 3, 4, 5)
  - Intent: Add a Vitest test that renders every routed page and dialog (Dashboard, Expenses, Invoices incl. editor dialog, Reports, Tax, Settings with all sections, Login, legal pages, shell) with mocked API clients (, no live calls), in loading, empty, error and loaded states where cheap, and fails with the offending word and element on any banned word outside OfficialName. VAT review/send screens (VatPage, VatObligationsList, VatPreviewPanel, VatHistoryList) are excluded through a named list with a comment pointing at STF-121 to remove it. Include a self-check that the test fails when a banned word is injected. Ensure mocks always return defined data for vat-obligations.
  - Files: `src/pages/__tests__/jargonRender.test.tsx`
  - Acceptance criteria the planner set:
    - test passes on the rewritten screens and fails if a banned word is added to a page (shown once during development)
    - the VAT exclusions are an explicit list with the STF-121 note
    - npm run lint, typecheck, test, build all pass
  - Commit: `0ecf5467afec`

- [x] **Task 7: Capture new-user screenshots, captions and spec-difference notes** (after 6)
  - Files: `browser-evidence/STF-120/captions.md`, `browser-evidence/STF-120/`
  - Acceptance criteria the planner set:
    - each changed screen has four images (1440/390, light/dark) and a caption line
    - captions.md has a section naming where screens differ from docs/design/ease-of-use.md and why
    - all figures are invented; no secrets in images
  - Risk: Dark mode may not ship in this app; if absent, say so in captions.md rather than faking it.
  - Commit: `c71a0db20f0e`
