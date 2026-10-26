# STF-90: Authenticator-app second factor for the owner login (clears HMRC multi-factor warning)

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

- The session stays a stateless signed cookie, so the second-factor record (type, time, hashed reference) is carried inside the signed token rather than a new sessions table.
- The existing encryptToken/decryptToken in server/src/lib/hmrcCrypto.ts is the 'token encryption helper'; its key env var is already configured, so no new .env.example entry is needed.
- STF-89 has merged (confirmed in git log), so the fraud header builder is the current version.
- Adding otpauth and qrcode is acceptable as the 'well-known library' the ticket asks for; package-lock.json changes stay within this ticket's diff ( concerns upgrades, not new additions).
- Total change will exceed the ~400 line guide but is one cohesive feature.

## Out of scope

- Account recovery if both device and recovery codes are lost (owner resets via DB/env)
- Regenerating recovery codes after setup
- Remember-this-device, WebAuthn or SMS factors
- Rate limiting beyond reusing the existing login lockout

## Tasks

- [x] **Task 1: TOTP core, storage schema and migration**
  - Intent: Add the authenticator building blocks with no route or UI change. Add one well-known TOTP library (otpauth, RFC 6238, SHA1, 30 s, 6 digits, +/-1 step window) and a QR library (qrcode, server-side data URL), each justified in the PR because Node crypto has no TOTP and no QR encoder. New server module api/_lib/totp.ts with: generateSecret/otpauthUri, verifyCode(secret, code, now) that also returns the matched time step so a step can be rejected on reuse, generateRecoveryCodes (8 random one-time codes), hashRecoveryCode (SHA-256 of a high-entropy random code is enough; no slow KDF needed), and consumeRecoveryCode that is single-use. Schema: add to users totp_secret_encrypted (via the existing encryptToken/decryptToken in server/src/db/../lib/hmrcCrypto.ts), totp_enabled_at, totp_last_step; new recovery_codes table (user_id, code_hash, used_at) with index on (user_id, code_hash). A new migration 0008 parented on 0007_entries_list_indexes, single head, with grants per. Recovery code rows are credentials, not financial records, so used codes are marked used_at and disabling deletes them; state retention in a comment (). A store port (like LoginAttemptRows) so logic is testable without a database. Tests: valid/invalid/expired code, same step reused is refused, recovery code single use, 8 distinct codes, only hashes stored, secret round-trips encrypted. No secret or code is ever logged.
  - Files: `package.json`, `package-lock.json`, `api/_lib/totp.ts`, `api/_lib/totpStore.ts`, `api/_lib/__tests__/totp.test.ts`, `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0008_totp_second_factor.sql`, `server/src/db/migrations/meta/_journal.json`
  - Acceptance criteria the planner set:
    - npm run lint, typecheck, test, build pass
    - Migration 0008 is the single head after 0007 and adds the new columns/table with an index and grants
    - Stored secret is the output of encryptToken, never plaintext; recovery codes are stored only as hashes
    - Tests fail if code verification, step-reuse rejection or recovery single-use logic breaks
    - The new dependencies are named and justified in the PR body
  - Risk: Opus high: authentication secrets, schema/migration and a new dependency.
  - Commit: `508908092ba7`

- [x] **Task 2: Two-step login with lockout and a second factor on the session** (after 1)
  - Intent: Make login ask for the code after the password when the authenticator is on. api/auth/login.ts: after a correct password and MFA enabled, do not issue a session; return {ok:true, mfaRequired:true} plus a short-lived (5 min) signed challenge cookie (HttpOnly, Secure, SameSite) that proves the password step only and is useless as a session. New api/auth/mfa.ts takes {code} (TOTP or recovery code), checks lockout first, and on failure calls the same loginThrottle.recordFailure so wrong codes count toward the existing 5-failure lockout; success clears the throttle and issues the session. Extend the session token in api/_lib/ownerSession.ts (backward-compatible parse so existing 2-part tokens still verify as no second factor) to carry the second factor: type TOTP, authenticated time, and a random unique reference stored only as its hash; the HMAC covers it. Expose a reader that returns that record for a Request. Tampering must fail verification. Recovery-code login records the same TOTP type. Tests: wrong code returns 401 and counts to the lockout (6th attempt gets 429 even with a right code), reused recovery code refused, challenge cookie alone cannot call requireAuth, tampered token rejected, password-only owner login unchanged. Logs carry the error class only, never code or secret.
  - Files: `api/auth/login.ts`, `api/auth/mfa.ts`, `api/auth/__tests__/login.test.ts`, `api/auth/__tests__/mfa.test.ts`, `api/_lib/ownerSession.ts`, `api/_lib/__tests__/ownerSession.test.ts`, `api/_lib/auth.ts`, `api/_lib/__tests__/auth.test.ts`, `vercel.json`
  - Acceptance criteria the planner set:
    - With MFA off, login behaves exactly as before and existing tests pass
    - With MFA on, a correct password alone never sets the stf_session cookie
    - Wrong codes and reused recovery codes are refused and counted by the existing lockout
    - Session cookie carries type TOTP, time and a hashed reference, covered by the signature
    - No test or log output contains a code or secret
    - lint, typecheck, test, build pass
  - Risk: Opus high: sign-in, session and lockout work ().
  - Commit: `0bad0e33457e`

- [x] **Task 3: Authenticator setup, confirm and disable API** (after 1, 2)
  - Intent: Owner-only routes in api/settings/authenticator.ts behind requireAuth: POST start (generate a pending secret, store it encrypted but not enabled, return otpauth URI, QR data URL and the base32 secret), POST confirm {code} (verify, set totp_enabled_at, generate 8 recovery codes, return them in plaintext exactly once), POST disable {code} (requires the current valid TOTP code, then clears the secret and deletes recovery codes), GET status {enabled}. Restarting setup while enabled is refused. Failed confirm/disable codes count toward the same login lockout. Response bodies never echo back codes beyond the one-time recovery list; no select * (explicit columns). Tests: wrong code on confirm leaves it off, confirm returns 8 codes once and a later status/GET never returns them, disable with wrong code refused and with right code works, unauthenticated requests get 401, no secret in logged output.
  - Files: `api/settings/authenticator.ts`, `api/_lib/__tests__/authenticatorRoute.test.ts`, `api/_lib/totpStore.ts`, `vercel.json`
  - Acceptance criteria the planner set:
    - Authenticator is not enabled until a correct code is confirmed
    - Recovery codes are returned once at confirm and stored only as hashes
    - Disable needs a valid current code; a wrong code is refused and counted toward lockout
    - All routes return 401 without a session
    - lint, typecheck, test, build pass
  - Risk: Opus high: authentication and secret handling.
  - Commit: `3caa35902ca9`

- [x] **Task 4: Send Gov-Client-Multi-Factor from the session record** (after 2)
  - Intent: Replace the deliberate omission in src/lib/hmrc/fraudHeaders.ts. Add an optional secondFactor input ({type, time, uniqueReference hash}) to FraudHeaderInput and emit Gov-Client-Multi-Factor in HMRC's format: type=TOTP&timestamp=<ISO 8601 UTC>&unique-reference=<hash>, each value percent-encoded via encodeValue, only when the session carries a record (omitted for password-only sessions). api/_lib/hmrcCall.ts requestFraudHeaders (the one assembly point used by submit, preview, obligations and the check) reads the record from the request's session cookie so every caller gets it. Update the fraudHeadersCheck flow if it enumerates expected headers. Update docs/fraud-prevention-headers.md and drop the now-wrong comment. Tests: exact header string, header absent without a second factor, value encoding, and that it appears via requestFraudHeaders for a TOTP session.
  - Files: `src/lib/hmrc/fraudHeaders.ts`, `src/lib/hmrc/fraudHeaders.test.ts`, `api/_lib/hmrcCall.ts`, `api/_lib/fraudHeadersCheck.ts`, `api/_lib/__tests__/fraudHeadersCheck.test.ts`, `api/_lib/__tests__/hmrc.test.ts`, `docs/fraud-prevention-headers.md`
  - Acceptance criteria the planner set:
    - Header equals type=TOTP&timestamp=...&unique-reference=... with percent-encoded values
    - No header when the session has no second factor
    - Every HMRC call path gets it through requestFraudHeaders
    - The raw unique reference never appears; only its hash
    - lint, typecheck, test, build pass
  - Risk: Sonnet medium: pure header formatting, but touches the file STF-89 changed; merge dev in first.
  - Commit: `62179c35c4a3`

- [x] **Task 5: Login page asks for the code after the password** (after 2)
  - Intent: Update src/lib/session.ts signIn to return a 'code-required' outcome, add a submitMfaCode call to /api/auth/mfa, and update src/pages/LoginPage.tsx with a second step: label, numeric one-time-code input (autocomplete one-time-code, inputmode numeric), a link to use a recovery code instead, locked and wrong-code messages from the shared error components, and navigation to the Dashboard on success. Use existing tokens and 44px tap targets, keyboard path and focus state. Component tests with the API mocked: password then code lands on Dashboard, wrong code shows error, locked state shown.
  - Files: `src/lib/session.ts`, `src/pages/LoginPage.tsx`, `src/pages/LoginPage.test.tsx`, `src/App.test.tsx`
  - Acceptance criteria the planner set:
    - Password-only sign-in path unchanged when the API returns ok
    - Code step is shown only on mfaRequired, and failure keeps the user on the code step
    - Tests cover wrong code and locked states
    - lint, typecheck, test, build pass
  - Commit: `334ca8f6cd88`

- [x] **Task 6: Settings 'Set up authenticator' section** (after 3)
  - Intent: Add a Settings section (own component file, like ChartOfAccountsSection, to keep SettingsPage small) with: status, Set up authenticator button, QR image with alt text plus the secret as text, code confirmation field, then a one-time recovery codes panel with copy and an acknowledgement before dismissing, and a Turn off flow requiring the current code with a confirmation that says what it affects. API helpers in src/lib/hmrc/settingsApi.ts or a new small authenticatorApi.ts following the existing pattern. Tests with the API mocked: setup happy path, wrong code error, recovery codes shown once, disable needs a code. Responsive at 390 and 1440 px, no raw hex or pixel font sizes.
  - Files: `src/pages/AuthenticatorSection.tsx`, `src/pages/AuthenticatorSection.test.tsx`, `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `src/lib/authenticatorApi.ts`
  - Acceptance criteria the planner set:
    - Flow works end to end against mocked API: start, scan, confirm, recovery codes, turn off with code
    - Recovery codes and secret are not stored in browser storage or logged
    - Destructive turn-off asks for confirmation naming its effect
    - lint, typecheck, test, build pass
  - Commit: `2f184bb76030`

- [x] **Task 7: Journey mock, screenshots and docs** (after 5, 6)
  - Intent: Extend e2e/mockApi.ts and e2e/journey.spec.ts with the authenticator journey (Settings, set up, confirm, save recovery codes, sign out, password then code, Dashboard) in mock mode, capture screenshots of each step at 390 and 1440 px into docs/screenshots for the PR (invented data only), and note the feature in README/architectures/PLAN where auth is described and in a short operations note. Confirm .env.example needs no new variable (the existing token encryption key is reused); the envExample test must still pass.
  - Files: `e2e/mockApi.ts`, `e2e/journey.spec.ts`, `docs/screenshots`, `docs/runbooks/vercel-deploy.md`, `architectures.md`
  - Acceptance criteria the planner set:
    - JOURNEY_MOCK=1 journey passes locally if browsers are available, else reported as not run
    - Screenshots exist for each step at 390 and 1440 px
    - Docs describe setup, recovery codes and disabling
    - lint, typecheck, test, build pass
  - Commit: `a47f33ea2f1a`
