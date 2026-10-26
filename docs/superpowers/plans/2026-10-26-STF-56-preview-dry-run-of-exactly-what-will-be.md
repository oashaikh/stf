# STF-56: Preview (dry run) of exactly what will be sent to HMRC before submitting

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

- Audit events reuse the existing audit_events table (actor_type user, action 'vat_return.previewed'); no migration, so no clash with STF-20's 0004 migration.
- Preview skips the HMRC open-obligations check because it needs an HMRC call; the real submit still enforces it.
- Preview needs a confirmed, non-stale return and a matching HMRC mode, exactly like submit, and refuses with the same codes otherwise.
- The submit confirmation dialog fetches the preview itself when it opens, so it always matches the current server state.
- Amounts shown are the pounds values the server sends in the body; the pence-to-pounds conversion stays in boxesToHmrcPayload.

## Out of scope

- Per-client rate limiting on api routes (existing ponytail note in submit.ts).
- Changing boxesToHmrcPayload or the HMRC payload format.
- VAT history UI and migrations (STF-20).
- Any live HMRC call or sandbox integration test changes.

## Tasks

- [x] **Task 1: Extract the shared submission-preparation step from submitVatReturnForUser**
  - Intent: Pull the code that submit runs before the claim into one function in api/_lib/vatSubmit.ts: requireConfirmedReturn, the user/env mode-match check, credentials and VAT-number checks, buildFraudHeaders, and boxesToHmrcPayload(boxes, periodKey, true). It returns { sandbox, vatNumber, credentials, fraudHeaders, payload }. submitVatReturnForUser calls it, so submit and preview cannot drift (). The obligations check, claimSubmission and token refresh stay in submit only. Behaviour of submit is unchanged; the existing vatSubmit and vatSubmitRoute tests must pass untouched.
  - Files: `api/_lib/vatSubmit.ts`, `api/_lib/__tests__/vatSubmit.test.ts`
  - Acceptance criteria the planner set:
    - submitVatReturnForUser delegates to the new shared function; no duplicated mode, credential or payload code remains
    - Existing vatSubmit.test.ts and vatSubmitRoute.test.ts pass without edits to their assertions
    - npm run typecheck and npm run lint pass
  - Risk: Refactor of the money-filing path; a regression would break real submissions, so high effort and full existing tests as the guard.
  - Commit: `d792b3685ae4`

- [x] **Task 2: Add previewVatReturnForUser with masked endpoint, header list and audit event** (after 1)
  - Intent: New api/_lib/vatPreview.ts exports previewVatReturnForUser({userId, period, request}, deps). It calls the shared prepare function from task 1, then stops: no claimSubmission, no fetch, no token refresh, no obligations check, no DB write except one audit_events insert (actor_type user, action 'vat_return.previewed', resource_type 'vat_return', metadata {periodKey, sandbox}; no body, headers or tokens). The audit write is an injectable dependency defaulting to a db insert into auditEvents (reuse the table; no new migration). Returns { endpoint, body, headers }: endpoint is the method plus the full URL built from the same base URL and path template the client uses for submitVatReturn (reuse or export that from src/lib/hmrc/client.ts rather than retyping it), with the VRN replaced by asterisks except its last 3 digits, and sandbox vs live shown; body is the exact payload object; headers are the fraud headers plus Content-Type/Accept as hmrcFetch sets them, with Authorization listed as 'Bearer (hidden)'. Tests (injected fakes, no network): preview body deep-equals the body the submit sends to a mocked fetch for the same return, including a nil return (all boxes 0); preview calls fetch zero times and claimSubmission zero times; response and console output contain no access or refresh token string; VRN masked; refusals (NOT_CONFIRMED, MODE_MISMATCH, VAT_NUMBER_MISSING) propagate as VatReturnError and write no audit event.
  - Files: `api/_lib/vatPreview.ts`, `api/_lib/__tests__/vatPreview.test.ts`, `src/lib/hmrc/client.ts`
  - Acceptance criteria the planner set:
    - Test proves preview body equals the body submit passes to the mocked HMRC fetch for a normal and a nil return
    - Test proves preview makes zero fetch calls and zero claimSubmission calls
    - Test asserts no token value appears in the returned object, serialised, or in captured console output
    - Authorization header appears only as 'Bearer (hidden)'
    - VRN is masked to its last 3 digits
    - One audit event per successful preview, none on refusal, and its payload has no token or header values
    - npm test, typecheck and lint pass
  - Risk: Handles credentials adjacent to a response and logs; the no-token guarantee is the core security property, so high effort.
  - Commit: `7e6347b21ff0`

- [x] **Task 3: Add POST /api/vat/preview route with auth and ownership tests** (after 2)
  - Intent: New api/vat/preview.ts modelled on api/vat/submit.ts: withAuth, POST only, body validated with periodSchema (no confirm flag needed, nothing is filed), calls previewVatReturnForUser, maps VatReturnError via vatErrorResponse, never logs error messages that could carry tokens. Returns { ok: true, data }. Route test mirrors vatSubmitRoute.test.ts: unauthenticated refused, wrong method 405, bad body 400, a second user cannot preview the first user's period (409 NOT_CONFIRMED, since drafts are scoped by user id), and the response has no token. Add the same ponytail rate-limit note only if it is not already covered by a shared comment.
  - Files: `api/vat/preview.ts`, `api/_lib/__tests__/vatPreviewRoute.test.ts`
  - Acceptance criteria the planner set:
    - Route test covers 401, 405, 400, success shape, and the second-user refusal
    - Response JSON contains no access or refresh token
    - apiRoutes.test.ts still passes (add the new route there if it lists routes)
    - npm test, typecheck and lint pass
  - Risk: New authenticated route reading a user's financial and credential-adjacent data; opus per the auth/permission rule.
  - Commit: `f6c550922ef7`

- [x] **Task 4: Add previewVatReturn client call in vatApi.ts** (after 3)
  - Intent: Add a typed previewVatReturn(token, period, fetchFn) and VatPreview type in src/lib/hmrc/vatApi.ts that POSTs to /api/vat/preview with browserFraudHeaders as submitVatReturn does, and throws SubmitVatError-style errors with the server code. Add unit tests beside the existing vatApi tests. STF-20 also edits vatApi.ts, so keep the addition as one appended block to avoid conflicts.
  - Files: `src/lib/hmrc/vatApi.ts`, `src/lib/hmrc/vatApi.test.ts`
  - Acceptance criteria the planner set:
    - Test: success returns the data object; error body throws with the server code
    - Request carries the Bearer token and no body field other than the period
    - npm test, typecheck and lint pass
  - Commit: `928bb450255e`

- [x] **Task 5: VAT page: Preview button, readable preview panel and preview in the submit dialog, with screenshots** (after 4)
  - Intent: First merge the latest dev/main into the branch (STF-20 is editing VatPage.tsx and vatApi.ts) and resolve conflicts. Add a new component src/pages/VatPreviewPanel.tsx that renders a VatPreview as: endpoint line (sandbox/live, masked VRN), rows of box number, label (reuse boxLabel from vatReviewState) and amount, and header name/value rows, with the raw JSON in a native <details> block. Amounts in the rows are the pounds values from the body, shown with one fixed 2-decimal format, right-aligned in tabular figures; do not do float math, display what the server sent. In VatPage.tsx add a 'Preview what will be sent' button beside Submit (shown only when the return is confirmed and not stale/submitted, min 44px tap target, same shared button styles) that fetches via useMutation and shows the panel with shared loading/error components; the submit confirmation dialog fetches and shows the same panel when it opens. Use existing Tailwind tokens, no raw hex or px font sizes; long header values truncate with a title tooltip; layout must not scroll sideways at 1440 and must stack at 390. Tests in VatPage.test.tsx (backend client mocked): button absent before confirm, present after; clicking shows rows and raw JSON; dialog shows preview; Submit still works; a nil return renders. Capture screenshots at 1440 and 390 px (light; dark if the shell ships it) with invented data only and attach per for the PR.
  - Files: `src/pages/VatPage.tsx`, `src/pages/VatPreviewPanel.tsx`, `src/pages/VatPreviewPanel.test.tsx`, `src/pages/VatPage.test.tsx`, `docs/workflows/vat-return.md`
  - Acceptance criteria the planner set:
    - Branch contains the merged latest dev/main before UI edits start
    - Button appears beside Submit only for a confirmed return
    - Panel shows endpoint, box number/label/amount rows, header rows and a collapsible raw JSON block
    - Same preview appears in the submit confirmation dialog
    - Screenshots at 390 and 1440 px exist for the PR, using invented data
    - npm run lint, typecheck, test and build all pass
  - Risk: Shares VatPage.tsx with STF-20; the new panel file keeps the VatPage hunks small.
  - Commit: `0280e4738fa6`
