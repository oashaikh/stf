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

- HMRC client_id and client_secret come from the HMRC_CLIENT_ID and HMRC_CLIENT_SECRET env vars, not per-user DB columns. The ticket says user-supplied, but the users table has no columns for them and a schema change is not required to meet the acceptance criteria. Per-user credentials would be a follow-up ticket.
- The Fastify control plane hosts the connect, callback and status routes (server/src/api/), not Vercel functions under api/. api/ does not exist and the Vite `/api` proxy already targets port 8787. Deviation from the PLAN.md tree: callback and connect live in server/src/api/ instead of api/hmrc/.
- OAuth state is stateless: an HMAC-signed, user-bound value with a 10 minute expiry. This avoids a new table, and HMRC's one-time code limits replay.
- Only HMRC_TOKEN_ENCRYPTION_KEY is a new secret. Operators set it; the agent does not set live env values.
- No HMRC credentials exist on the server, so every test uses a mocked token endpoint, as the operator comment says.

## Out of scope

- VAT obligations and submission calls, and fraud-prevention headers for server-side calls (client.ts builds them from browser globals)
- Per-user HMRC client_id and secret storage
- Encrypting the existing utr column
- Disconnect flow, income tax scopes, and multi-instance job locking
- Audit-event logging of HMRC calls
- Rotating HMRC_TOKEN_ENCRYPTION_KEY (a re-encrypt migration)

## Tasks

- [ ] **Task 1: Fastify control plane bootstrap with Clerk auth hook**
  - Intent: server/ has only a db folder: no Fastify, no entrypoint, and `npm run dev:server` points at a server/package.json that does not exist. Add the smallest runnable control plane: `buildApp()` in server/src/app.ts (so tests can use `app.inject`), server/src/index.ts listening on port 8787 (the port the Vite `/api` proxy targets), and a server/src/auth.ts preHandler. The preHandler verifies the Clerk bearer token with the already-installed @clerk/backend, resolves the users row by clerk_user_id, and fails closed with 401 or 403. Fix the `dev:server` script. Add `fastify` as a dependency. Add `tsx` as a devDependency only if needed to run TS in dev, with the reason stated in the commit. Add a per-client rate limit on /api/hmrc/* with a documented ceiling. Tests use a faked token verifier, with no live Clerk call.
  - Files: `package.json`, `package-lock.json`, `server/src/app.ts`, `server/src/index.ts`, `server/src/auth.ts`, `server/src/auth.test.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - `buildApp()` returns a Fastify instance; a request without a valid bearer token to a protected route gets 401 and the handler never runs
    - A test with a faked verifier shows an unknown clerk_user_id is refused (fail closed)
    - `npm run dev:server` resolves to a real entrypoint and listens on 8787
    - Lock file is committed and `npm ci` works
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: opus/high: sign-in and authorization boundary. Every later route depends on it, so it must fail closed.

- [ ] **Task 2: Token encryption and signed OAuth state helpers**
  - Intent: Add server/src/hmrc/crypto.ts using node:crypto only, with no new dependency. `encryptToken` and `decryptToken` use AES-256-GCM with a random IV per call; output is a versioned string `v1:iv:tag:ciphertext` that fits the existing TEXT columns. The key comes from a new env var HMRC_TOKEN_ENCRYPTION_KEY (32 bytes, base64), validated at use, and throwing if missing or the wrong length. `signState(userId, now)` and `verifyState(state, now)` produce a stateless CSRF value: a random nonce, the user id and an expiry (10 minutes), HMAC-signed with a key derived from the same secret (HKDF, distinct info label). Verification uses `timingSafeEqual` and rejects tampered, expired or malformed values. Errors never include token or key material. Tests: round trip, wrong-key failure, tamper detection, expiry, and a different user's state. Document the env var in .env.example. Add a `ponytail:` comment that state is not single-use; HMRC's one-time code covers replay, and the upgrade path is a nonce table.
  - Files: `server/src/hmrc/crypto.ts`, `server/src/hmrc/crypto.test.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - Encrypted output never contains the plaintext, and two encryptions of the same value differ
    - Decrypt with a wrong key or a modified ciphertext throws
    - verifyState rejects expired, tampered, truncated and other-user states, and accepts a fresh one
    - Missing or short HMRC_TOKEN_ENCRYPTION_KEY throws a message that does not echo the key
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: opus/high: cryptography and secrets handling.

- [ ] **Task 3: HMRC client: server-safe config, correct authorize URL, code exchange and refresh**
  - Intent: client.ts must stay the only file that calls HMRC (architectures.md). Fix its shared base-URL resolution: `import.meta.env` is undefined under node/tsx, so importing it from Fastify would crash at load. Read `process.env.HMRC_SANDBOX_MODE` as a fallback and keep sandbox as the default. Fix `buildHmrcAuthUrl`, which sends sandbox users to `test-api.service.hmrc.gov.uk/oauth/authorize`; the sandbox authorize host is `test-www.tax.service.gov.uk`. Fix it once in this shared function. Add `exchangeAuthCode(config, code)` and `refreshAccessToken(config, refreshToken)` that POST form-encoded to `/oauth/token`. They return an `HmrcTokenSet`, with `expiresAt` computed from `expires_in` in integer ms, and throw `HmrcError` on non-2xx. Error messages and any logging never contain request bodies or tokens. Do not call the browser-only fraud-header builder from these token calls. Tests inject a fake `fetch` (a mocked token endpoint, per the operator comment) and cover the URL host in both modes, the form body, the success mapping and the error mapping.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`
  - Acceptance criteria the planner set:
    - Importing client.ts under plain node (no `import.meta.env`) does not throw
    - Sandbox mode builds the authorize URL on the test-www host and live mode on www.tax.service.gov.uk; scope is `read:vat write:vat`; `state` and `redirect_uri` are included
    - exchangeAuthCode and refreshAccessToken post `grant_type`, `client_id`, `client_secret` and `code` or `refresh_token` as form data, using the injected fetch
    - A 400 `invalid_grant` response throws HmrcError whose message contains no token or secret
    - No test makes a live network call
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: Default sonnet/medium. It touches the shared HMRC client, but has no auth or storage logic.

- [ ] **Task 4: HMRC connect, callback and status routes with encrypted token storage** (after 1, 2, 3)
  - Intent: Add Fastify routes in server/src/api/hmrc.ts, registered in app.ts. (1) GET /api/hmrc/connect (authenticated): refuses live mode unless HMRC_SANDBOX_MODE=false AND users.hmrc_sandbox_mode is false; otherwise returns `{ url }` built by buildHmrcAuthUrl with the signed state for that user. (2) GET /api/hmrc/callback (the browser redirect from HMRC, so no bearer header): verifyState first, and on failure return 400 and make no HMRC call. Then exchange the code, encrypt both tokens, and update only that user's row (access token, refresh token, expiry, updated_at). The HMRC call happens outside any transaction. Finally redirect to `${APP_ORIGIN}/settings?hmrc=connected` or `?hmrc=error`. (3) GET /api/hmrc/status (authenticated): returns `{ connected, expiresAt }` only, never tokens. Client id and secret come from env HMRC_CLIENT_ID and HMRC_CLIENT_SECRET (see assumptions). Update `.env.example` HMRC_REDIRECT_URI to the proxied `/api/hmrc/callback`. Tests use app.inject with a fake db, a fake HMRC fetch and a fake verifier. Cover: valid flow stores only ciphertext, forged or expired or other-user state is refused with no token exchange, status never leaks tokens, and logs capture nothing sensitive.
  - Files: `server/src/api/hmrc.ts`, `server/src/api/hmrc.test.ts`, `server/src/app.ts`, `.env.example`
  - Acceptance criteria the planner set:
    - Callback with a bad, expired or other-user state returns 400, stores nothing and does not call the token endpoint
    - After a successful callback the stored hmrc_access_token and hmrc_refresh_token are `v1:` ciphertext and never equal the plaintext; the plaintext does not appear in any captured log line
    - Callback only writes the user identified by the verified state
    - Connect refuses live mode unless both the env flag and the per-user opt-in allow it
    - Status response has no token fields
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: opus/high: OAuth, CSRF, token storage and per-user isolation.

- [ ] **Task 5: Scheduled token refresh job with supporting index migration** (after 3, 4)
  - Intent: Create the new server/src/jobs/ folder with refreshHmrcTokens.ts, wired into index.ts via a plain setInterval (no scheduler dependency). Add a `ponytail:` comment naming the single-instance ceiling and the upgrade path to a queue or advisory lock. Each run selects users whose refresh token is not null and whose hmrc_token_expires_at is within the next 15 minutes. The query has a LIMIT, is one query per run (no N+1), and selects only the columns it needs. For each user, outside any transaction (): decrypt the refresh token, call refreshAccessToken, encrypt the new pair, and update that row. Guard the update so it only applies if the stored refresh token is still the one we used, because HMRC rotates refresh tokens. A failure on one user is logged by internal user id and error code only, never tokens or bodies. On `invalid_grant`, clear that user's three token columns so Settings shows disconnected, and log it. Add a migration with a partial index on `users(hmrc_token_expires_at) WHERE hmrc_refresh_token IS NOT NULL`, generated with drizzle-kit so the journal keeps a single head and the next version number. Register the query for the audit if the repo has an audit registry, otherwise state in the PR that none exists. Tests use a fake db, fake HMRC fetch and `vi.useFakeTimers`, with no sleeps.
  - Files: `server/src/jobs/refreshHmrcTokens.ts`, `server/src/jobs/refreshHmrcTokens.test.ts`, `server/src/index.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/0001_hmrc_token_expiry_index.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0001_snapshot.json`
  - Acceptance criteria the planner set:
    - A user expiring inside the window is refreshed and stored as ciphertext; a user expiring later is untouched
    - Query is bounded by LIMIT and runs once per tick
    - invalid_grant clears that user's tokens without affecting other users; one failure does not abort the batch
    - Lost-update guard: if the stored refresh token changed mid-run, the write is skipped
    - Migration journal has exactly one head, parented on 0000, and schema.test.ts still passes
    - No log line or thrown message contains a token
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
  - Risk: opus/high: schema migration plus token handling in a background job.

- [ ] **Task 6: Settings page: Connect to HMRC button and connection status** (after 4)
  - Intent: Replace the SettingsPage placeholder with a minimal HMRC card. It shows connected or disconnected from GET /api/hmrc/status, reading `?hmrc=connected|error` from the callback redirect for feedback. The Connect button calls GET /api/hmrc/connect with the Clerk session token (useAuth().getToken) and sets `window.location` to the returned url. Use the shared Radix/Tailwind patterns already in the repo and the existing loading/error conventions. Tap target at least 44px, visible focus, and colour is not the only status signal. Render text only, never token values. Add a small test with the fetch and Clerk hook mocked. If no testing-library is installed, extract the status-to-label mapping as a pure function and test that instead, with no new dependency. Include light/dark screenshots at 1440 and 390 px only if dark mode exists.
  - Files: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`
  - Acceptance criteria the planner set:
    - Settings shows a clear disconnected or connected state and a Connect button that triggers the redirect with the bearer token
    - No raw hex or px font sizes; button is at least 44x44 px and keyboard focusable
    - `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` all pass
