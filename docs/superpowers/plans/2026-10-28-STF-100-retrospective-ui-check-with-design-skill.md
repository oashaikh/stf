# STF-100: Retrospective UI check with design skills: dashboard, invoices, expenses, reports, settings and sign-in merged since 14 Oct

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

- The app ships a light theme only (one dark: use under src), so dark screenshots are not applicable and the PR will say so.
- Screenshots can be taken against npm run preview with the mocked API in e2e/mockApi.ts, and a Chromium is available via JOURNEY_CHROMIUM_PATH.
- The ticket's browser-evidence folder is browser-evidence/STF-100/, following the existing browser-evidence/STF-nn/ convention.
- The implementer invokes the named skills; the planner only references them.

## Out of scope

- Restructuring layouts, moving sections, new features, and changes to behaviour, data or routes (go under 'Proposed, not done').
- VatPage, TaxPage, ItsObligationsSection and TaxIdentifiersSection, not in the ticket's screen list.
- Adding a dark theme.

## User journey

Starts at: Signed-in owner opens the app at /login, then lands on /dashboard

1. Login and sign-in (`src/pages/LoginPage.tsx`)
   - Before: Built without the design skills
   - After: Same flow with fixed focus, hit targets and copy
2. Dashboard (`src/pages/DashboardPage.tsx`)
   - Before: Unchecked against tokens and contrast
   - After: Same layout with fixed alignment, states and copy
3. Expenses and entries list (`src/pages/ExpensesPage.tsx`)
   - Before: Unchecked rows and actions
   - After: Same screen with row truncation, 44px targets and clearer confirmations
4. Invoices and editor (`src/pages/InvoicesPage.tsx`)
   - Before: Unchecked
   - After: Same screens with aligned fields and states
5. Reports (`src/pages/ReportsPage.tsx`)
   - Before: Unchecked
   - After: Same screen with tidied money columns and states
6. Settings sections (`src/pages/SettingsPage.tsx`)
   - Before: Unchecked
   - After: Same sections with fixed fields, states and copy
7. Legal pages (`src/pages/LegalPages.tsx`)
   - Before: Unchecked
   - After: Same text with fixed type scale and copy

Also depends on:
- AIP-791 (design skills loadable)

## Tasks

- [x] **Task 1: Load the design skills and capture before-screenshots of every listed screen**
  - Intent: Invoke ui-ux-pro-max:ui-ux-pro-max, ui-styling:ui-styling and taste-skill:taste-skill first, and read the existing tokens (src/styles/index.css, tailwind.config.js, brand and success/warning/danger CSS variables, Inter font). Build the app, serve it with `npm run preview` and drive it with the mocked API in e2e/mockApi.ts. Capture 'before' PNGs at 1440 and 390 for: dashboard, expenses (list, filters, entry sheet, entry actions), invoices, invoice editor, reports, settings (business profile, chart of accounts, mileage, recurring entries, authenticator), login, and privacy/terms. The app has no dark theme (one `dark:` use in src), so light only. Write a defect list per screen against spacing, type scale, WCAG AA contrast, focus, 44px hit targets at 390, truncation and overflow, empty/loading/error states and copy. Save to browser-evidence/STF-100/before/. Use a throwaway capture script kept out of the diff. No source changes.
  - Files: `browser-evidence/STF-100/before/*.png`
  - Acceptance criteria the planner set:
    - browser-evidence/STF-100/before/ holds a 1440 and a 390 PNG for every screen listed in the ticket
    - Screenshots show only invented mock data
    - A per-screen defect list exists in the task report, naming file and line
    - Anything needing a restructure, new feature or behaviour change is flagged for 'Proposed, not done' and not implemented
  - Risk: Needs a Chromium via JOURNEY_CHROMIUM_PATH. If none is available, report that screenshots could not be taken instead of faking them.
  - Commit: `205dee8029ef`

- [x] **Task 2: Fix shell, login, sign-in and legal pages (AppShell, LoginPage, LegalPages, global CSS)** (after 1)
  - Intent: Fix the task 1 defects in place for the shell, login/sign-in and legal pages: focus rings, 44px hit targets at 390, contrast, type-scale tokens, copy. Run every visible string through humanize:humanize. Do not restructure layouts. Changes to src/styles/index.css must be token or focus fixes only, since they affect every screen. Update component tests only where text or roles changed.
  - Files: `src/components/AppShell.tsx`, `src/components/AppShell.test.tsx`, `src/pages/LoginPage.tsx`, `src/pages/LoginPage.test.tsx`, `src/pages/LegalPages.tsx`, `src/styles/index.css`
  - Acceptance criteria the planner set:
    - npm run lint, typecheck, test and build pass
    - Tap targets in shell and login are at least 44px at 390
    - Visible strings have been through humanize
  - Commit: `73fb45f93f3d`

- [x] **Task 3: Fix dashboard and reports screens** (after 2)
  - Intent: Fix the task 1 defects for DashboardPage and ReportsPage: money alignment and tabular figures, one currency format per page, truncation, empty/loading/error states, contrast, hit targets, copy. Money stays integer pence via formatPence. Do not touch report calculations.
  - Files: `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`, `src/pages/ReportsPage.tsx`, `src/pages/ReportsPage.test.tsx`
  - Acceptance criteria the planner set:
    - npm run lint, typecheck, test and build pass
    - Money columns right-aligned with tabular figures
    - Tables do not scroll sideways at 1440 and collapse to labelled rows at 390
    - No arithmetic, query or data behaviour changed
  - Commit: (none — no code change for this task)

- [x] **Task 4: Fix expenses, entries list and entry actions** (after 2)
  - Intent: Fix the task 1 defects for ExpensesPage, EntriesList and EntryActions: one-line rows with ellipsis and tooltip, 44px row actions at 390, labelled-row collapse on phones, filter field alignment, destructive-action confirmations that say what they affect, empty/loading/error states, focus and Escape in the sheet/dialog, copy. No change to filters, export or delete behaviour.
  - Files: `src/pages/ExpensesPage.tsx`, `src/pages/ExpensesPage.test.tsx`, `src/pages/EntriesList.tsx`, `src/pages/EntriesList.test.tsx`, `src/pages/EntryActions.tsx`
  - Acceptance criteria the planner set:
    - npm run lint, typecheck, test and build pass
    - Rows are one line at 1440 with a title carrying full text
    - Destructive actions name what they affect
    - No change to routes, API calls or soft-delete behaviour
  - Commit: `256ecb186d53`

- [x] **Task 5: Fix invoices list and invoice editor** (after 2)
  - Intent: Fix the task 1 defects for InvoicesPage and InvoiceEditor: line-item row alignment, money right-aligned in tabular figures, 44px targets at 390, label/help alignment, validation and error copy, loading and empty states, focus order. Invoice maths and PDF download unchanged.
  - Files: `src/pages/InvoicesPage.tsx`, `src/pages/InvoicesPage.test.tsx`, `src/pages/InvoiceEditor.tsx`
  - Acceptance criteria the planner set:
    - npm run lint, typecheck, test and build pass
    - Fields sharing a row top-align
    - No horizontal scroll in the editor at 390
    - No pence or totals logic changed
  - Commit: `7c1ac5503b42`

- [x] **Task 6: Fix settings page and business profile, chart of accounts and authenticator sections** (after 2)
  - Intent: Fix the task 1 defects for SettingsPage, BusinessProfileSection, ChartOfAccountsSection and AuthenticatorSection: field alignment, help icon straight after label, hit targets, focus, contrast of status text, error/empty states, destructive confirmation, copy. Keep section order and the auth flow unchanged.
  - Files: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `src/pages/BusinessProfileSection.tsx`, `src/pages/BusinessProfileSection.test.tsx`, `src/pages/ChartOfAccountsSection.tsx`, `src/pages/ChartOfAccountsSection.test.tsx`, `src/pages/AuthenticatorSection.tsx`, `src/pages/AuthenticatorSection.test.tsx`
  - Acceptance criteria the planner set:
    - npm run lint, typecheck, test and build pass
    - No change to auth, TOTP or save behaviour
    - Visible strings have been through humanize
  - Risk: The authenticator section is security-adjacent, so only presentation and copy may change.
  - Commit: (none — no code change for this task)

- [x] **Task 7: Fix mileage and recurring entries sections** (after 2)
  - Intent: Fix the task 1 defects for MileageSection and RecurringEntriesSection: table collapse at 390, money and mileage alignment, one-line rows, 44px targets, confirmations for destructive actions, empty/loading/error states, copy.
  - Files: `src/pages/MileageSection.tsx`, `src/pages/MileageSection.test.tsx`, `src/pages/RecurringEntriesSection.tsx`, `src/pages/RecurringEntriesSection.test.tsx`
  - Acceptance criteria the planner set:
    - npm run lint, typecheck, test and build pass
    - HMRC rate and recurrence logic unchanged
    - Tables never scroll sideways at 1440
  - Commit: `58d91e72f75f`

- [x] **Task 8: Capture after-screenshots and write the PR notes** (after 2, 3, 4, 5, 6, 7)
  - Intent: Re-run the capture from task 1 and save 'after' PNGs for every changed screen at 1440 and 390 to browser-evidence/STF-100/after/. Run full checks. Write PR notes: what changed, why, verification; name which skill (ui-ux-pro-max, ui-styling, taste-skill, humanize) drove each change; add 'Proposed, not done' with before screenshots.
  - Files: `browser-evidence/STF-100/after/*.png`, `browser-evidence/STF-100/PR-notes.md`
  - Acceptance criteria the planner set:
    - Every changed screen has before and after images at 1440 and 390
    - npm run lint, typecheck, test and build pass
    - PR notes name the skill behind each change and list 'Proposed, not done'
    - No machine paths, job ids or tokens in the notes
  - Commit: `bc66c2041a31`

- [x] **Task 9: Fix: address 31 review findings (cycle 1)** (after 8)
  - Intent: Review left 31 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The source changes are correct and presentation-only; the correctness lens found no logic defect. The screenshot evidence does not hold up. The recurring-entries capture i The agent is fixing them; nothing is needed from you.
  - Commit: (none — no code change for this task)

- [x] **Task 10: Fix: address 12 review findings (cycle 2)** (after 9)
  - Intent: Review left 12 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The source changes are correct and presentation-only; I found no logic defect. The ISO dates in Reports, the read-only invoice Qty/Unit price run-together and the recurrin The agent is fixing them; nothing is needed from you.
  - Commit: `8111ad1ecafd`
