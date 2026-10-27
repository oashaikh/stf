# STF-48: Recurring entries that create drafts

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

- STF-68 (referenced prerequisite) has merged and the draft/confirm flow in api/_lib/entries.ts is the posting function to reuse.
- Operator comment says merge dev in first; the implementer should do that before starting, and re-check the migration head afterwards.
- Vercel cron daily is enough; the local Fastify scheduled-jobs runner is not extended.
- Idempotency is enforced by a separate recurring_entry_runs table with a unique key rather than a column on transactions, so STF-77's changes to schema.ts and entries.ts are not overlapped.
- Templates assume a single owner per account and the existing session userId.

## Out of scope

- Weekly or custom schedules
- Auto-confirming generated entries
- Editing already generated drafts differently from existing entries
- Backfilling past occurrences before the first date
- Local Fastify scheduled-job registration

## User journey

Starts at: Owner signs in and opens Expenses

1. Expenses page, recurring templates section (`src/pages/ExpensesPage.tsx, src/pages/RecurringEntriesSection.tsx`)
   - Before: Add-entry form and entries list only
   - After: A recurring templates list with add, edit, pause/resume and delete controls above the entries list
2. Entries list showing generated drafts (`src/pages/EntriesList.tsx`)
   - Before: Only manually created drafts and confirmed entries
   - After: Drafts created by the daily cron appear and are confirmed with the existing confirm action
   - Depends on: api/cron/create-recurring-entries.ts having run

Also depends on:
- STF-68

## Tasks

- [ ] **Task 1: Pure schedule maths for recurring templates**
  - Intent: Add src/lib/recurringSchedule.ts with pure functions: nextOccurrence(date, schedule, anchorDay) for monthly/yearly and dueDates(nextDate, schedule, anchorDay, today, cap) returning every ISO date due up to today (bounded by cap) plus the following next date. Month ends clamp to the last day using the stored anchor day so clamping does not drift (31 Jan -> 28/29 Feb -> 31 Mar; 29 Feb yearly -> 28 Feb in non-leap years). String/UTC date maths only, no floats; reuse src/lib/dates.ts helpers where they fit. Tests cover month ends, leap years, year rollover, catch-up of several missed periods and the cap.
  - Files: `src/lib/recurringSchedule.ts`, `src/lib/recurringSchedule.test.ts`
  - Acceptance criteria the planner set:
    - 31 Jan monthly gives 28 Feb (29 in a leap year) then 31 Mar
    - 29 Feb yearly gives 28 Feb in a non-leap year and 29 Feb in the next leap year
    - dueDates returns every missed date up to today and never more than the cap
    - Functions are pure: no Date.now, no floats
    - npm run lint, typecheck and test pass

- [ ] **Task 2: Schema and migration for templates and run ledger**
  - Intent: Add recurring_entry_templates (id, user_id FK, kind income|expense, category_account_id FK accounts, amount_pence integer with CHECK > 0, amount_is gross|net, vat_rate_percent nullable, description, schedule monthly|yearly enum, anchor_day, next_date, paused, created_at, updated_at, deleted_at) and recurring_entry_runs (template_id FK, run_date, transaction_id FK, UNIQUE(template_id, run_date)) so a template can never create the same date twice, even with overlapping cron runs. Indexes: templates (user_id, deleted_at, next_date) for the owner list and (next_date) for the cron scan. Hand-written migration 0015_recurring_entries.sql in the style of 0013 (IF NOT EXISTS, DO blocks), journal idx 15 and 0015 snapshot. STF-77 holds 0014, so do not reuse that prefix; re-check the journal for a single head against main before finishing. Soft delete via deleted_at only. Extend server/src/db/schema.test.ts.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0015_recurring_entries.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0015_snapshot.json`
  - Acceptance criteria the planner set:
    - Migration is idempotent and the journal has a single head
    - Unique constraint on (template_id, run_date) exists in schema and SQL
    - Both tables carry user scoping and the listed indexes
    - npm run typecheck and test pass
  - Risk: Schema and migration work; journal also edited by STF-77, so expect a trivial merge conflict to resolve.

- [ ] **Task 3: Template API and due-entry generator** (after 1, 2)
  - Intent: Add api/_lib/recurringEntries.ts with zod schemas, owner-scoped list/create/update/pause/soft-delete (every query filtered by auth.userId from the session, explicit LIMIT, e.g. 100 templates) and generateDueEntries(now): scan non-paused, non-deleted templates with next_date <= today (limit per run), and for each due date from dueDates() call createEntry from api/_lib/entries.ts so output goes through the posting function and is always status draft. Per date: in one DB transaction insert the run row with ON CONFLICT DO NOTHING on (template_id, run_date) and skip if nothing inserted, then advance next_date; do no network work inside the transaction. Closed VAT periods or too-far-ahead dates must not abort the whole run: log the template id only and leave next_date unchanged. Add api/recurring-entries.ts route behind withAuth (GET/POST/PATCH/DELETE by id, reject ids belonging to other users). Tests: output always draft, running twice creates once, month-end dates, paused skipped, second user refused a first user's template id, list is limited.
  - Files: `api/_lib/recurringEntries.ts`, `api/recurring-entries.ts`, `api/_lib/__tests__/recurringEntries.test.ts`, `api/_lib/__tests__/recurringEntriesRoute.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`
  - Acceptance criteria the planner set:
    - Every generated transaction has status draft
    - A second generateDueEntries run for the same date creates no new entry
    - Template routes ignore any client-supplied user id and return 404 or 403 for another user's id
    - All queries have an explicit limit and use the new indexes
    - npm run lint, typecheck and test pass
  - Risk: Authorisation, per-owner isolation and idempotency on financial records.

- [ ] **Task 4: Cron route for recurring entries** (after 3)
  - Intent: Add api/cron/create-recurring-entries.ts mirroring refresh-hmrc-tokens.ts: fail closed without CRON_SECRET, timing-safe bearer check, runs generateDueEntries, logs counts only, non-2xx on total failure. Register a daily cron and maxDuration in vercel.json. CRON_SECRET already exists in .env.example, so no new env var. Tests mirror api/cron/__tests__/refresh-hmrc-tokens.test.ts (401 without or with a wrong secret, 200 and counts on success, 500 on failure).
  - Files: `api/cron/create-recurring-entries.ts`, `api/cron/__tests__/create-recurring-entries.test.ts`, `vercel.json`
  - Acceptance criteria the planner set:
    - Request without the correct bearer secret gets 401 and runs nothing
    - Logs carry counts only, no description text or ids of people
    - vercel.json has a daily schedule for the new path
    - npm run lint, typecheck and test pass

- [ ] **Task 5: Manage templates on the Expenses page** (after 3)
  - Intent: Add src/lib/recurringEntriesApi.ts (react-query client in the style of mileageApi.ts, money via parsePence/formatPence) and a RecurringEntriesSection child component rendered from src/pages/ExpensesPage.tsx above EntriesList: list templates (kind, description, amount, schedule, next date, paused), add/edit form (kind, category, amount, VAT rate only when the business has a VAT number, description, schedule, first date), pause/resume, and delete with a confirmation naming the template. Use shared loading/empty/error components, page container and tokens (), 44px targets, table collapsing to labelled rows on phones with money right-aligned. Generated drafts appear in the existing EntriesList and are confirmed there, no new confirm flow. Component and page tests with the API client mocked; extend e2e/mockApi.ts for the new route and add a journey step. Capture screenshots of the Expenses page with templates at 1440 and 390 px (light, plus dark if themes exist) into browser-evidence/ per the operator naming (STF-48-*-light-*.png).
  - Files: `src/lib/recurringEntriesApi.ts`, `src/pages/RecurringEntriesSection.tsx`, `src/pages/RecurringEntriesSection.test.tsx`, `src/pages/ExpensesPage.tsx`, `src/pages/ExpensesPage.test.tsx`, `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `browser-evidence/`
  - Acceptance criteria the planner set:
    - Owner can create, pause, resume and delete a template from /expenses
    - Delete asks for confirmation and says which template
    - No horizontal scroll at 1440 px; rows are labelled at 390 px
    - Screenshots at 1440 and 390 px are committed under browser-evidence/
    - npm run lint, typecheck, test and build pass

- [ ] **Task 6: Document the recurring entries workflow** (after 4, 5)
  - Intent: Write docs/workflows/recurring-entries.md: template fields, schedule and month-end rule, idempotency via the run ledger, drafts only and confirmation from the Expenses list, cron setup and CRON_SECRET, catch-up cap, retention (templates soft-deleted, kept with the books). Add a short pointer in PLAN.md if the roadmap lists this feature.
  - Files: `docs/workflows/recurring-entries.md`, `PLAN.md`
  - Acceptance criteria the planner set:
    - Doc matches the shipped behaviour
    - No secrets or machine paths in the doc
