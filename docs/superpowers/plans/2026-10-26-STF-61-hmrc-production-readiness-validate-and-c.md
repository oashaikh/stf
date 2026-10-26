# STF-61: HMRC production readiness: validate and complete the fraud prevention headers

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

- The validation API is sandbox-only and (to be confirmed in the docs) needs an application-restricted token from the client_credentials grant with the existing HMRC client id and secret. The implementer must read the current HMRC docs and follow them if they differ.
- Login is a single-owner password with no second factor, so Gov-Client-Multi-Factor is omitted.
- The vendor public IP and licence ids come from env vars (HMRC_VENDOR_PUBLIC_IP exists already).
- audit_events already exists with a jsonb snapshot, so no migration is needed.
- The ticket has no dark theme requirement; screenshots follow existing browser-evidence convention.

## Out of scope

- Applying for production credentials, or any live HMRC submission
- Changing HMRC_SANDBOX_MODE or any live env var
- Rate limiting for the new route beyond the existing ponytail note
- Calling HMRC's separate fraud-header feedback endpoint
- Real multi-factor login

## Tasks

- [x] **Task 1: Complete and fix the WEB_APP_VIA_SERVER header builder**
  - Intent: Rework buildFraudHeaders in src/lib/hmrc/fraudHeaders.ts so it emits the full HMRC header set for WEB_APP_VIA_SERVER, per the current guide at developer.service.hmrc.gov.uk/guides/fraud-prevention. Read that guide first and fix the formats it specifies.
  - Commit: `d11c8aad4bba`
Headers to emit:
- Gov-Client-Connection-Method
- Gov-Client-Browser-JS-User-Agent
- Gov-Client-Browser-Do-Not-Track
- Gov-Client-Device-ID
- Gov-Client-Screens
- Gov-Client-Timezone, as UTC+hh:mm
- Gov-Client-User-IDs
- Gov-Client-Window-Size
- Gov-Client-Public-IP
- Gov-Client-Public-IP-Timestamp, ISO 8601 with milliseconds and Z
- Gov-Client-Public-Port
- Gov-Vendor-Public-IP
- Gov-Vendor-Forwarded, as by=<vendor ip>&for=<client ip>
- Gov-Vendor-License-IDs
- Gov-Vendor-Product-Name
- Gov-Vendor-Version, key=value pairs

The optional Gov-Client-Browser-Plugins may be added if it is simple.

On Vercel, the client IP comes from x-vercel-forwarded-for or x-forwarded-for. The client port comes from the platform's port header if one exists; verify which. The vendor IP and licence-id source come from env vars. Add any new vars to .env.example and keep src/lib/__tests__/envExample.test.ts passing.

Gov-Client-Multi-Factor is omitted entirely for a password-only login. HMRC's spec says to send it only when MFA is used. Add a comment citing that.

This is a bug fix to the shared builder, so submit, preview and obligations all inherit it (). Add the x-stf-* browser values the SPA must send (do-not-track, and any other missing ones) to browserFraudHeaders in src/lib/hmrc/vatApi.ts.

Extend fraudHeaders.test.ts with one format test per header, plus missing-input cases. The tests must show which headers are absent or present, and must not leak the token.
  - Files: `src/lib/hmrc/fraudHeaders.ts`, `src/lib/hmrc/fraudHeaders.test.ts`, `src/lib/hmrc/vatApi.ts`, `src/lib/hmrc/vatApi.test.ts`, `api/_lib/vatSubmit.ts`, `api/vat/obligations.ts`, `.env.example`, `src/lib/__tests__/envExample.test.ts`, `api/_lib/__tests__/vatSubmit.test.ts`, `api/_lib/__tests__/vatObligations.test.ts`, `api/_lib/__tests__/vatPreview.test.ts`
  - Acceptance criteria the planner set:
    - Builder output includes every WEB_APP_VIA_SERVER header listed, each matching the HMRC format
    - Gov-Client-Multi-Factor is absent for password-only login, with a test
    - Client IP and port are read from Vercel forwarded headers
    - Submit, preview and obligations all use the one builder and the one input-assembly path
    - Unit tests cover the format of each header
    - New env vars are in .env.example and envExample test passes
    - npm run lint, typecheck and test pass
  - Risk: The HMRC spec must be read from the live docs, not memory; formats are strict. The port header name on Vercel needs verification.

- [x] **Task 2: HMRC application-restricted token and Test Fraud Prevention Headers client**
  - Intent: Add the HMRC client call to the Test Fraud Prevention Headers validation API, which is sandbox-only. Read the current docs for the endpoint, which is GET /test/fraud-prevention-headers/validate on the sandbox base, and the token type it needs. I expect an application-restricted token from the client_credentials grant using HMRC_CLIENT_ID and HMRC_CLIENT_SECRET. If the docs say user-restricted, use withHmrcToken instead.
  - Commit: `5c1b564c5f39`
Put everything in src/lib/hmrc/client.ts, since all HMRC calls go through it. Add a function that obtains the token and a function that takes the fraud headers and returns the parsed result. Normalise the HMRC response into { code, message, errors[], warnings[] }, where each entry has headers (a list of header names) and a message. Force the sandbox base URL regardless of HMRC_SANDBOX_MODE.

The token must never appear in a thrown error, a log line or the returned value. Cover the call with a mocked-fetch unit test: pass, warnings only, errors, HMRC 4xx/5xx, and a check that the token is absent from the output.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`
  - Acceptance criteria the planner set:
    - Validation call hits the sandbox endpoint only, even when HMRC_SANDBOX_MODE=false
    - Result is normalised into errors and warnings, each with header names and a message
    - Token type matches HMRC's current docs
    - No token in errors or results, tested
    - Tests use a mocked fetch, no live call
    - npm run lint, typecheck and test pass
  - Risk: Token type must be confirmed against HMRC docs; the client secret is a credential, so keep it out of every output.

- [x] **Task 3: Server route to run the check and record an audit event** (after 1, 2)
  - Intent: Add api/vat/fraud-headers-check.ts (or api/hmrc/fraud-check.ts). It is a POST route behind withAuth that uses the same header-building path as submit. Extract a small shared function from prepareSubmission and the obligations route, so there is one place that assembles FraudHeaderInput from the request and env. Do not add a second copy.
  - Commit: `7d314acdb0dc`
The route calls the task 2 validator and returns the normalised result, with no token and no raw HMRC body.

It inserts an audit_events row with action 'hmrc.fraud_headers.validated', actorType 'user', resourceType 'hmrc_fraud_validation', and the userId. The row's afterSnapshot holds the outcome and the error and warning lists. Include the sent header values only if they carry no token; they hold an IP and a device id, so apply and keep them to header names and results. If the insert fails, that failure must be visible: return an error rather than swallowing it.

Tests, which use fakes (no live DB) in the style of vatPreviewRoute.test.ts and apiRoutes.test.ts:
- unauthenticated request gets 401
- wrong method gets 405
- the result is returned
- the audit row is written
- no token appears in the response or the audit snapshot

There is no DB schema change, since audit_events exists. The route stays sandbox-only.
  - Files: `api/vat/fraud-headers-check.ts`, `api/_lib/fraudHeadersCheck.ts`, `api/_lib/vatSubmit.ts`, `api/vat/obligations.ts`, `api/_lib/__tests__/fraudHeadersCheck.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`
  - Acceptance criteria the planner set:
    - Route requires sign-in and rejects other methods
    - Headers sent are built by the same shared function as a real submission
    - Each run inserts one audit event with the outcome and no tokens
    - Response and audit snapshot contain no token, tested
    - Audit insert failure is surfaced, not swallowed
    - npm run lint, typecheck and test pass
  - Risk: Touches authenticated routes and credential handling; the audit snapshot must not leak personal or secret data. The route-rate-limit ponytail note in submit.ts applies here too.

- [ ] **Task 4: Settings button 'Check HMRC fraud headers' and result rendering** (after 3)
  - Intent: Add a client function in src/lib/hmrc/settingsApi.ts that POSTs to the new route and sends the browserFraudHeaders (export it from vatApi.ts). It maps failures to a visible error.
Add a section to SettingsPage.tsx with the button 'Check HMRC fraud headers'. Follow the existing section markup and the shared loading and error components (). The result shows a clear pass, or lists each error and warning with its header name and message. Use text plus an icon, not colour alone (). Tap targets are at least 44px (), and the layout works at 390 and 1440 px. Fonts and colours come from tokens ().

Add a mocked-fetch test in SettingsPage.test.tsx that renders a result with an error and a warning, and a second with a pass. Capture screenshots at 390 and 1440 px (light only; confirm whether a dark theme exists) into browser-evidence/settings-fraud-check/, following the existing folder convention.
  - Files: `src/pages/SettingsPage.tsx`, `src/pages/SettingsPage.test.tsx`, `src/lib/hmrc/settingsApi.ts`, `src/lib/hmrc/vatApi.ts`, `browser-evidence/settings-fraud-check/screenshot-390.png`, `browser-evidence/settings-fraud-check/screenshot-1440.png`
  - Acceptance criteria the planner set:
    - Button runs the check and shows HMRC's result: a pass, or each error and warning with header name and message
    - Mocked test shows the rendered result in Settings
    - Error state shown if the request fails
    - Screenshots at 390 and 1440 px exist
    - npm run lint, typecheck, test and build pass

- [ ] **Task 5: Document the check and the header set** (after 1, 4)
  - Intent: Update docs/workflows/vat-return.md and docs/runbooks/vercel-deploy.md. Cover the full header table for WEB_APP_VIA_SERVER, the new env vars, how to run the check from Settings, and the multi-factor decision (password-only, header omitted). Add a note in docs/ on HMRC_VENDOR_PUBLIC_IP and the licence ids. Docs only.
  - Files: `docs/workflows/vat-return.md`, `docs/runbooks/vercel-deploy.md`
  - Acceptance criteria the planner set:
    - Docs list every header with its source
    - New env vars are documented
    - npm run lint, typecheck, test and build still pass
