# STF-81: Export all entries for a date range as CSV

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

- STF-10 and the entries/dashboard code are already on this branch (HEAD b69260b); the task asks to merge dev first, but the branch is based on main, so the implementer should confirm no newer dev changes touch api/ or ReportsPage.
- The 'P&L' is the existing summariseLedger in src/lib/dashboardSummary.ts (confirmed/reconciled income minus expenses); no separate P&L module exists. The CSV includes drafts with their status, so the totals test compares over confirmed/reconciled rows.
- 'Voided' means transactions.deleted_at is set (voidEntry soft-deletes); the export filters deleted_at IS NULL.
- The route is a flat file api/entriesExport.ts served at /api/entriesExport; if Vercel needs a hyphen, name it api/entries-export.ts consistently in client, mock and tests. Pick one name and use it everywhere.
- Date range cap 366 days and row cap 20000 are reasonable defaults, held as named constants.
- formatPenceRaw in src/lib/money.ts is the 'pounds with two decimals' helper; it takes integer pence.

## Out of scope

- XLSX or PDF export
- Exporting receipts, files or VAT returns
- A full P&L report screen
- Rate limiting infrastructure beyond what withAuth already provides
- Adding a Reports link to navigation (route /reports already exists in src/App.tsx)

## User journey

Starts at: Signed-in owner opens /reports from the app navigation

1. Reports page (`src/pages/ReportsPage.tsx`)
   - Before: Heading and 'Coming soon.' text
   - After: From and To date inputs defaulting to the current tax year, and a Download CSV button; a refused range shows a plain error message
   - Depends on: STF-10 (entries data, merged); task 1 route
2. CSV download (`api/entriesExport.ts`)
   - Before: No export route
   - After: Browser saves a CSV of the owner's entry lines for the range

Also depends on:
- STF-10

## Tasks

- [x] **Task 1: CSV export builder, store and owner-scoped route**
  - Intent: Add GET /api/entries-export?from=YYYY-MM-DD&to=YYYY-MM-DD. New api/_lib/entriesExport.ts holds: a zod query schema (valid ISO dates, from<=to, range capped at 366 days, refused with a plain 400 message and code RANGE_TOO_LARGE); an injected ExportStore (loadExportLines(userId, from, to, limit)) so tests never touch a database; a pure buildCsv function (header: date, description, reference, account code, account name, net, VAT, gross, status, source) using formatPenceRaw from src/lib/money.ts for pounds with two decimals (gross = net+VAT via addPence); RFC 4180 quoting plus a leading-quote guard for cells starting with = + - @ (CSV injection) on text fields only, not on money; and a row cap (EXPORT_ROW_LIMIT, e.g. 20000) with the store querying limit+1 and the route refusing with a plain message if exceeded. The database store joins transaction_lines to transactions (user_id = session userId, deleted_at IS NULL so voided entries are excluded, date between from and to) and accounts (accounts.userId = userId too, as api/_lib/dashboard.ts does), selects named columns only (no select *), ordered by date then transaction id, with LIMIT. It rides transactions_user_date_idx and transaction_lines_transaction_id_idx; add a Query audit comment in the same style as api/_lib/dashboard.ts. Route api/entriesExport.ts (follow api/dashboard.ts: withAuth, GET only, 405 otherwise, userId from auth only, never from query). Returns Content-Type text/csv, Content-Disposition attachment with a date-range filename, Cache-Control no-store. Draft entries are included with their status shown; voided are not. Tests (api/_lib/__tests__/entriesExport.test.ts and a route test): CSV income and expense totals for a range equal summariseLedger from src/lib/dashboardSummary.ts for the same range over confirmed/reconciled rows (the P&L); voided (deleted) entries are absent; the store is called with the session user id and ignores a client-supplied userId param; another user's rows never appear; unauthenticated is refused; too-large range and too-many-rows are refused with the plain message; quoting, comma/quote/newline and leading '=' escaping; pounds formatting for negatives and zero. Note: money must be streamed from integer pence only, no floats beyond the existing formatPenceRaw. Streaming: if the row cap keeps the body small, build the body with a ReadableStream that yields chunks of rows rather than one giant string.
  - Files: `api/entriesExport.ts`, `api/_lib/entriesExport.ts`, `api/_lib/__tests__/entriesExport.test.ts`, `api/_lib/__tests__/entriesExportRoute.test.ts`
  - Acceptance criteria the planner set:
    - GET /api/entries-export without a session is refused by withAuth; non-GET returns 405
    - Every query filters transactions.user_id and accounts.user_id by the session user id and has an explicit LIMIT; no client-supplied id is read
    - Voided (deleted_at set) entries are not in the CSV; a test fails if the deleted_at filter is removed
    - Test proves CSV income/expense totals equal summariseLedger output for the same range and fixture lines
    - A range over the cap, an inverted range, a malformed date and a result over the row limit each return a plain-message error with no CSV
    - Net, VAT and gross columns are pounds with two decimals via src/lib/money.ts; gross equals net plus VAT
    - Text cells starting with = + - @ are neutralised; commas, quotes and newlines are quoted
    - npm run lint, typecheck, test pass
  - Risk: Opus high: owner-scoped data egress, a CSV injection vector and tenant isolation are the core of this ticket; a missing owner filter would leak another user's ledger.
  - Commit: `4f6a9346a4b1`

- [x] **Task 2: Download CSV button and date range on ReportsPage** (after 1)
  - Intent: Replace the Coming soon stub in src/pages/ReportsPage.tsx with a small form: From and To date inputs (default to the current UK tax year start and today via dashboardPeriods in src/lib/dashboardSummary.ts, reusing it, not new date logic) and a Download CSV button (min-h-11, 44px target). Add src/lib/exportApi.ts with a downloadEntriesCsv(from, to) that fetches /api/entries-export with credentials same-origin, and on a non-OK response throws the server's plain message, shown inline as an error; on success saves the blob via an object URL anchor click and revokes the URL. Keep the page container and tokens the same as DashboardPage (p-4 md:p-8, no new max-width), labelled inputs with visible focus, error text not colour-only, button disabled with Downloading... while pending. Do not send any user id. Add a component test (src/pages/ReportsPage.test.tsx) with fetch mocked: success triggers a download for the chosen range, error message from a refused range is displayed, inverted range is blocked client-side. Add GET /api/entries-export to e2e/mockApi.ts returning a small invented CSV so the journey can load the page, and add a reports step to e2e/journey.spec.ts if the existing step helper makes that a few lines; use only invented fixture data.
  - Files: `src/pages/ReportsPage.tsx`, `src/pages/ReportsPage.test.tsx`, `src/lib/exportApi.ts`, `e2e/mockApi.ts`, `e2e/journey.spec.ts`
  - Acceptance criteria the planner set:
    - ReportsPage shows From, To and a Download CSV button; no Coming soon text remains
    - Clicking Download CSV calls /api/entries-export with from and to only, and no user id
    - A refused range displays the server's message in an element with role alert
    - Button is at least 44px high, keyboard operable, and disabled while pending
    - Inverted range shows an inline message and makes no request
    - npm run lint, typecheck, test, build pass
  - Commit: `9a810d748c94`

- [ ] **Task 3: Capture screenshots and document the export** (after 2)
  - Intent: Run the e2e journey (or the existing screenshot approach used for browser-evidence/STF-70) against the mocked API and save screenshots of the Reports page (default state and refused-range error state) at 390 and 1440 px, light theme, as browser-evidence/STF-81/<width>-light-<step>.png, e.g. 390-light-reports.png, 1440-light-reports.png, 390-light-reports-error.png, 1440-light-reports-error.png. Check no sideways scroll at 390 and 1440. Add a short docs/workflows/csv-export.md describing the route, columns, range and row limits, what is included (drafts shown with status, voided excluded) and that the file holds financial data the owner should store safely. Screenshots must show invented records only. If Playwright cannot run in the sandbox, say so plainly and let the orchestrator capture them.
  - Files: `browser-evidence/STF-81/390-light-reports.png`, `browser-evidence/STF-81/1440-light-reports.png`, `browser-evidence/STF-81/390-light-reports-error.png`, `browser-evidence/STF-81/1440-light-reports-error.png`, `docs/workflows/csv-export.md`, `e2e/journey.spec.ts`
  - Acceptance criteria the planner set:
    - Four PNGs exist at the stated paths and show the Reports page at 390 and 1440 px
    - docs/workflows/csv-export.md states the date-range and row limits and the inclusion rule
    - No real data in screenshots or docs; no machine paths or job ids
    - npm run lint, typecheck, test, build pass
