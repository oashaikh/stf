# STF-85: MTD Income Tax: submit a quarterly update with a confirmation gate

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

- STF-28 (preview, buildCumulativePeriodSummary, selfEmploymentCumulativePath) is merged here. STF-61 (fraud headers, hmrcCall.requestFraudHeaders) is available and I found it in the tree.
- A period is (tax year, quarter). The cumulative endpoint is one PUT per tax year, and each quarter's update replaces the previous cumulative figures.
- A single its_submissions row per (user, tax year, quarter, sandbox) holds both the confirmed snapshot and the lock. A rejected row needs re-confirmation before another try.
- Gated by HMRC_ITSA_ENABLED like the preview route, so no .env.example change is needed.
- The endpoint, version and field names in client.ts are unverified against HMRC docs, and this plan cannot check them. Task 5 asks the implementer to recheck where reachable.

## Out of scope

- Any UI for the declaration, confirm or submit steps; the ticket is backend only
- Final declaration, adjustments and property business
- Calendar-quarter election
- Per-client rate limiting (the existing  ponytail note stands)
- Retrieving a submitted update back from HMRC

## Tasks

- [x] **Task 1: Add its_submissions table and migration 0021**
  - Intent: Add a Drizzle table `its_submissions` and the SQL migration for it. Columns: id, user_id (FK users), tax_year, quarter (1-4), sandbox, status enum (confirmed, pending, submitted, rejected), confirmed_payload jsonb (the server-computed cumulative body at confirmation), confirmed_at, HMRC receipt fields (hmrc_correlation_id, submitted_at), created_at and updated_at. A UNIQUE(user_id, tax_year, quarter, sandbox) constraint doubles as the per-period, per-environment idempotency lock and the lookup index, as vat_submissions does. Use migration prefix 0021_its_submissions, because 0020 is claimed by STF-35. Parent the journal entry on the current head, which is 0019. Add the row types. Extend schema.test.ts only if it enumerates tables.
  - Files: `server/src/db/schema.ts`, `server/src/db/migrations/0021_its_submissions.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/schema.test.ts`
  - Acceptance criteria the planner set:
    - its_submissions is defined in schema.ts with the unique key on (user_id, tax_year, quarter, sandbox)
    - The migration SQL is idempotent in the style of 0003 and 0018, and the journal has a single head (0021 after 0019, or after 0020 if STF-35 merges first)
    - npm run typecheck and npm test pass
    - No other table is changed
  - Risk: Schema and migration work touching financial records, so opus at high. The journal file will conflict with STF-35 at merge; re-check the revision graph against main before finishing.
  - Commit: (none — no code change for this task)

- [x] **Task 2: Add the cumulative update submit call to the HMRC client**
  - Intent: Add `submitCumulativePeriodSummary(nino, businessId, taxYear, payload, accessToken, fraudHeaders, fetchFn)` to src/lib/hmrc/client.ts. It sends PUT to selfEmploymentCumulativePath with Accept set to SELF_EMPLOYMENT_API_ACCEPT, via hmrcFetch. HMRC may answer 204 or an empty body, so make the shared hmrcFetch tolerate an empty success body instead of crashing on response.json(). That is a fix in the shared function, not a one-off. The 'recheck against HMRC docs' caveat on the existing endpoint stays. Add client.test.ts cases with a fake fetch for: the PUT URL, headers and body; a 4xx mapped to HmrcError; and an empty 2xx body.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`
  - Acceptance criteria the planner set:
    - The new function is the only HMRC caller for this endpoint and sends fraud headers
    - Empty 2xx bodies resolve without throwing, and the existing VAT client tests still pass
    - Tests use a fake fetch and no live network
    - npm run typecheck and npm test pass
  - Commit: (none — no code change for this task)

- [x] **Task 3: Confirm and submit logic for the Income Tax quarterly update** (after 1, 2)
  - Intent: Create api/_lib/itsSubmit.ts, modelled on vatSubmit.ts and vatReturns.ts, with an injectable store (database default). Every query filters by the session userId and has LIMIT 1. The pieces are:
  - Commit: `afc2efee45ea`
(a) `confirmItsUpdateForUser`. It requires the declaration flag and reuses the preview gates (ITSA enabled, sandbox/live agreement between env and user opt-in, connected, business id, NINO). It recomputes the body with getTaxYearSummary and buildCumulativePeriodSummary. It then upserts a `confirmed` row holding the payload and writes an audit event in the same transaction. It refuses if the row is already pending or submitted.
(b) `submitItsUpdateForUser`. It requires a confirmed row (else NOT_CONFIRMED). It recomputes and deep-compares with the stored payload (else STALE_CONFIRMATION). It then claims the lock with an atomic conditional update from confirmed to pending (else ALREADY_SUBMITTED). It calls the client with fraud headers via requestFraudHeaders. No network call happens inside a DB transaction.
(c) Outcome handling: success records the receipt and marks the row submitted. A definite 4xx rejection marks it rejected, which releases the lock and requires re-confirmation. A 5xx, network failure or failure to save the receipt leaves the row pending and returns OUTCOME_UNKNOWN.
(d) Audit events carry request, response and headers, never the token or the Authorization header.
Reuse hmrcCall.ts, hmrcStore.ts, withHmrcToken and the refresh pattern from vatSubmit.ts. Do not copy-paste; extract only what is genuinely shared. Add itsSubmit.test.ts with a fake store and a fake fetch covering: no submit without confirmation; stale confirmation refused; a second submit refused; rejection releases the lock; unknown outcome keeps the lock; the audit snapshot contains no token; live-mode mismatch refused; and another user's row not reachable.
  - Files: `api/_lib/itsSubmit.ts`, `api/_lib/__tests__/itsSubmit.test.ts`, `api/_lib/hmrcCall.ts`
  - Acceptance criteria the planner set:
    - Tests exist for: no submit without confirmation; stale confirmation refused; second submit for the same period refused; rejection releases the lock; unknown outcome does not
    - Live submission needs both HMRC_SANDBOX_MODE=false and the user's opt-in, and any disagreement is refused
    - Audit rows contain request, response and fraud headers and no bearer token
    - No query uses a client-supplied user id and each has an explicit limit
    - npm run lint, npm run typecheck and npm test pass
  - Risk: Financial submission, idempotency lock, authorisation and live-mode gating, so opus at high. A wrong lock release could double-file with HMRC.

- [x] **Task 4: Add confirm and submit API routes with route tests** (after 3)
  - Intent: Add api/hmrc/its-cumulative-confirm.ts (POST body `{taxYear, quarter, declaration: true}`, strict zod schema reusing itsCumulativePreviewSchema) and api/hmrc/its-cumulative-submit.ts (POST `{taxYear, quarter, confirm: true}`). Both use withAuth and take the user id only from the session. Map ItsSubmitError and HmrcError to codes without leaking HMRC messages, as api/vat/submit.ts does. Reuse the existing ponytail note rather than adding a rate limiter. Add both routes to docs/security/input-inventory.md, which inputInventory.test.ts enforces. Add route tests for the 400/401/405 paths, a missing declaration, and a second user's confirmation not being usable.
  - Files: `api/hmrc/its-cumulative-confirm.ts`, `api/hmrc/its-cumulative-submit.ts`, `api/_lib/__tests__/itsSubmitRoute.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Unauthenticated calls are 401 and non-POST calls are 405
    - Bodies with extra keys or a missing declaration/confirm are 400
    - The input-inventory test passes with both new routes listed
    - npm run lint, npm run typecheck, npm test and npm run build pass
  - Commit: (none — no code change for this task)

- [ ] **Task 5: Sandbox integration test (skipped without credentials) and workflow docs** (after 3)
  - Intent: Add a describe.skipIf block to src/lib/hmrc/sandbox.integration.test.ts for the cumulative PUT, running only when HMRC_CLIENT_ID, HMRC_SANDBOX_NINO and the refresh token are set (the existing hasCredentials pattern), sandbox only. Check the endpoint, version and field names against the HMRC docs where reachable. Update docs/workflows/its-quarterly-update.md with the confirm and submit flow, the status and lock lifecycle, the OUTCOME_UNKNOWN recovery, and the sandbox/live gating. Keep the NINO mask and business id examples in sync with the code.
  - Files: `src/lib/hmrc/sandbox.integration.test.ts`, `docs/workflows/its-quarterly-update.md`
  - Acceptance criteria the planner set:
    - The integration test is skipped, not failed, when credentials are absent
    - The suite never reaches production when HMRC_SANDBOX_MODE is false
    - The workflow doc describes confirm, submit, lock release on rejection and the unknown-outcome rule
    - npm test and npm run lint pass
