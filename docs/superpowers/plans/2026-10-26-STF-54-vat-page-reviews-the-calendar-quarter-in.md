# STF-54: VAT page reviews the calendar quarter instead of the HMRC obligation the user must file

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

- HMRC obligations lookup (getVatObligations with status O, from/to range) returns obligations overlapping period.start..period.end, so an exact periodKey+start+end match is a valid open-obligation check.
- The server check for submit is enough for the 'refuses to submit' criterion; review/draft/confirm endpoints stay period-agnostic.
- The existing /api/vat/obligations endpoint and fetchVatObligations from STF-16 are the source of the open list.
- Table label bug is a markup/spacing issue in VatObligationsList.tsx mobile layout (cells are flex with an unwrapped text node).

## Out of scope

- Server-side open-obligation checks on return/return-confirm endpoints
- Stagger/VAT-period settings
- Obligation history list (STF-20)
- Rate limiting ()

## Tasks

- [x] **Task 1: Server refuses to submit a period that is not an open HMRC obligation**
  - Intent: In submitVatReturnForUser (api/_lib/vatSubmit.ts), after requireConfirmedReturn and the mode/credentials checks but BEFORE claimSubmission, fetch the user's open obligations from HMRC via the existing getVatObligations + withHmrcToken (same token-refresh/saveRefreshedTokens handling as submit; extract one small local helper rather than copying the block; reuse the obligations query shape from api/vat/obligations.ts, status 'O', from=period.start, to=period.end). Throw VatReturnError(409, 'PERIOD_NOT_OPEN', ...) unless an open obligation matches periodKey AND start AND end exactly. An HMRC failure while checking must not claim a submission and must surface as a visible error (no silent catch; no network call inside a DB transaction). Map the new code in api/vat/submit.ts only if it needs anything beyond the existing VatReturnError handling. Update existing vatSubmit.test.ts / vatSubmitRoute.test.ts fetch mocks to route by URL (obligations GET vs submit POST) so they still pass, and add tests: a submit for a period key not among open obligations is refused with PERIOD_NOT_OPEN and no claim/POST to HMRC is made; a matching key with different dates is refused; a fulfilled/absent obligation is refused; the happy path for 26C3 (2026-07-01 to 2026-09-30) still files. Ownership: obligations come from the caller's own HMRC token, so another user's period cannot pass.
  - Files: `api/_lib/vatSubmit.ts`, `api/vat/submit.ts`, `api/_lib/__tests__/vatSubmit.test.ts`, `api/_lib/__tests__/vatSubmitRoute.test.ts`
  - Acceptance criteria the planner set:
    - Submit with a period key absent from the user's open obligations returns/throws status 409 code PERIOD_NOT_OPEN and never calls claimSubmission or POSTs a return
    - Same key with mismatched start/end is also refused
    - Valid open obligation (26C3, 2026-07-01 to 2026-09-30) still submits and records a receipt
    - Obligation lookup failure leaves no pending claim
    - npm run lint, typecheck and test pass
  - Risk: Filing path with HMRC tokens and an irreversible action; careful ordering vs claimSubmission matters, so high effort. STF-20 and STF-53 also edit api/_lib/vatSubmit.ts / vatSubmit tests, so expect merge overlap; keep hunks local.
  - Commit: `1e3dc07cae2a`

- [ ] **Task 2: VAT page uses the user-selected open obligation, not today's quarter**
  - Intent: Remove currentQuarter from src/pages/vatReviewState.ts (and its test in vatReviewState.test.ts); nothing on the page may derive a period from new Date(). In VatPage.tsx, load obligations with the existing fetchVatObligations (reuse the ['vat-obligations'] query so VatObligationsList does not double fetch, e.g. lift the query or share one hook), keep only status 'O', and hold a selectedPeriodKey state. One open obligation is selected by default; several require the user to pick (render selection controls with 44px tap targets, accessible names, using existing Tailwind tokens as the page does); none shows a clear 'no open VAT obligations' message and renders no review, draft, confirm or submit UI and makes no /api/vat/return call (gate the useQuery with enabled). The selected obligation's periodKey/start/end feed the queryKey, GET /api/vat/return, PUT draft, confirm, submit and the page subtitle. Changing the selection resets declarationTicked, submit/confirm mutation state and any open dialog. Handle NotConnected/VatNumberMissing/error states with the existing messages. Tests (new src/pages/VatPage.test.tsx, mock useAuth, fetch and the obligations API, per): an open obligation 2026-07-01 to 2026-09-30 key 26C3 with the clock at 2026-10-26 makes the review request carry exactly periodKey=26C3, start=2026-07-01, end=2026-09-30; two obligations require a choice; none offers no review/submit; fulfilled obligations are not selectable.
  - Files: `src/pages/VatPage.tsx`, `src/pages/vatReviewState.ts`, `src/pages/vatReviewState.test.ts`, `src/pages/VatPage.test.tsx`, `src/pages/VatObligationsList.tsx`, `src/lib/hmrc/vatApi.ts`
  - Acceptance criteria the planner set:
    - grep finds no currentQuarter or new Date() period derivation under src/pages
    - Test with one open July-September obligation asserts the review fetch URL uses 26C3 / 2026-07-01 / 2026-09-30
    - Single open obligation is preselected; none shows the empty message with no confirm/submit controls
    - Draft, confirm and submit calls all use the selected obligation's key and dates
    - npm run lint, typecheck, test pass
  - Risk: STF-20 also edits VatPage.tsx, vatReviewState.ts and vatApi.ts; keep edits localised to reduce merge conflicts.

- [ ] **Task 3: Fix nil-return text and phone-width obligations table labels** (after 2)
  - Intent: (a) In VatPage.tsx the line 'This is a nil return and still needs confirming' must only show while the return is unconfirmed and unsubmitted: after confirming (status confirmed and not stale) or once a submission receipt exists, show only the 'no VAT-relevant transactions' part (or a neutral line). Prefer driving this from reviewState in vatReviewState.ts (e.g. a field) so it is unit tested; extend vatReviewState.test.ts. (b) In VatObligationsList.tsx fix the mobile card rows so label and value never run together ('Period key26C3', 'StatusDue'): investigate why the flex td rows collapse (cells are display:flex with a bare text node as value; wrap each value in its own span and add an explicit gap/min-w so text content and layout separate), and add a VatObligationsList.test.tsx assertion that each label and value are separate elements.
  - Files: `src/pages/VatPage.tsx`, `src/pages/vatReviewState.ts`, `src/pages/vatReviewState.test.ts`, `src/pages/VatObligationsList.tsx`, `src/pages/VatObligationsList.test.tsx`
  - Acceptance criteria the planner set:
    - Nil-return confirmation sentence is absent when status is confirmed (not stale) and when a submission exists, present when draft/unreviewed
    - Obligations table label and value render in separate elements with visible spacing at 390 px
    - New tests fail on the old code
    - npm run lint, typecheck, test pass

- [ ] **Task 4: Screenshots at 390 and 1440 px, docs, and full check run** (after 1, 3)
  - Intent: Update docs/workflows/vat-return.md to say the period comes from the selected open HMRC obligation and the server rejects non-open periods. Run the app with HMRC stubbed (open obligation 26C3, 1 Jul to 30 Sep 2026, due 7 Nov) and capture VAT page screenshots at 390 and 1440 px (obligation selected review, no-obligations state, obligations table on phone) for the PR using invented data only; keep them out of committed repo files unless the repo already stores such artefacts. Run npm run lint, typecheck, test, build.
  - Files: `docs/workflows/vat-return.md`
  - Acceptance criteria the planner set:
    - Docs describe obligation-driven period and server check
    - Screenshots at 390 and 1440 px exist for the PR
    - lint, typecheck, test and build all pass
  - Risk: STF-20 also edits docs/workflows/vat-return.md; small additive edit only.
