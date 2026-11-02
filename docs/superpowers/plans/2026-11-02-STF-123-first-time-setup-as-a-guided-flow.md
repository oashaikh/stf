# STF-123: First-time setup as a guided flow

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

- Business type choices are the existing enum values (sole trader, partnership, limited company); the spec does not list the choices, so review notes should say so and the owner can correct it in the ticket.
- 'VAT registered' is its own nullable boolean because a null vat_number cannot tell 'no' from 'not answered'; a saved VAT number counts as registered when pre-filling.
- The existing HMRC and bank OAuth callbacks stay unchanged (they return to /settings and /bank); a client-side return marker brings the user back to /setup.
- Single-owner app, so 'first sign-in' means setup_finished_at is null and nothing has been skipped.
- Migration 0024 avoids 0022/0023 planned by STF-74 and STF-87; the implementer re-checks the head against main.

## Out of scope

- The full to-do-list Home (dates, overdue items, money summary) from section 1 of the spec
- Changing the HMRC or bank OAuth callbacks or the Settings and Bank pages
- Live HMRC submission or any change to sandbox/live opt-in
- The shared jargon test and OfficialName component (STF-120)
- Collecting UTR, NINO or business address in the setup flow

## User journey

Starts at: New owner signs in for the first time and lands on /home

1. Sign-in redirect (`src/App.tsx`)
   - Before: Signed-in user always lands on Home
   - After: A user with unfinished, unskipped setup is sent once to /setup
   - Depends on: STF-119 (menu and Home route, merged)
2. Setup steps 1 to 4 (business type, VAT registered, connect HMRC, connect bank) (`src/pages/SetupFlow.tsx`)
   - Before: Does not exist; these are separate controls in Settings and Bank
   - After: One question per screen with Step n of 4, Back, Save and leave, Skip
3. HMRC and bank return (`src/App.tsx`)
   - Before: Returns to /settings or /bank and stops
   - After: Returns to /setup at the next unfinished step
4. Home (`src/pages/SetupTodos.tsx`)
   - Before: No setup prompts
   - After: Each skipped or unfinished step is a to-do row with one button that reopens that step

Also depends on:
- STF-119 six-item menu with Home first (merged)

## Tasks

- [ ] **Task 1: Remember setup progress on the server**
  - Intent: Add the small amount of server state the flow needs and one route to read and write it. Add users.vat_registered (nullable boolean, so 'not answered yet' is distinguishable from 'no'), users.setup_skipped_steps (text[] of step ids, default empty) and users.setup_finished_at (nullable timestamptz). The business type column already exists but nothing in api/ sets it, so the same route accepts a business type (existing enum values) and updates users.business_type. New migration 0024_first_time_setup.sql with a matching _journal.json entry and snapshot, parented on the current head (0022 on this branch; STF-74 and STF-87 plan 0022/0023, so re-check the head against main before finishing and keep a single head). Route api/settings/setup.ts: GET returns {businessType, vatRegistered, skippedSteps, finishedAt}; POST validates every field server-side (enum for businessType, boolean for vatRegistered, step ids from a fixed list, 'finish' flag) and sets finishedAt on the server. Pre-fill comes from existing columns (business_name, vat_number, HMRC and bank status), so no other server work. The route is behind withAuth and scoped to auth.userId. Pure validation lives in api/_lib/setupProgress.ts with a store interface in the style of api/_lib/vatNumber.ts. Add the route to docs/security/input-inventory.md.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0024_first_time_setup.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0024_snapshot.json`, `api/_lib/setupProgress.ts`, `api/settings/setup.ts`, `api/_lib/__tests__/setupProgress.test.ts`, `api/_lib/__tests__/setupRoute.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Migration adds the three columns with IF NOT EXISTS, grants them if the repo's role grants require it, and the journal has a single head with a unique version
    - GET /api/settings/setup without a session is refused; with a session returns only this user's four fields
    - POST rejects an unknown business type, a non-boolean vatRegistered, and unknown or duplicate step ids with 400, with a test for each
    - POST with finish sets setup_finished_at on the server; the client cannot send the timestamp
    - Setting vatRegistered to false leaves an existing vat_number alone and a test pins that
    - A test shows an unauthenticated request cannot read or change the user row
    - docs/security/input-inventory.md lists the new route and its inputs
    - npm run lint, typecheck, test and build pass
  - Risk: Schema migration and a new authenticated write route, hence opus at high. Migration number clashes with STF-74/STF-87 plans; implementer must re-check the head against main.

- [ ] **Task 2: Setup steps logic and client API** (after 1)
  - Intent: Pure, tested logic for the flow plus a thin fetch client. src/lib/setupFlow.ts defines the four steps in order (business type, VAT registered or not, connect HMRC, connect the bank), the one-sentence 'what this is for' text for each in plain words (no word from the 'Never on screen' table in docs/design/ease-of-use.md; official names only as small-text companions), and functions: which steps are done (from setup state plus existing HMRC status, bank status and vat_number), which is next, which are skipped and so still to-do, and whether the flow should show at all. Pre-fill rule: a step STF already knows (HMRC connected, bank connected, VAT number saved implies registered) shows as done and only asks to confirm. src/lib/setupApi.ts wraps GET/POST /api/settings/setup in the style of businessProfileApi.ts and reuses fetchHmrcStatus, fetchBankStatus, fetchVatNumberMask and saveVatNumber.
  - Files: `src/lib/setupFlow.ts`, `src/lib/setupFlow.test.ts`, `src/lib/setupApi.ts`, `src/lib/setupApi.test.ts`
  - Acceptance criteria the planner set:
    - Unit tests cover: brand-new user shows step 1 and 'Step 1 of 4'; known answers pre-fill and count as done; skipped steps are listed as to-do items; flow hidden once finished; flow hidden when every step is done or skipped
    - Step copy is one plain sentence per step and a test checks no banned word from the ease-of-use table appears
    - setupApi tests use a fake fetch, no live network
    - npm run lint, typecheck, test and build pass

- [ ] **Task 3: Guided first-time setup screens** (after 2)
  - Intent: New page src/pages/SetupFlow.tsx at /setup: one question per screen with a 'Step 2 of 4' progress line, Back, 'Save and leave' and 'Skip for now' on every step. Step 1: three plain business type choices. Step 2: 'Are you registered for VAT?' Yes uses the existing saveVatNumber (9-digit validation reused), No records vatRegistered=false. Step 3: connect HMRC via fetchHmrcConnectUrl, labelled test mode, no live opt-in offered. Step 4: connect the bank via fetchBankConnectUrl. Both OAuth callbacks return to other pages (/settings?hmrc=... and /bank?bank=...), so the page sets a sessionStorage marker before leaving and a small component sends the user back to /setup, which resumes at the next unfinished step from server state. Use StateMessage, min-h-11 tap targets, focus rings and existing Tailwind tokens as in BankSection. Add the route in src/App.tsx (small hunk). Component tests mock the API modules.
  - Files: `src/pages/SetupFlow.tsx`, `src/pages/SetupFlow.test.tsx`, `src/App.tsx`, `src/App.test.tsx`
  - Acceptance criteria the planner set:
    - Each of the four steps renders alone with correct 'Step n of 4' text, Back, Save and leave, and Skip
    - Skip and Save and leave persist through the setup API; reopening /setup resumes at the first unfinished step
    - Pre-filled steps show a confirm state rather than asking again
    - Connect buttons call the existing helpers and set the return marker; a test shows a return to /settings?hmrc=connected goes back to /setup
    - HMRC step shows a visible test-mode label and no live-mode control
    - No word from the 'Never on screen' table appears in rendered text outside small official-name text
    - Keyboard path works and every control has a visible focus style
    - npm run lint, typecheck, test and build pass
  - Risk: App.tsx is also edited by STF-87; keep the diff to one import and one route plus the return component. Settings and BankSection are owned by STF-120 and are not touched.

- [ ] **Task 4: Show setup after first sign-in and as to-dos on Home** (after 3)
  - Intent: After sign-in, a user whose setup is not finished is sent once to /setup (redirect inside the signed-in routes driven by server setup state, so it holds across devices and does not loop once skipped or finished). On Home (DashboardPage, first menu item after STF-119) add a small SetupTodos component, rendered near the top, with one row per skipped or unfinished step in plain words and one button that reopens that step. Do not restructure the page; the full to-do-list Home is separate work.
  - Files: `src/pages/SetupTodos.tsx`, `src/pages/SetupTodos.test.tsx`, `src/pages/DashboardPage.tsx`, `src/pages/DashboardPage.test.tsx`, `src/App.tsx`, `src/App.test.tsx`
  - Acceptance criteria the planner set:
    - A signed-in user with no finished or skipped setup is redirected to /setup from /home; a user who skipped everything or finished is not
    - Skipping all four steps gives four to-do rows on Home, each with one button opening the matching step
    - Finishing a step removes its row
    - A setup-state load failure does not block Home: it shows a StateMessage error and the rest of Home renders, with no redirect loop
    - DashboardPage test mocks give the new setup query defined data
    - npm run lint, typecheck, test and build pass
  - Risk: DashboardPage.tsx and its test are also edited by STF-120; keep the hunk to one import and one render line so it auto-merges.

- [ ] **Task 5: Mock API, new-user walkthrough and evidence** (after 4)
  - Intent: Extend e2e/mockApi.ts with a setup-state endpoint (empty for a new user, remembers writes) and add a new-user walkthrough block to e2e/journey.spec.ts: sign in, land on /setup, go through all four steps once finished and once skipped, arrive at Home with to-dos. Capture screenshots at 1440 and 390, light and dark, of each changed screen walked from the start, invented figures, sandbox only, committed under browser-evidence/STF-123/ with captions.md giving every image a plain-English title. Add review-notes.md stating where screens differ from docs/design/ease-of-use.md and why. Add a short docs/workflows/first-time-setup.md.
  - Files: `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `browser-evidence/STF-123/captions.md`, `browser-evidence/STF-123/review-notes.md`, `browser-evidence/STF-123/`, `docs/workflows/first-time-setup.md`
  - Acceptance criteria the planner set:
    - Walkthrough runs in mock mode with no live network and no real data
    - Screenshots exist for every setup screen and Home-with-to-dos at 1440 and 390 in light and dark, and captions.md has a plain-English title for every image
    - review-notes.md lists each difference from the spec and the reason
    - No evidence file contains real customer data, tokens or machine paths
    - npm run lint, typecheck, test and build pass
  - Risk: e2e/mockApi.ts and e2e/journey.spec.ts are also edited by STF-121 and STF-74; add new handlers and a separate test block rather than editing existing ones. If the app ships no dark theme, say so in captions.md.
