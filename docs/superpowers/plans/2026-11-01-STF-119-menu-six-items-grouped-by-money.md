# STF-119: Menu: six items grouped by money

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

- Home stays the current Dashboard at /home; the to-do list is a separate ticket
- Reports stays reachable under Tax, with a Home link as the spec allows
- Bank holds only connected accounts now; the sorting-payments flow does not exist yet
- Dark mode may not be shipped; if not, dark screenshots are noted as not applicable
- No data or API changes; nothing server side
- 'Other income' reuses the existing entries list filtered to income; ask in the ticket if that is wrong

## Out of scope

- To-do list home and money summary
- Guided flows (VAT, quarterly, setup, sorting payments)
- Jargon test across all pages
- New income-entry features beyond reusing the existing entries list
- Shared page container component beyond what tabs need

## User journey

Starts at: Signed-in user lands on / and is sent to Home

1. Menu (`src/components/AppShell.tsx`)
   - Before: Eight items, four hidden behind More on phones
   - After: Six items, all visible at 390px
2. Money in (`src/pages/MoneyInPage.tsx`)
   - Before: Invoices page only
   - After: Tabs: Invoices, Other income
3. Money out (`src/pages/MoneyOutPage.tsx`)
   - Before: Separate Expenses and Receipts pages; Mileage on Tax
   - After: Tabs: Expenses, Receipts, Mileage
4. Bank (`src/pages/BankPage.tsx`)
   - Before: Bank section inside Settings
   - After: Own page with connected accounts
5. Tax (`src/pages/TaxHubPage.tsx`)
   - Before: Separate VAT, Tax, Reports pages
   - After: Tabs: VAT, Income Tax, Past returns, Reports
6. Settings (`src/pages/SettingsPage.tsx`)
   - Before: Included the bank section
   - After: Business details, HMRC, security, preferences

## Tasks

- [x] **Task 1: Six-item menu and new route table with old-address redirects**
  - Intent: Replace the eight-item nav in AppShell with Home, Money in, Money out, Bank, Tax, Settings (all six in the 390px bottom bar; the 'More' menu goes). Add routes /home, /money-in, /money-out, /bank, /tax, /settings. Redirect /dashboard->/home, /invoices->/money-in, /expenses->/money-out, /receipts->/money-out/receipts, /vat->/tax/vat, /reports->/tax/reports, keeping query strings and hashes (VatPage and Dashboard deep-link to /expenses?status=draft and /expenses?from=..#entry-..). Point '/' and the catch-all at /home. Update in-app links (DashboardPage, EntryActions, VatPage) to new paths. At first the new routes render the existing pages so the app works after this task. Active-link highlighting must cover child paths.
  - Files: `src/components/AppShell.tsx`, `src/components/AppShell.test.tsx`, `src/App.tsx`, `src/App.test.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`, `src/pages/EntryActions.tsx`, `src/pages/VatPage.tsx`, `src/pages/VatPage.test.tsx`, `src/pages/ExpensesPage.test.tsx`, `src/pages/EntriesList.test.tsx`, `e2e/journey.spec.ts`
  - Acceptance criteria the planner set:
    - Nav shows exactly six links with plain names, at 390px and 1440px, each tap target at least 44px
    - Each old address (/dashboard,/vat,/receipts,/reports,/expenses,/invoices,/tax) lands on its new place and keeps ?query and #hash
    - Section highlights stay active on child routes
    - npm run lint, typecheck, test pass
  - Risk: Redirects must preserve search and hash or existing deep links from the VAT page break.
  - Commit: `a7fafb667f1f`

- [x] **Task 2: Shared tab bar; Money in and Money out pages** (after 1)
  - Intent: Add one small accessible tab-bar component (nav links, aria-current, wraps at 390px, 44px targets, tokens only) reused by every section. Build Money in (Invoices, Other income) and Money out (Expenses, Receipts, Mileage) as nested routes composing the existing InvoicesPage, ExpensesPage, ReceiptsPage and MileageSection. Move MileageSection off TaxPage. Plain tab names, no jargon. 'Other income' content is not defined by the spec: assume it reuses the entries list/form filtered to income entries; if that needs a new design, stop and ask in the ticket.
  - Files: `src/components/SectionTabs.tsx`, `src/components/SectionTabs.test.tsx`, `src/pages/MoneyInPage.tsx`, `src/pages/MoneyOutPage.tsx`, `src/pages/MoneyInPage.test.tsx`, `src/pages/MoneyOutPage.test.tsx`, `src/pages/TaxPage.tsx`, `src/pages/TaxPage.test.tsx`, `src/pages/ExpensesPage.tsx`, `src/pages/InvoicesPage.tsx`, `src/App.tsx`
  - Acceptance criteria the planner set:
    - Money in shows Invoices and Other income tabs; Money out shows Expenses, Receipts, Mileage tabs
    - Tab state is in the URL so refresh and the old-address redirects land on the right tab
    - Mileage no longer renders on the tax page
    - Tab bar usable by keyboard and at 390px without sideways scroll
    - npm run lint, typecheck, test pass
  - Risk: 'Other income' scope is ambiguous in the spec; do not invent screens.
  - Commit: `7123f25f39e9`

- [x] **Task 3: Tax tabs and Bank page; clear Settings** (after 2)
  - Intent: Tax gets tabs: VAT, Income Tax (current estimate plus quarterly updates), Past returns (existing VatHistoryList), Reports (ReportsPage). Create a Bank page holding the connected-accounts BankSection and remove it from SettingsPage so Settings holds business details, HMRC, security and preferences. Do not hard-code tax values. Reports is not a menu item.
  - Files: `src/pages/TaxHubPage.tsx`, `src/pages/TaxHubPage.test.tsx`, `src/pages/BankPage.tsx`, `src/pages/BankPage.test.tsx`, `src/pages/TaxPage.tsx`, `src/pages/VatPage.tsx`, `src/pages/ReportsPage.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `src/pages/BankSection.tsx`, `src/App.tsx`, `src/pages/__tests__/hostileTextRender.test.tsx`
  - Acceptance criteria the planner set:
    - Tax shows VAT, Income Tax, Past returns, Reports tabs; /vat and /reports redirects land on the right tab
    - Bank section appears on /bank and no longer on Settings
    - Nothing is removed: every earlier page content is still reachable
    - Wording on changed screens avoids the spec's never-on-screen words
    - npm run lint, typecheck, test pass
  - Commit: `a01a48594bb4`

- [x] **Task 4: Update e2e mock journey and run the full checks** (after 3)
  - Intent: Fix e2e/mockApi.ts and journey.spec.ts for the new paths, assert old addresses redirect and six nav items at 390 and 1440, and make sure lint, typecheck, test and build all pass.
  - Files: `e2e/journey.spec.ts`, `e2e/mockApi.ts`
  - Acceptance criteria the planner set:
    - e2e journey walks all six menu items
    - All five project checks pass
  - Commit: `1e8e275c798e`

- [x] **Task 5: Browser evidence and review notes** (after 4)
  - Intent: Walk each changed screen as a new user in sandbox mode with invented figures, capture 1440 and 390 shots in light and dark under browser-evidence/STF-119/ (following the STF-107 layout), plus a captions file with a plain-English title per image. Write notes listing where screens differ from docs/design/ease-of-use.md and why. No real data, no secrets.
  - Files: `browser-evidence/STF-119/captions.md`, `browser-evidence/STF-119/`
  - Acceptance criteria the planner set:
    - Every changed screen has 1440 and 390 images in light and dark
    - Captions file titles every image in plain English
    - Differences from the spec are listed with reasons
  - Commit: `18ce93b4345c`

- [x] **Task 6: Fix: address 46 review findings (cycle 1)** (after 5)
  - Intent: Review left 46 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The routing, redirects and tabs are correct in code, and the orchestrator's checks pass. The evidence is not acceptable. The "dark" captures are byte-identical to the ligh The agent is fixing them; nothing is needed from you.
  - Commit: `10ee7a051f46`

- [x] **Task 7: Fix: address 28 review findings (cycle 2)** (after 6)
  - Intent: Review left 28 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The routing, six-item menu, redirects (search and hash kept), tabs, and the Bank move all look correct, and the orchestrator's checks pass. The evidence still has a gap: b The agent is fixing them; nothing is needed from you.
  - Commit: `9043f0e06c64`
