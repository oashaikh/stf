# STF-58: Replace Clerk with a simple single-owner password login

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

- The existing users.clerk_user_id column is reused for the fixed owner external id; no rename migration.
- Fraud prevention user id already derives server-side from auth.userId, which becomes the owner row id, so no header code change is needed.
- Frontend learns signed-in state from GET /api/me (existing protected route), since the cookie is HttpOnly.
- Lockout is global (single owner), not per IP, so the counter table holds only timestamps.
- Secure cookies work on http://localhost in modern browsers.

## Out of scope

- Sign-up, password reset, multiple users
- Renaming users.clerk_user_id
- Rewriting historical migrations and old docs/superpowers plans that mention Clerk
- Rate limiting of other API routes

## Tasks

- [x] **Task 1: Add login_attempts table, migration and lockout store**
  - Intent: Add a small Postgres table recording failed owner-login attempts, plus a pure lockout helper that decides whether logins are refused (5 failures within 15 minutes means refuse for 15 minutes, counted from the latest failure). Table has only attempted_at (and id); no IP or password data (). Hand-write migration 0005 with a fresh journal entry and snapshot parented on 0004 (single head). Add the DB-backed store functions (record failure, count recent failures, clear on success, prune old rows so retention is bounded) in an api/_lib module that takes the db as a dependency so tests use a fake. Also update the schema.ts comment for users (no longer mirrors Clerk); keep the clerk_user_id column name unchanged to avoid a rename migration. The query filters on an indexed attempted_at and uses a LIMIT/bounded count.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0005_login_attempts.sql`, `server/src/db/migrations/meta/0005_snapshot.json`, `server/src/db/migrations/meta/_journal.json`, `api/_lib/loginThrottle.ts`, `api/_lib/__tests__/loginThrottle.test.ts`
  - Acceptance criteria the planner set:
    - Migration 0005 creates login_attempts with an index on attempted_at and the journal has a single head after 0004
    - Unit test: 4 failures in 15 min is allowed, the 5th failure triggers lockout, lockout expires 15 min after the last failure, failures older than 15 min do not count
    - Success clears the counter; stale rows are pruned
    - npm run lint, typecheck, test pass
  - Risk: opus/high: brute-force protection and a schema migration; a wrong window or unindexed query weakens the login control.
  - Commit: `27b9c4c7a6ad`

- [x] **Task 2: Swap Clerk verifier for signed-cookie owner session behind requireAuth**
  - Intent: Create api/_lib/ownerSession.ts: scrypt-hash-then-timingSafeEqual password check against OWNER_PASSWORD (fail closed if unset or empty), HMAC-SHA256 signed session token with expiry (30 days) using SESSION_SECRET (fail closed if unset/short), timingSafeEqual signature check, and Set-Cookie builders (HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000) and a clearing cookie. Change api/_lib/auth.ts so requireAuth reads the session cookie instead of the Bearer header, resolves to the single owner users row created on first login with a fixed external id (stored in clerk_user_id, email a fixed placeholder), keeping the exports requireAuth, withAuth, UnauthorizedError, AuthIdentity and the AuthIssuer/UserStore/AuthDeps shape so no route file changes. Tampered, malformed or expired cookies yield 401 via withAuth before any handler runs. Delete api/_lib/clerkIssuer.ts and its test. Update auth.test.ts and the route tests that send Bearer headers/mention Clerk (vatPreviewRoute, vatSubmitRoute, vatReturns, vatHistory) to use a cookie or the injected deps. No log line or error body may contain password, cookie or secret.
  - Files: `api/_lib/ownerSession.ts`, `api/_lib/__tests__/ownerSession.test.ts`, `api/_lib/auth.ts`, `api/_lib/__tests__/auth.test.ts`, `api/_lib/clerkIssuer.ts`, `api/_lib/__tests__/clerkIssuer.test.ts`, `api/_lib/__tests__/vatPreviewRoute.test.ts`, `api/_lib/__tests__/vatSubmitRoute.test.ts`, `api/_lib/__tests__/vatReturns.test.ts`, `api/_lib/__tests__/vatHistory.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`
  - Acceptance criteria the planner set:
    - Tests: tampered cookie, expired cookie, missing cookie, and wrong-secret cookie each return 401 and the handler is never called
    - Valid cookie resolves to the one owner user id; second request reuses the row (createIfAbsent once)
    - Cookie attributes asserted: HttpOnly, Secure, SameSite=Lax, Max-Age 2592000; password compare uses scrypt + timingSafeEqual
    - No file under api/ other than api/_lib changes; no route file diff
    - grep finds no import of @clerk/backend in api/
    - lint, typecheck, test pass
  - Risk: opus/high: authentication, session signing and secrets handling ().
  - Commit: `b54b683e7211`

- [x] **Task 3: Add login and logout routes with lockout** (after 1, 2)
  - Intent: Add api/auth/login.ts (POST) and api/auth/logout.ts (POST) as the explicit public routes (). Login validates the JSON body (string password, bounded length), checks lockout first (locked returns 429 with Retry-After and does not evaluate the password), compares via ownerSession, records a failure on mismatch (401 generic body), and on success clears the counter, ensures the owner user row exists via the auth helper's store, and returns Set-Cookie with the session. Logout clears the cookie (Max-Age=0, same attributes). Error bodies and console output carry only error class names, never password, cookie or secret. Use dependency injection like the other route tests so no DB or network is touched. Register routes in apiRoutes test if it enumerates routes.
  - Files: `api/auth/login.ts`, `api/auth/logout.ts`, `api/auth/__tests__/login.test.ts`, `api/auth/__tests__/logout.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`
  - Acceptance criteria the planner set:
    - Wrong password returns 401, no Set-Cookie
    - Correct password returns 200 with a valid signed Set-Cookie (HttpOnly, Secure, SameSite=Lax, 30 days)
    - 5 failed attempts then the 6th attempt (even with the right password) returns 429 with no cookie
    - Logout response clears the cookie
    - Test captures console output and asserts the password and cookie value never appear in logs or response bodies
    - lint, typecheck, test pass
  - Risk: opus/high: login endpoint, brute-force defence and cookie issuance.
  - Commit: `4a26658de344`

- [ ] **Task 4: Replace Clerk in the frontend with cookie auth, login page and sign-out** (after 3)
  - Intent: Remove ClerkProvider from main.tsx; App.tsx decides signed-in state by calling a cookie-authenticated GET /api/me (credentials same-origin) via react-query, showing a loading state, then the routes or the login page. Replace SignInPage with a plain LoginPage (labelled password input, submit button, error and lockout messages, using shared tokens, 44px targets, focus states) posting to /api/auth/login. AppShell gets a Sign out item (desktop and phone More) that POSTs /api/auth/logout and returns to login. Drop the token parameter from settingsApi.ts, vatApi.ts and the pages/hooks (VatPage, SettingsPage, useVatHistory, useVatObligations), sending credentials: 'same-origin' instead of Authorization. The HMRC fraud prevention user id already comes from the server's auth.userId (the owner row), so no header code changes beyond removing Bearer. Update the tests that mock @clerk/clerk-react.
  - Files: `src/main.tsx`, `src/App.tsx`, `src/pages/SignInPage.tsx`, `src/pages/LoginPage.tsx`, `src/pages/LoginPage.test.tsx`, `src/components/AppShell.tsx`, `src/components/AppShell.test.tsx`, `src/lib/hmrc/settingsApi.ts`, `src/lib/hmrc/vatApi.ts`, `src/lib/hmrc/vatApi.test.ts`, `src/pages/VatPage.tsx`, `src/pages/VatPage.test.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `src/pages/useVatHistory.ts`, `src/pages/useVatObligations.ts`, `src/pages/VatHistoryList.test.tsx`, `src/pages/VatObligationsList.test.tsx`, `src/model/types.ts`
  - Acceptance criteria the planner set:
    - No import of @clerk/* remains under src/
    - No request sends an Authorization bearer header to /api/*; fetches use credentials same-origin
    - Login page renders a password field and button; wrong-password and locked messages show; sign out calls logout and shows the login page
    - lint, typecheck, test, build pass

- [ ] **Task 5: Remove Clerk packages, env vars and docs; add OWNER_PASSWORD and SESSION_SECRET** (after 4)
  - Intent: Uninstall @clerk/backend and @clerk/clerk-react from package.json and package-lock.json (lockfile edit only, no other upgrades note in PR). In .env.example drop the Clerk block and add OWNER_PASSWORD= and SESSION_SECRET= with no values and a generation hint. Update docs/runbooks/vercel-deploy.md (remove Clerk vars and the 'Clerk allowed origins' section, add the two new vars and 'reset password by changing OWNER_PASSWORD'), and the Clerk mentions in README.md, CLAUDE.md-independent docs AI.md, architectures.md, PLAN.md. Confirm envExample.test.ts passes.
  - Files: `package.json`, `package-lock.json`, `.env.example`, `docs/runbooks/vercel-deploy.md`, `README.md`, `AI.md`, `architectures.md`, `PLAN.md`, `src/lib/__tests__/envExample.test.ts`
  - Acceptance criteria the planner set:
    - grep -ri clerk over package.json, .env.example, runbook and src/api returns nothing (historical migrations and old plan docs excepted)
    - OWNER_PASSWORD and SESSION_SECRET appear in .env.example with empty values
    - npm ci, lint, typecheck, test, build pass

- [ ] **Task 6: Capture login and VAT page screenshots at 390 and 1440 px** (after 5)
  - Intent: Run the app against a throwaway local data store with invented data and an invented OWNER_PASSWORD/SESSION_SECRET, then save screenshots of the login page and of the VAT page after login at 390 and 1440 px under browser-evidence/ following the existing layout. If no database can be started (no Docker), mock the API at the browser level and say so in the report. Screenshots must show no real data or secrets.
  - Files: `browser-evidence/login/screenshot-390.png`, `browser-evidence/login/screenshot-1440.png`, `browser-evidence/vat/screenshot-390.png`, `browser-evidence/vat/screenshot-1440.png`
  - Acceptance criteria the planner set:
    - Four PNGs exist at the stated paths with the right widths
    - Login page and post-login VAT page both visible; no secrets shown
