# STF-111: Meet HMRC's minimum functionality standards for Making Tax Digital for Income Tax, and produce the sandbox test evidence

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

- STF-30, STF-109 and STF-110 have merged or will merge before this ticket releases; the plan avoids their files except small appended hunks in client.ts.
- The agent has no sandbox credentials, so the actual dated evidence note must be produced by the owner or operator running the script.
- Self-employment annual, property annual, final declaration and calculation calls already exist in client.ts; if one is missing at implementation time, task 2 adds it.
- HMRC's create-test-user API uses an application token, which getApplicationToken already provides.

## Out of scope

- Any change to how VAT returns are built, previewed or submitted
- Sending the approval email, or switching to production credentials or live submission
- Limited company accounting or Companies House
- Editing sandbox.integration.test.ts or hmrc-sandbox-integration.md (STF-110 owns them)

## Tasks

- [x] **Task 1: Audit STF against HMRC's MTD Income Tax minimum functionality standards**
  - Intent: Fetch HMRC's current minimum functionality standards for MTD Income Tax from the Developer Hub service guide (WebFetch). Write docs/hmrc/mtd-itsa-minimum-functionality.md with one row per standard: the requirement, where STF meets it (file or screen), or a gap. Scope is a sole trader with self-employment and UK property income. Record each gap with a size estimate. State plainly that the VAT filing code is frozen and no standard is met by changing it. If the page cannot be fetched, stop and say so in the doc rather than guessing.
  - Files: `docs/hmrc/mtd-itsa-minimum-functionality.md`
  - Acceptance criteria the planner set:
    - Every standard on HMRC's current page has a row, with the page URL and the date it was read
    - Each row is either 'met' with a real path that exists in the repo, or 'gap' with a one-line fix
    - A closing section lists the gaps tasks 2 and 3 will build and the gaps left for the owner
    - No source file under src, api or server is changed
  - Risk: Standards text comes from a live web page. Quote only what was read, and mark anything unverified.
  - Commit: (none — no code change for this task)

- [x] **Task 2: Build the gaps the audit found in the HMRC client and API routes** (after 1)
  - Intent: Implement the backend gaps task 1 listed, using existing client.ts patterns (fraud headers on every call, integer pence, sandbox guard). Do not touch VAT code (vatApi, vatSubmit, vatPreview, vatReturns). STF-110 edits client.ts, so keep to small appended exports and rebase before finishing. Every new call gets a test with a fake fetch. If the audit finds no backend gap, record that in the audit doc and finish with only that doc edit.
  - Files: `src/lib/hmrc/client.ts`, `src/lib/hmrc/client.test.ts`, `docs/hmrc/mtd-itsa-minimum-functionality.md`
  - Acceptance criteria the planner set:
    - Each backend gap in the audit is now 'met' with a path, or deferred to the owner with a reason
    - New HMRC calls send fraud prevention headers and have unit tests with a faked fetch
    - No VAT file is modified
    - npm run lint, typecheck and test pass
  - Risk: client.ts is shared with STF-110, so hunks must stay small and non-overlapping.
  - Commit: (none — no code change for this task)

- [x] **Task 3: Build any user-facing gaps, following the ease-of-use spec** (after 1)
  - Files: `docs/hmrc/mtd-itsa-minimum-functionality.md`, `docs/screenshots/`
  - Acceptance criteria the planner set:
    - Each user-facing gap is met, or has a ticket-conversation question recorded in the audit doc
    - Changed screens use shared page container, loading, empty and error components
    - Screenshots exist for each changed screen
    - VAT screens are unchanged
  - Risk: Screen files are unknown until task 1; the implementer must add them here and stay clear of YearEndFlow.tsx and FinalDeclarationFlow.tsx (STF-110).
  - Commit: `a862819b09cd`

- [x] **Task 4: Scripted, repeatable end-to-end HMRC sandbox evidence run** (after 2)
  - Intent: Add scripts/hmrcSandboxEvidence.ts run via a new npm script hmrc:evidence. It (1) refuses to run unless HMRC_SANDBOX_MODE is not 'false' and the base is test-api; (2) creates HMRC test users via the Create Test User API: an organisation with VAT (MTD) and an individual with MTD Income Tax, self-employment and UK property; (3) calls every endpoint STF uses through client.ts: VAT obligations, return submission and retrieval, ITS business details, obligations, self-employment and property cumulative updates, annual submissions, tax calculation trigger and get, final declaration; (4) validates fraud prevention headers against HMRC's test validator; (5) writes docs/hmrc/evidence/hmrc-sandbox-run-<date>.md with run date, test user ids (no passwords, tokens or full NINO), endpoints and results. Put pure step list and note rendering in src/lib/hmrc/evidenceRun.ts with unit tests on a faked fetch. The OAuth grant is a browser step, so with no refresh token the script prints instructions and exits non-zero. VAT functions are called read-only/as-is, not changed.
  - Files: `scripts/hmrcSandboxEvidence.ts`, `src/lib/hmrc/evidenceRun.ts`, `src/lib/hmrc/evidenceRun.test.ts`, `package.json`, `package-lock.json`, `.env.example`, `src/lib/__tests__/envExample.test.ts`
  - Acceptance criteria the planner set:
    - npm run hmrc:evidence refuses to run against live mode
    - With a faked fetch, a test shows every STF endpoint is called and the rendered note lists each with pass or fail
    - A failed step shows as failed in the note and gives a non-zero exit
    - The note and logs contain no secrets, tokens, passwords or full NINO
    - Any new env var is in .env.example and envExample.test.ts passes
    - No new dependency
    - npm run lint, typecheck, test and build pass
  - Risk: Handles HMRC credentials and tokens, so opus at high. Network calls must be faked in tests. package.json is a hot file: keep the edit to one script line.
  - Commit: `622f30957fc6`

- [ ] **Task 5: Runbook for the evidence run and the owner's approval email** (after 4)
  - Intent: Write docs/runbooks/hmrc-evidence-run.md: prerequisites, exact order (rerun inside the 2-week window HMRC checks logs after the approval email), how to authorise the test individual and organisation, how to read the evidence note, and a template of what the owner quotes in the email. Link it from the audit doc. Do not edit hmrc-sandbox-integration.md (STF-110). State plainly that the agent run has not produced a real evidence note, unless it has.
  - Files: `docs/runbooks/hmrc-evidence-run.md`, `docs/hmrc/mtd-itsa-minimum-functionality.md`
  - Acceptance criteria the planner set:
    - Steps are numbered, at most five per list
    - No secrets, personal data or machine paths
    - The runbook links the audit doc and the script by name
  - Risk: Documentation only.
