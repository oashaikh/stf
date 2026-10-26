# STF-16: MTD VAT obligations fetch

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

- The VRN is read from users.vatNumber (already in schema); no migration is needed. If vatNumber is null the route returns 409.
- STF-15 left client.ts with browser-global fraud headers and no withHmrcToken; both are fixed here, as the ticket comment says.
- Tokens are stored AES-GCM encrypted (hmrcCrypto.ts); routes decrypt on read and encrypt on write.
- Browser-only fraud values (device id, screens, window size, timezone, JS user agent) are collected by the SPA and forwarded in x-stf-* headers; IP-derived values come from x-forwarded-for on Vercel.
- HMRC sandbox base URL follows existing HMRC_SANDBOX_MODE env logic; no credentials exist so all HMRC calls are mocked.
- Task 3 and task 1 have disjoint files and no dependency, so they may run in parallel; task 2 depends on 1 only for the header type.

## Out of scope

- VAT return submission and the 9-box builder (STF-17/STF-18).
- Fraud-prevention validation against HMRC's Test Fraud Prevention Headers API (needs real credentials).
- Gov-Client-Multi-Factor and other optional headers that need Clerk MFA metadata.
- A DB migration or caching of obligations.
- Editing PLAN.md (STF-18 is editing it).

## Tasks

- [x] **Task 1: Server-side fraud prevention headers module**
  - Intent: Add src/lib/hmrc/fraudHeaders.ts (the path PLAN.md already names) with a pure function that builds the Gov-Client-* and Gov-Vendor-* headers for a server-made call. Inputs: the incoming Request (user-agent, x-forwarded-for for Gov-Client-Public-IP and its timestamp, Gov-Vendor-Public-IP), the internal STF user id (Gov-Client-User-IDs as stf=<id>, never email), app version (Gov-Vendor-Version, Gov-Vendor-Product-Name), plus browser-collected values the SPA will send in x-stf-* request headers (device id, timezone, screens, window size, JS user agent). Connection method is WEB_APP_VIA_SERVER. Values are percent-encoded per HMRC spec; a missing optional value is omitted, never faked. No browser globals, so it is safe to import on the server. Unit-test the output with fixed Request objects and a fixed clock (no sleeps, no network). Do not wire it in yet.
  - Files: `src/lib/hmrc/fraudHeaders.ts`, `src/lib/hmrc/fraudHeaders.test.ts`
  - Acceptance criteria the planner set:
    - buildFraudHeaders returns Gov-Client-Connection-Method=WEB_APP_VIA_SERVER, Gov-Client-User-IDs, Gov-Client-Public-IP and -Timestamp, Gov-Client-Timezone, Gov-Vendor-Version and Gov-Vendor-Product-Name for a populated request
    - Missing optional client headers are omitted rather than defaulted to fake values
    - Header values containing spaces, '&' or '=' are percent-encoded
    - No navigator, window or import.meta usage in the file
    - npm test, typecheck and lint pass
  - Risk: Default tier; header spec details come from HMRC fraud-prevention guide and must be matched by tests.
  - Commit: `67810d87ebcd`

- [x] **Task 2: Make the HMRC client server-safe, pass fraud headers, add refresh-and-retry** (after 1)
  - Intent: In src/lib/hmrc/client.ts remove buildFraudPreventionHeaders (it reads navigator/window and cannot run in an API route) and the import.meta appVersion default. hmrcFetch takes the fraud headers as a parameter; getVatObligations, submitVatReturn and listItsSelfEmploymentBusinesses take them as a required argument (grep for other callers first and update them). Add the withHmrcToken helper the file header already promises: call the operation with the current access token; on an HmrcError with statusCode 401, call the injected refresh (refreshAccessToken) once, persist via an injected callback, retry the operation once with the new token, and rethrow if the retry fails or refresh fails. Also refresh up front when expiresAt is already past. Fetch is injectable so tests mock HMRC. Update client.test.ts for the new signatures and add tests: 401 then success after refresh; refresh failure surfaces an error without a token in its message; second 401 is not retried again. Fix the stale header comment about 'user .env'.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`
  - Acceptance criteria the planner set:
    - client.ts references no navigator, window or import.meta
    - getVatObligations sends the supplied fraud headers on the request (asserted in test with a mocked fetch)
    - withHmrcToken refreshes and retries exactly once on 401 and on an already-expired token, and does not retry non-401 errors
    - Error messages and thrown values contain no access or refresh token
    - npm run typecheck, lint, test pass
  - Risk: Changes a shared function every HMRC caller routes through, so signatures change; typecheck must catch all callers.
  - Commit: `d9ba52d79d9e`

- [x] **Task 3: Store credential read and compare-and-swap refresh save**
  - Intent: Extend HmrcStore in api/_lib/hmrcStore.ts with a read of what the obligations route needs for one user: vat_number (the VRN), encrypted access/refresh tokens, expiry, all by users.id primary key with LIMIT 1 and no select *. Add a save used after a transparent refresh that writes only if the stored refresh token still equals the one used (same guard as the scheduled refresh job in server/src/scheduled-jobs/refreshHmrcTokens.ts), so a request and the cron job cannot clobber each other with rotated tokens. Tokens stay AES-GCM encrypted at rest via server/src/lib/hmrcCrypto.ts (decrypt on read, encrypt on write); do not add a second token store. Register the new queries with the query audit if the repo has one (none found; note in PR). Tests use the existing in-memory fake store pattern from api/_lib/__tests__/hmrc.test.ts.
  - Files: `api/_lib/hmrcStore.ts`, `api/_lib/__tests__/hmrc.test.ts`
  - Acceptance criteria the planner set:
    - New store methods filter only on users.id and are bounded to one row
    - Refresh save is a no-op when the stored refresh token has changed (tested with the fake)
    - Existing hmrc.test.ts cases still pass
    - No token is logged or returned by any new method beyond the route-internal credentials object
    - typecheck, lint, test pass
  - Risk: Touches encrypted HMRC token storage and rotation races; security/data work, so opus high.
  - Commit: `e4d248424768`

- [x] **Task 4: GET /api/vat/obligations route** (after 1, 2, 3)
  - Intent: Add api/vat/obligations.ts following the api/hmrc/status.ts pattern: withAuth (STF-3 helper, no second sign-in check), factory createObligationsHandler(store, authDeps, hmrcDeps) for injection, default export { fetch }. Only GET. Resolve the user from auth.userId only, never from a query parameter. Load credentials via the store; 409 with a clear code when HMRC is not connected or no VAT number is set. Validate optional from/to query params as YYYY-MM-DD (default: last 12 months to today, HMRC's from/to range maximum is one year) and optionally status=O|F; reject others with 400. Build fraud headers (task 1) from the Request, decrypt the stored tokens, call getVatObligations through withHmrcToken (task 2) so an expired token refreshes transparently, retries once and the new tokens are saved encrypted via the CAS store method. Map HmrcError to a sanitised JSON response (code and status, no token, no VRN in logs). Response returns only periodKey, start, end, due, status, received plus a derived overdue flag computed server-side against today's date (injectable clock). Tests with mocked HMRC and fake store: sandbox obligations returned; expired token path refreshes, retries and saves; unauthenticated is 401; user B never sees user A's credentials (/); not connected; bad dates; log capture contains no token. Add the x-stf-* request headers list used by task 1 to .env.example only if any config is needed (expected: HMRC_PRODUCT_NAME not required, skip).
  - Files: `api/vat/obligations.ts`, `api/_lib/__tests__/vatObligations.test.ts`
  - Acceptance criteria the planner set:
    - Unauthenticated request gets 401 and no HMRC call is made
    - Response shape contains only the six obligation fields plus overdue; no tokens, no VRN
    - Expired access token yields transparent refresh, one retry, and tokens saved encrypted through the store CAS method
    - Invalid from/to/status gives 400; not connected gives 409
    - All HMRC traffic is mocked; no network in tests
    - No database transaction is open during the HMRC call (single-statement store calls only)
    - typecheck, lint, test pass
  - Risk: Auth, per-user isolation, token refresh and outbound HMRC call: security-sensitive, so opus high.
  - Commit: `da7a56a8baa3`

- [x] **Task 5: VAT page: fetch and display due, overdue and fulfilled obligations** (after 4)
  - Intent: Replace the 'Coming soon' stub in src/pages/VatPage.tsx with an obligations section. Add src/lib/hmrc/vatApi.ts (mirror settingsApi.ts: getJson with Clerk bearer token, injectable fetch) that calls /api/vat/obligations and sends the x-stf-* browser headers (timezone, screens, window size, JS user agent, and a device id kept in localStorage as a random UUID) that task 1 consumes. Put the list in a new component src/pages/VatObligationsList.tsx to keep the VatPage.tsx edit minimal (STF-18 also edits VatPage.tsx). Show period key, period start-end, due date and a status label (Due, Overdue, Fulfilled) using text, not colour alone; use the shared formatting and Tailwind tokens already used by SettingsPage, shared loading/empty/error patterns, not-connected state linking to /settings, page container conventions, 44px tap targets. Dates only, no money on this screen. Tests (Vitest + Testing Library, vatApi mocked per, mirroring SettingsPage.test.tsx): renders open/overdue/fulfilled rows with period keys and due dates, shows not-connected and error states.
  - Files: `src/pages/VatPage.tsx`, `src/pages/VatObligationsList.tsx`, `src/pages/VatObligationsList.test.tsx`, `src/lib/hmrc/vatApi.ts`, `src/lib/hmrc/vatApi.test.ts`
  - Acceptance criteria the planner set:
    - Obligations from a mocked API render with period key, due date and a text status
    - Overdue rows are distinguishable by text label, not colour only
    - Not-connected (409) shows a link to Settings; other failures show an error state
    - Browser fraud-header values are sent as x-stf-* request headers; device id persists across calls (tested with jsdom localStorage)
    - VatPage.tsx diff is limited to rendering the new component so it merges cleanly with STF-18
    - npm run build, lint, typecheck, test pass; PR needs UI screenshots at 1440 and 390 px ()
  - Risk: Default tier. Merge-conflict risk with STF-18 on VatPage.tsx.
  - Commit: `a53c4952b1a8`
