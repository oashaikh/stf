# STF-35: Connect a bank account

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

- STF-34 is merged: BankFeedProvider and the TrueLayer sandbox provider exist in api/_lib.
- Routes live under api/bank/ as Vercel functions, like api/hmrc/.
- Existing signState/verifiedStateUserId and the HMRC encryption key/state secret are reused; no new env vars.
- Consent expiry is 90 days after consent because TrueLayer's token response only gives the access-token lifetime.
- The first GBP account from listAccounts is linked; one active connection per user.
- Masked account number is the last 4 digits from the provider's account_number if present, else null.

## Out of scope

- Fetching or importing transactions, and decrypting stored tokens to use them
- Refreshing bank tokens in a cron job
- Choosing between several bank accounts
- Any UI outside the Settings Bank section
- Dark-mode screenshots (app ships light only)

## User journey

Starts at: Signed-in owner opens Settings

1. Settings page, Bank section (`src/pages/SettingsPage.tsx, src/pages/BankSection.tsx`)
   - Before: No Bank section.
   - After: Shows a Connect button, or the linked account with expiry date and Reconnect or Disconnect.
2. Bank consent screen (TrueLayer) (`api/bank/connect.ts`)
   - Before: Not reachable.
   - After: Connect opens the provider's consent page using a signed state.
3. Return to Settings after consent (`api/bank/callback.ts`)
   - Before: Not reachable.
   - After: Callback verifies state, saves the connection, redirects to /settings?bank=connected or ?bank=error.

Also depends on:
- STF-34 bank feed provider (merged)

## Tasks

- [x] **Task 1: Add bank_connections table and migration 0020**
  - Intent: Add a `bank_connections` Drizzle table in server/src/db/schema.ts with these columns:
  - Commit: `fa823e8bcfc3`
- Identity and ownership: id; user_id (uuid, FK to users, on delete cascade); provider (text); provider_account_id (text).
- Display: display_name (text); masked_account_number (nullable text, last 4 digits only).
- Consent and tokens: [REDACTED]] (timestamptz); access_token_encrypted and refresh_token_encrypted (text, ciphertext from encryptToken); token_expires_at (timestamptz).
- Timestamps: created_at, updated_at, deleted_at (soft delete).

Add a partial unique index on (user_id, provider, provider_account_id) where deleted_at is null, and an index on user_id. Then:
1. Hand-write migration 0020_bank_connections.sql in the style of 0018 (IF NOT EXISTS plus the duplicate_object guard).
2. Add the 0020 entry to meta/_journal.json and a meta/0020_snapshot.json. Generate the snapshot with `drizzle-kit generate` only if it runs without a DB.
3. Export the inferred row types and extend schema.test.ts.

Re-check that there is a single migration head before finishing.
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/0020_bank_connections.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0020_snapshot.json`, `server/src/db/schema.test.ts`
  - Acceptance criteria the planner set:
    - schema.ts exports bankConnections and its row and insert types
    - Migration 0020 creates the table, the foreign key to users and both indexes, and is registered in the journal as the only new head
    - No plaintext token column exists
    - schema.test.ts asserts the new table's columns, including deleted_at
    - npm run typecheck and npm test pass
  - Risk: opus/high: schema and migration work that holds encrypted credentials.

- [x] **Task 2: Bank store and consent routes: start, callback, status, disconnect** (after 1)
  - Intent: Add api/_lib/bankStore.ts, modelled on hmrcStore.ts: a BankStore interface plus a database implementation. Every query filters on the session user id and has `.limit()`. Tokens are written with encryptToken. Disconnect sets deleted_at and clears the token ciphertext; it never runs DELETE.
  - Commit: `bc08f220ce8e`
Add routes under api/bank/:
1. connect.ts (GET, auth): returns { ok: true, url } from provider.startConsent(signState(auth.userId)), using createTrueLayerProvider(trueLayerConfigFromEnv()).
2. callback.ts (GET, public like api/hmrc/callback.ts): verifiedStateUserId decides the user; invalid state returns 400 INVALID_STATE. Cap the code length, call finishConsent, list accounts, save the first GBP account with consent expiry = now + 90 days. No GBP account redirects to /settings?bank=error. The provider call finishes before the single-statement write (no transaction across the network call). Redirect to /settings?bank=connected or ?bank=error; log only the error class name.
3. status.ts (GET, auth): returns { connected, displayName, maskedAccountNumber, consentExpiresAt, expired } with no tokens.
4. disconnect.ts (POST, auth): soft-deletes the caller's active connection.

Also: extend BankAccount and the TrueLayer provider with an optional last-4 masked number (update fixture and test); change TRUELAYER_REDIRECT_URI in .env.example to the API callback path /api/bank/callback; add the new routes to docs/security/input-inventory.md.

Tests with fakes: bad, forged and expired state refused on callback; stored token columns are ciphertext; status reports expired consent; disconnect sets deleted_at; a second user cannot read or disconnect the first user's connection; unauthenticated requests are refused.
  - Files: `api/_lib/bankStore.ts`, `api/_lib/bankFeed.ts`, `api/_lib/truelayerProvider.ts`, `api/_lib/__tests__/fixtures/truelayerSandbox.ts`, `api/_lib/__tests__/truelayerProvider.test.ts`, `api/bank/connect.ts`, `api/bank/callback.ts`, `api/bank/status.ts`, `api/bank/disconnect.ts`, `api/_lib/__tests__/bankRoutes.test.ts`, `api/_lib/__tests__/bankStore.test.ts`, `docs/security/input-inventory.md`, `.env.example`
  - Acceptance criteria the planner set:
    - Callback returns 400 INVALID_STATE for missing, forged or expired state and never calls the provider then
    - A test shows saved access and refresh tokens are encrypted and decrypt back to the plaintext
    - Status returns expired: true when consentExpiresAt is past and never returns a token field
    - Disconnect sets deleted_at, clears token ciphertext, and a repeat is harmless
    - All store queries are scoped by session user id and carry an explicit limit
    - A test shows user B cannot read or disconnect user A's connection
    - inputInventory and apiRoutes tests pass with the new routes
    - npm run lint, typecheck and test pass
  - Risk: opus/high: OAuth callback, signed state, token encryption and per-user isolation.

- [x] **Task 3: Bank section on the Settings page** (after 2)
  - Intent: Add src/lib/bankApi.ts (fetchBankStatus, fetchBankConnectUrl, disconnectBank) in the style of tradingAllowanceApi.ts. Add src/pages/BankSection.tsx and render it in SettingsPage.tsx.
  - Commit: (none — no code change for this task)
The section uses StateMessage for loading, empty and error states, and existing tokens and container. With no connection it shows a Connect button. With a connection it shows display name, masked number, consent expiry date, and a Disconnect button that confirms and names what it affects. An expired or expiring-soon (within 14 days) notice shows a Reconnect button; colour is never the only signal. It reads ?bank=connected|error on return. Tap targets are at least 44px with visible focus.

Put expiry-state logic in a small pure function with a unit test. Add component tests with the API module mocked (connected, expiring, expired, error). Add the /api/bank/status case to e2e/mockApi.ts.
  - Files: `src/lib/bankApi.ts`, `src/pages/BankSection.tsx`, `src/pages/BankSection.test.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `e2e/mockApi.ts`
  - Acceptance criteria the planner set:
    - Settings shows a Bank section with Connect when no account is linked
    - A linked account shows name, masked number and expiry date
    - Expired consent shows an expired notice and Reconnect; expiring within 14 days shows a warning and Reconnect
    - Disconnect needs confirmation then refreshes the section
    - Tests cover connected, expiring, expired, error and disconnect with no real network
    - npm run lint, typecheck, test and build pass

- [x] **Task 4: Screenshot evidence for the Bank section** (after 3)
  - Intent: Capture the Settings Bank section at 1440 px and 390 px using the e2e mock API, for these states: not connected, connected, expired. Use invented data only. Save in browser-evidence/STF-35/ with a short PR-notes.md in the style of browser-evidence/STF-100/PR-notes.md. Check there is no sideways scroll at either width.
  - Files: `browser-evidence/STF-35/PR-notes.md`, `browser-evidence/STF-35/settings-bank-not-connected-1440-light.png`, `browser-evidence/STF-35/settings-bank-not-connected-390-light.png`, `browser-evidence/STF-35/settings-bank-connected-1440-light.png`, `browser-evidence/STF-35/settings-bank-connected-390-light.png`, `browser-evidence/STF-35/settings-bank-expired-1440-light.png`, `browser-evidence/STF-35/settings-bank-expired-390-light.png`
  - Acceptance criteria the planner set:
    - Screenshots exist at 1440 px and 390 px for each listed state
    - They show only invented data
    - PR-notes.md lists each file and what it shows
    - Lint, typecheck, test and build still pass
  - Commit: `4b82b2170c64`
