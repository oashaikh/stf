# STF-51: Upcoming VAT return reminder with a ready draft

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

- Obligations come only from HMRC, so the cron fetches them live per run and no due date is stored; the dashboard gets the due date from the existing cached obligations query. No new endpoint, column or migration.
- Reminder window is a constant (e.g. 14 days) in src/lib/vatReminder.ts, not a setting.
- The draft is saved only via saveReturnDraft with reopen=false; box 5 on the card comes from the existing GET /api/vat/return review, so it matches the VAT page.
- Single-owner app: the cron acts for the one owner user, as the token refresh job does.
- STF-71 has merged and its code is on this branch.

## Out of scope

- Any cron code path that confirms or submits a return
- Email, push or other notifications
- A configurable reminder window in Settings
- Changes to the VAT page, obligations route or fraud-header builder beyond reuse

## User journey

Starts at: Owner signs in and lands on the Dashboard.

1. Dashboard (`src/pages/DashboardPage.tsx`)
   - Before: Cards for tax year, month, VAT quarter and recent entries; no VAT return reminder.
   - After: An extra card shows the next VAT return's due date and draft box 5 when an open obligation is due soon, with a link to the VAT page. Absent when nothing is due.
   - Depends on: STF-71 (already merged)
2. VAT page (`src/pages/VatPage.tsx`)
   - Before: Shows obligations and return boxes with preview, confirm and submit.
   - After: Unchanged. The owner arrives from the card, sees the saved draft, and decides to confirm and submit manually.

Also depends on:
- STF-71

## Tasks

- [ ] **Task 1: Add pure reminder helper: pick the next open obligation due within the window**
  - Intent: Add src/lib/vatReminder.ts with REMINDER_WINDOW_DAYS and a pure function that takes obligation rows ({periodKey,start,end,due,status}), today as YYYY-MM-DD and the window, and returns the open (status 'O') obligation with the earliest due date inside the window (overdue open obligations included, since the owner needs the reminder most then), or undefined. Dates are compared as UTC day strings. The cron job and the dashboard card both call it, so the due-soon rule lives in one place. Vitest covers: inside window, outside window, overdue, fulfilled ignored, earliest of several, empty.
  - Files: `src/lib/vatReminder.ts`, `src/lib/vatReminder.test.ts`
  - Acceptance criteria the planner set:
    - Function is pure with no I/O and no Date.now(); today is a parameter
    - Tests cover inside window, outside window, overdue, status F ignored, earliest-of-many and empty input
    - npm run lint, typecheck and test pass

- [ ] **Task 2: Cron route that saves the draft for the next due obligation, with no path to submit** (after 1)
  - Intent: Add api/cron/prepare-vat-draft.ts modelled on api/cron/refresh-hmrc-tokens.ts: handler factory with the same fail-closed constant-time Bearer CRON_SECRET check and a default export wiring real deps. It resolves the owner user id (reuse the existing owner external-id lookup), loads HMRC credentials via databaseHmrcStore, fetches open obligations with getVatObligations (reuse callHmrcAsUser or withHmrcToken for token refresh and saving; fraud headers need a server-built Request since a cron has no browser), picks the due obligation with the task 1 helper, and calls the existing saveReturnDraft(databaseStore, userId, period, false) in api/_lib/vatReturns.ts. reopen is never true, so a confirmed draft is left alone. Does nothing (still 2xx) when nothing is due, HMRC is not connected, or no VAT number is set. Log only error classes. Register in vercel.json (maxDuration and a daily cron). The route must not import vatSubmit.ts, the submit route, or any submit function. Tests with fakes only: draft saved when due, not saved when not due, 401 on missing/wrong secret, confirmed draft not reopened, and a test that reads the route source and asserts no reference to vatSubmit, submitVatReturn or the submit route. Document the job in docs/runbooks/vercel-deploy.md; touch .env.example only if a new variable is introduced (CRON_SECRET already exists).
  - Files: `api/cron/prepare-vat-draft.ts`, `api/cron/__tests__/prepareVatDraft.test.ts`, `vercel.json`, `docs/runbooks/vercel-deploy.md`, `.env.example`
  - Acceptance criteria the planner set:
    - Missing or wrong Bearer secret gives 401; unset CRON_SECRET authorises nobody
    - With an obligation due inside the window, saveReturnDraft is called once with that period and reopen=false
    - With nothing due, not connected, or no VAT number, nothing is saved and the response is 2xx
    - A test fails if the route imports or references vatSubmit, submitVatReturn or the submit route
    - No HMRC network call inside an open DB transaction; tests use fakes only
    - vercel.json has a valid cron entry
    - npm run lint, typecheck, test and build pass
  - Risk: Opus/high: owner-scoped cron auth, HMRC tokens and a never-submit guarantee. Fraud-prevention headers normally come from the browser; a cron has none, so the implementer must check what the HMRC sandbox accepts and report any limitation rather than invent client headers.

- [ ] **Task 3: Dashboard card: upcoming VAT return with due date and draft box 5** (after 1)
  - Intent: In src/pages/DashboardPage.tsx add a reminder card reusing the existing useVatObligations hook (shared query key, no new request) and the existing frontend fetcher for GET /api/vat/return used by VatPage. Pick the obligation with the task 1 helper. Show the due date and draft box 5 via formatPence (right-aligned, tabular, like the existing Row), a draft / not-yet-drafted text label so colour is not the only signal, and a min-h-11 link to /vat. Hide the card when nothing is due, HMRC is not connected, or a query errors; it must not block the rest of the dashboard. Use the existing Card, linkClass and tokens (no raw hex or px sizes). Tests in DashboardPage.test.tsx with API clients mocked: due soon shows date and box 5, not due shows no card, error hides it, link goes to /vat.
  - Files: `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`
  - Acceptance criteria the planner set:
    - Card shows due date and box 5 via formatPence and links to /vat
    - No card when nothing is due, or when obligations or return queries fail
    - Existing dashboard tests still pass; no new endpoint
    - npm run lint, typecheck, test and build pass

- [ ] **Task 4: E2E mock state and screenshots for the dashboard card** (after 3)
  - Intent: Make e2e/mockApi.ts serve an obligation due inside the window (today is 2026-10-27; the mock's fixed due date is 2026-08-07) so the card renders. Add a journey step in e2e/journey.spec.ts: sign in, open the dashboard, assert the card shows due date and box 5, follow the link to /vat. Capture 390 px and 1440 px light screenshots into browser-evidence/STF-51/ as 390-light-dashboard-vat-reminder.png and 1440-light-dashboard-vat-reminder.png (dark only if a dark theme ships). Confirm existing VAT journey steps and screenshots still work. Add a short note on the reminder job to docs/workflows/vat-return.md.
  - Files: `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `browser-evidence/STF-51/`, `docs/workflows/vat-return.md`
  - Acceptance criteria the planner set:
    - Playwright journey passes against the mock API with no live calls
    - browser-evidence/STF-51 holds 390 and 1440 px dashboard screenshots with invented data only
    - Existing VAT journey steps still pass
    - npm run lint, typecheck, test and build pass
