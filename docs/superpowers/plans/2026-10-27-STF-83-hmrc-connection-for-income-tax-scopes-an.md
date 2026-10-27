# STF-83: HMRC connection for Income Tax: scopes and self-employment business id

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

- STF-82 (encrypted NINO in users.nino_encrypted, readable through databaseTaxIdentifiersStore) and STF-61 are already merged on this branch; the repo shows STF-82 in the commit log.
- HMRC's token response includes a `scope` field, so the granted scopes can be stored on the users row to drive the one-time reconnect notice.
- Self-employment business listing uses the existing Business Details endpoint in listItsSelfEmploymentBusinesses; only businesses with typeOfBusiness 'self-employment' are offered.
- The next migration number is 0016. STF-48's live plan names a 0015 migration, which already exists on main, so whichever branch merges second must renumber.

## Out of scope

- Submitting Income Tax cumulative period summaries or any other Income Tax API beyond the business list.
- Provisioning the HMRC sandbox Income Tax test user or adding the Income Tax APIs to the HMRC developer application (owner action).
- Changing the VAT flows.
- Live-mode Income Tax calls beyond the existing env-flag plus owner-opt-in gate.

## User journey

Starts at: Settings page, HMRC (Government Gateway) section

1. Settings: HMRC section (`src/pages/SettingsPage.tsx`)
   - Before: Connect or Reconnect button only; the connection grants VAT scopes only.
   - After: A notice says Income Tax needs a one-time reconnect. After reconnecting, the section shows the chosen self-employment business, or a picker when HMRC returns more than one.
   - Depends on: STF-82 (NINO saved in Settings) and STF-61
2. HMRC OAuth consent (external) then callback redirect to Settings (`api/hmrc/connect.ts, api/hmrc/callback.ts`)
   - Before: Consent for VAT scopes only.
   - After: Consent for VAT and self-assessment scopes; returns to /settings?hmrc=connected.

Also depends on:
- STF-82
- STF-61

## Tasks

- [x] **Task 1: Request Income Tax scopes and return the granted scope from the token exchange**
  - Intent: In src/lib/hmrc/client.ts, widen HMRC_SCOPE from 'read:vat write:vat' to also include 'read:self-assessment write:self-assessment'. buildHmrcAuthUrl is the single builder behind api/hmrc/connect.ts, so connect.ts needs no change. Add an optional `scope` field to HmrcTokenSet and fill it from the token response in postTokenRequest, because the callback needs it to record what was granted. Refresh responses may omit scope, so keep it optional and never infer it. Update client.test.ts: the auth URL carries all four scopes, and the token exchange returns scope. Nothing logs tokens. Do not add a new helper for the business list: listItsSelfEmploymentBusinesses already exists in this file and already takes fraudHeaders.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`
  - Acceptance criteria the planner set:
    - buildHmrcAuthUrl output has a scope param containing read:vat, write:vat, read:self-assessment and write:self-assessment
    - postTokenRequest returns the response scope on HmrcTokenSet.scope when HMRC sends one, undefined otherwise
    - Existing client tests still pass and new tests cover both scope cases using a fake fetch
    - npm run typecheck and npm test pass
  - Commit: `91d81fc2191a`

- [x] **Task 2: Add ITS business id and granted scope columns, store methods, and callback wiring** (after 1)
  - Intent: Add nullable users columns `hmrc_its_business_id` (text) and `hmrc_scope` (text) in server/src/db/schema.ts. justification: the business id is needed for Income Tax calls, and the scope is needed to show the one-time reconnect notice only when the connection lacks the self-assessment scopes. Write the next Drizzle migration as server/src/db/migrations/0016_hmrc_its_business.sql, with the matching _journal.json entry (idx 16) and meta/0016_snapshot.json. 0015 is already taken by the invoice payment migration. STF-48's plan also names a 0015 recurring-entries migration, so re-check the journal against main before finishing and keep a single head ().: grant the columns if the repo's role grants require it. Extend HmrcStore in api/_lib/hmrcStore.ts with: saveTokens accepting an optional scope that is written to hmrc_scope (and, when the scope changes, clears the stored business id); setItsBusinessId(userId, id); itsBusinessId read; and status() returning itsBusinessId and a `needsItsReconnect` boolean (connected but hmrc_scope lacks the self-assessment scopes). Each query filters on users.id and returns one row, so no new index is needed. api/hmrc/callback.ts passes tokens.scope to saveTokens. Do not log tokens. Update schema.test.ts if it asserts columns, and the hmrc store and callback tests, using fake stores.
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/0016_hmrc_its_business.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0016_snapshot.json`, `api/_lib/hmrcStore.ts`, `api/hmrc/callback.ts`, `api/hmrc/status.ts`, `api/_lib/__tests__/hmrc.test.ts`, `server/src/db/schema.test.ts`
  - Acceptance criteria the planner set:
    - Migration is the only new head and runs idempotently (ADD COLUMN IF NOT EXISTS, matching the 0015 style)
    - Callback stores the granted scope; a reconnect that changes scope clears the stale business id
    - GET /api/hmrc/status returns itsBusinessId and needsItsReconnect without exposing tokens or the NINO
    - A test shows needsItsReconnect is true for a VAT-only scope and false after an Income Tax scope is stored
    - npm run lint, typecheck and test pass
  - Risk: Schema, migration and token-store work; opus high. Migration number may collide with STF-48's migration, so re-check the journal.
  - Commit: `627d9071069b`

- [x] **Task 3: API route to list self-employment businesses and save the chosen business id** (after 2)
  - Intent: Add api/hmrc/its-businesses.ts behind withAuth. GET decrypts the owner's NINO (via databaseTaxIdentifiersStore.get plus decryptToken) and calls listItsSelfEmploymentBusinesses through callHmrcAsUser, so fraud headers are on every call and tokens are refreshed and saved. Filter to typeOfBusiness 'self-employment'. If exactly one business comes back, store its id automatically. Return the id and trading name for each business and never the NINO. Return a clear 409 NO_NINO if no NINO is stored, and a clear error for a missing connection or missing scope. POST {businessId} validates the id with zod against the freshly fetched list () before storing it with setItsBusinessId, so a client cannot store an arbitrary id. Apply the same sandbox/live gate that connect.ts and the existing HMRC routes use (user opt-in must equal env). Logs carry only the HMRC code and status, never the NINO, tokens or URL: callHmrcAsUser already does this, and the NINO is in the path, so check that no log line prints the URL. No transaction is held open across the HMRC call (). Register the route in api/_lib/__tests__/apiRoutes.test.ts and any route list. Tests use a fake HMRC fetch and a fake store: single business auto-selected, multiple businesses need a pick, a rejected unknown id, unauthenticated refusal, 401 refresh path, and a check that the NINO never appears in console output or the response.
  - Files: `api/hmrc/its-businesses.ts`, `api/_lib/itsBusinesses.ts`, `api/_lib/__tests__/itsBusinessesRoute.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`
  - Acceptance criteria the planner set:
    - Every HMRC call from the route carries fraud prevention headers built by requestFraudHeaders
    - Live mode is refused unless HMRC_SANDBOX_MODE=false and the owner opted in
    - POST with an id not in HMRC's list returns 400 and stores nothing
    - A test captures console output and asserts neither the NINO nor any token appears in it
    - Unauthenticated requests are refused
    - npm run lint, typecheck and test pass
  - Risk: Handles NINO decryption, tokens and sandbox/live gating; opus high.
  - Commit: `fe7be4ae43f8`

- [x] **Task 4: Settings: one-time reconnect notice and business picker** (after 3)
  - Intent: In src/lib/hmrc/settingsApi.ts add client functions for the status fields and the its-businesses GET/POST. In src/pages/SettingsPage.tsx, inside the existing HMRC section, show a notice when connected and needsItsReconnect: 'Income Tax needs a one-time reconnect to HMRC', next to the existing Reconnect button. When connected with the right scopes and no business id stored, load the businesses. Auto-selection is handled server-side. If there is more than one, show a labelled select with a Save button. Otherwise show the chosen business name or id. Use the shared loading/error components and existing Tailwind patterns in this file (). Never render the NINO. Tests: SettingsPage.test.tsx cases with the fetch client mocked (); update e2e/mockApi.ts with the new route and status fields so e2e still passes. Capture screenshots at 1440 and 390 px for the PR () with invented data only.
  - Files: `src/lib/hmrc/settingsApi.ts`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `e2e/mockApi.ts`, `browser-evidence/`
  - Acceptance criteria the planner set:
    - Reconnect notice shows only when connected and the stored scope lacks self-assessment
    - With multiple businesses the owner can pick one and the choice is POSTed; with one, no picker shows
    - Error and loading states use the shared components
    - Screenshots at 1440 and 390 px are attached
    - npm run lint, typecheck, test and build pass
  - Commit: `81c9519a24b3`

- [ ] **Task 5: Sandbox integration test for business list (skipped without credentials) and docs** (after 1)
  - Intent: Extend src/lib/hmrc/sandbox.integration.test.ts with a listItsSelfEmploymentBusinesses case, in the same describe.skipIf style as the VAT case, gated on HMRC_CLIENT_ID, HMRC_CLIENT_SECRET, HMRC_SANDBOX_REFRESH_TOKEN and a new HMRC_SANDBOX_NINO. It must also stay skipped when HMRC_SANDBOX_MODE=false, send fraud headers, and not print the NINO or tokens. Document HMRC_SANDBOX_NINO as a commented line in .env.example. src/lib/__tests__/envExample.test.ts checks env coverage, so keep it green. Update docs/runbooks/hmrc-sandbox-integration.md with the Income Tax test user prerequisite, the extra variable, and the one-time reconnect. Tick the relevant PLAN.md line only if the roadmap tracks it.
  - Files: `src/lib/hmrc/sandbox.integration.test.ts`, `.env.example`, `docs/runbooks/hmrc-sandbox-integration.md`, `PLAN.md`
  - Acceptance criteria the planner set:
    - npm test reports the new integration case as skipped when sandbox credentials are unset
    - No real NINO or token appears in the repo; .env.example holds a commented placeholder only
    - envExample.test.ts passes
    - npm run lint, typecheck, test and build pass
