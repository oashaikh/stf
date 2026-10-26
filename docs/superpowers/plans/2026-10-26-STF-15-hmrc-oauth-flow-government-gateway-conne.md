# STF-15: HMRC OAuth flow (Government Gateway connect)

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

- STF-3 is merged into dev per the operator comment, but the local dev branch in this checkout has no api/ folder yet. The implementer must fetch and merge dev before Tasks 4 and 6, and read STF-3's real helper exports rather than trusting names here.
- HMRC client_id and client_secret come from the HMRC_CLIENT_ID and HMRC_CLIENT_SECRET env vars (operator agreed); per-user credentials are not stored.
- OAuth state is stateless: HMAC-signed, user-bound, 10 minute expiry, so no new table is needed.
- HMRC_TOKEN_ENCRYPTION_KEY and the state-signing secret are new secrets that operators set; the agent only adds placeholders to .env.example.
- No HMRC credentials exist on the server, so all tests use a mocked token endpoint.
- The shared crypto/state helpers live where both api/ and server/ can import them; the implementer picks the location after seeing how STF-3 wired tsconfig and imports.

## Out of scope

- VAT obligations and submission calls, and fraud-prevention headers for server-side calls (client.ts builds them from browser globals)
- Per-user HMRC client_id and secret storage
- Encrypting the existing utr column
- Disconnect flow, income tax scopes, and multi-instance job locking
- Audit-event logging of HMRC calls
- Rotating HMRC_TOKEN_ENCRYPTION_KEY (a re-encrypt migration)
- Any HTTP auth in the Fastify control plane, or a second sign-in check (STF-3 owns auth)

## Tasks

- [x] **Task 1: Minimal Fastify entrypoint for scheduled jobs (no HTTP auth)**
  - Intent: server/ has only a db folder, and `npm run dev:server` points at a server/package.json that does not exist. Add the smallest runnable Fastify process whose only job is hosting scheduled jobs: server/src/index.ts creates the Fastify instance, starts it, and calls a `startScheduledJobs(app)` registry in the new server/src/scheduled-jobs/index.ts (empty registry now; Task 5 adds the refresh job). No HTTP routes and no Clerk hook or auth check, because STF-3's auth helper protects the user-facing routes in the serverless API folder. Fix the `dev:server` script to run the entrypoint. Add `fastify` as a dependency. Add `tsx` as a devDependency only if needed to run TS in dev, and say why in the commit. Clear timers on app close. Add .env.example entries for the control plane port.
  - Files: `package.json`, `package-lock.json`, `server/src/index.ts`, `server/src/scheduled-jobs/index.ts`, `server/src/scheduled-jobs/index.test.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - `npm run dev:server` resolves to a real entrypoint and starts Fastify
    - No auth hook and no user-facing HTTP route exists in server/
    - A test shows startScheduledJobs registers its timers and they are cleared when the app closes (fake timers, no sleeps)
    - Lock file is committed and `npm ci` works
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: Default sonnet/medium. Dependency add only; no auth logic.
  - Commit: `a3392938ee9f`

- [x] **Task 2: Token encryption and signed OAuth state helpers**
  - Intent: Pure server-side helpers shared by the API routes and the refresh job, placed where both can import them (e.g. server/src/lib/hmrcCrypto.ts, or api/_lib/ if the server tsconfig can import it after merging dev). encryptToken/decryptToken use AES-256-GCM from node:crypto with a random IV per call and the key from HMRC_TOKEN_ENCRYPTION_KEY, failing closed if the key is missing or not 32 bytes. signState/verifyState produce an HMAC-signed, user-bound value with a 10 minute expiry and a nonce; verifyState uses a constant-time compare and rejects forged, expired, malformed or other-user state. No logging of values. Add HMRC_TOKEN_ENCRYPTION_KEY and the state-signing secret to .env.example as placeholders only. Tests cover round-trip, tamper detection, wrong key, expiry via a faked clock, and other-user state.
  - Files: `server/src/lib/hmrcCrypto.ts`, `server/src/lib/hmrcCrypto.test.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - encrypt then decrypt returns the original; ciphertext differs between calls for the same input
    - A flipped ciphertext byte or wrong key makes decrypt throw, and the message contains no plaintext
    - verifyState rejects forged, expired (faked clock), malformed and other-user state
    - Missing or wrong-length key throws at use, never falls back to plaintext
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: opus/high: cryptography and CSRF state, a security path.
  - Commit: `d8d706d19a69`

- [x] **Task 3: HMRC client: server-safe config, correct authorize URL, code exchange and refresh**
  - Intent: src/lib/hmrc/client.ts builds fraud headers from browser globals and has no OAuth helpers. Add buildHmrcAuthUrl, exchangeAuthCode and refreshAccessToken as server-safe functions (no browser globals touched at import), with fetch injected so tests never hit the network. Sandbox mode uses the test-www authorize host and live uses www.tax.service.gov.uk; scope is `read:vat write:vat`; state and redirect_uri are included. Token calls post form data (grant_type, client_id, client_secret, code or refresh_token). Client id and secret are read from HMRC_CLIENT_ID and HMRC_CLIENT_SECRET. A 400 invalid_grant throws HmrcError with a message that contains no token or secret. Live mode requires HMRC_SANDBOX_MODE=false.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - Sandbox mode builds the authorize URL on the test-www host and live mode on www.tax.service.gov.uk; scope is `read:vat write:vat`; state and redirect_uri are included
    - exchangeAuthCode and refreshAccessToken post grant_type, client_id, client_secret and code or refresh_token as form data, using the injected fetch
    - A 400 invalid_grant response throws HmrcError whose message contains no token or secret
    - No test makes a live network call
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: Default sonnet/medium. Shared HMRC client, but no auth or storage logic.
  - Commit: `c1cc735e85cc`

- [x] **Task 4: HMRC connect, callback and status API routes using STF-3 auth and db helpers** (after 1, 2, 3)
  - Intent: Blocked on STF-3: first run `git merge dev` and confirm STF-3's shared auth helper and database helper exist in the serverless API folder (api/_lib/). Read their real exports before coding; do not write a second sign-in check. Add serverless routes under api/hmrc/, matching PLAN.md. (1) connect, authenticated by the STF-3 auth helper: refuse live mode unless HMRC_SANDBOX_MODE=false AND users.hmrc_sandbox_mode is false; otherwise return `{ url }` from buildHmrcAuthUrl with signState for that user. (2) callback (browser redirect from HMRC, no bearer header; identity comes from the signed state, and the route sits on the explicit public list per STF-3's convention): verifyState first, on failure respond 400 with no HMRC call. Then exchange the code, encrypt both tokens, and update only that user's row (access token, refresh token, expiry, updated_at) through the db helper. The HMRC call happens outside any transaction. Redirect to `${APP_ORIGIN}/settings?hmrc=connected` or `?hmrc=error`. (3) status, authenticated: return `{ connected, expiresAt }` only, never tokens. Set .env.example HMRC_REDIRECT_URI to the `/api/hmrc/callback` path and add APP_ORIGIN. Make sure root typecheck/lint cover the api folder, extending them only if STF-3 did not. Tests use a mocked HMRC token endpoint (fake fetch) and a fake db, no live HMRC or database. Cover: valid flow stores only ciphertext; forged, expired or other-user state refused with no token exchange; unauthenticated connect and status refused; a second user cannot read the first user's status; logs capture nothing sensitive.
  - Files: `api/hmrc/connect.ts`, `api/hmrc/callback.ts`, `api/hmrc/status.ts`, `api/hmrc/hmrc.test.ts`, `.env.example`, `package.json`
  - Acceptance criteria the planner set:
    - dev has been merged and the routes call STF-3's auth helper and db helper; no new sign-in or db connection code is added
    - A request without valid sign-in to connect or status is refused and the handler body never runs
    - A valid callback stores only ciphertext in hmrc_access_token and hmrc_refresh_token, and updates only the state's user row
    - Forged, expired, malformed or other-user state returns 400 with no call to the token endpoint
    - Status returns only connected and expiresAt, never token material
    - Live mode is refused unless env and user setting both allow it
    - No log line or error body contains a token, secret or auth code
    - All HMRC tests use a mocked token endpoint
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: opus/high: authentication, CSRF state and token storage. Must follow STF-3's real helper API after merging dev.
  - Commit: `cf7525ac560f`

- [ ] **Task 5: Scheduled token refresh job in the Fastify control plane with supporting index migration** (after 1, 2, 3)
  - Files: `server/src/scheduled-jobs/refreshHmrcTokens.ts`, `server/src/scheduled-jobs/refreshHmrcTokens.test.ts`, `server/src/scheduled-jobs/index.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/0001_hmrc_token_expiry_index.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0001_snapshot.json`
  - Acceptance criteria the planner set:
    - A user expiring inside the window is refreshed and stored as ciphertext; a user expiring later is untouched
    - Query is bounded by LIMIT and runs once per tick, with an index behind its filter
    - invalid_grant clears that user's tokens without affecting other users; one failure does not abort the batch
    - Lost-update guard: if the stored refresh token changed mid-run, the write is skipped
    - Migration journal has exactly one head, parented on 0000, and schema.test.ts still passes
    - No log line or thrown message contains a token
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: opus/high: schema migration plus token handling in a background job.

- [ ] **Task 6: Settings page: Connect to HMRC button and connection status** (after 4)
  - Files: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`
  - Acceptance criteria the planner set:
    - Settings shows a clear disconnected or connected state and a Connect button that triggers the redirect with the bearer token
    - No raw hex or px font sizes; button is at least 44x44 px and keyboard focusable
    - The page never renders or stores token values
    - Test mocks fetch and Clerk; no live call
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: Default sonnet/medium. UI only; the server enforces auth.
