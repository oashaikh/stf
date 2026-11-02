# STF-121: File a VAT return as a guided step-by-step flow

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

- Step position for Save and leave is held client-side (localStorage per period key); the ticket forbids server changes.
- Flow stays at /vat in VatPage.tsx; past returns stay listed as today. Tax page grouping belongs to STF-119.
- No bank-payment or unsorted data source exists (api/bank only has connect, callback, disconnect, status), so the 'unsorted payments' stop is not built.
- Dark screenshots depend on whether the app ships a dark theme.
- The jargon test is owned by STF-120.

## Out of scope

- Any change to api/, server/ or src/lib/hmrc
- Home to-do list, six-item menu, Tax page restructure (STF-119, STF-120)
- Sorting-payments flow and bank transaction ingestion
- Other filing flows
- Live HMRC submission

## User journey

Starts at: Tax page or dashboard VAT reminder, then /vat

1. Pick the return due (skipped when only one open) (`src/pages/VatFlow.tsx`)
   - Before: Radio list headed 'Choose the obligation to file' above a page of controls
   - After: One question per screen with Step N of M, Test mode label, Back and Save and leave
2. Problems that stop the flow (`src/pages/VatFlow.tsx`)
   - Before: Plain paragraphs or an error message
   - After: Plain sentence with the fix beside it
3. Your figures (`src/pages/VatFigures.tsx`)
   - Before: Table of boxes 1 to 9 with official labels
   - After: Plain-word amounts, Box N in small muted text, Why is this amount? link
4. Check and send (`src/pages/VatFlow.tsx`)
   - Before: Declaration, Confirm, Submit and Preview on one page
   - After: One-sentence summary, declaration, Send to HMRC with confirm dialog and Test mode label

Also depends on:
- STF-119 and STF-120 edit nearby files but this flow does not need them

## Tasks

- [x] **Task 1: Add step-flow helpers: plain wording, sentence builder, resume storage**
  - Intent: Create a small pure module for the guided VAT flow: ordered step list, a function building the final plain sentence from signed Box 5 pence and the period (owe, refund, nil variants), plain-word box labels with the box number kept as separate small text, and get/set of the last step per period key in localStorage (client only). Reuse formatPence/formatDate and existing BOX_LABELS/box5 helpers; add plain label fields beside them without rewriting reviewState.
  - Files: `src/pages/vatFlowState.ts`, `src/pages/vatFlowState.test.ts`, `src/pages/vatReviewState.ts`, `src/pages/vatReviewState.test.ts`
  - Acceptance criteria the planner set:
    - Sentence builder covers owe, refund and nil using integer pence, each tested
    - Month range wording is correct for a quarter like 1 Aug to 31 Oct 2026
    - Saved step round-trips per period key and ignores invalid stored values
    - reviewState output and existing tests unchanged
    - typecheck, lint, test pass
  - Commit: `41524354e28c`

- [x] **Task 2: Build the guided flow shell with the return-due step and early-stop problems** (after 1)
  - Intent: Restructure VatPage.tsx so the review is a step flow with 'Step N of M', Back and 'Save and leave' (stores step, returns to Tax, resumes next visit). Step 1 picks the return due, skipped when only one is open. Problems stop the flow early in plain words with the fix beside them: HMRC not connected, VAT number missing, stale ledger, nothing due. Keep callApi, draft-save effect, confirm/submit mutations and period keying unchanged. Put new step UI in VatFlow.tsx. Past returns stay listed. No changes under api/ or src/lib/hmrc.
  - Files: `src/pages/VatPage.tsx`, `src/pages/VatFlow.tsx`, `src/pages/VatPage.test.tsx`
  - Acceptance criteria the planner set:
    - Every step shows Step N of M, Back, Save and leave, all at least 44px tall
    - Save and leave then reopening resumes the step
    - Single open return skips the pick step; several require a choice
    - Not connected, VAT number missing and stale stop the flow with plain text and a fix link; no 'obligation' or 'ledger' text
    - Test mode label on every step when not live
    - Server calls unchanged; typecheck, lint, test pass
  - Risk: STF-119 and STF-120 also edit VatPage.tsx; keep its diff narrow by moving UI into VatFlow.tsx.
  - Commit: `b95814578f8c`

- [x] **Task 3: Figures step: plain words, box number in small text, and 'Why is this amount?'** (after 2)
  - Intent: Replace the nine-row box table with a figures step listing each amount in plain words per the spec table, with the box number in small muted text. Drillable boxes (1,3,4,5,6,7) get 'Why is this amount?' revealing the payments behind it, reusing existing drill-down lines, expensesLink and truncation note. Always-zero boxes 2,8,9 are folded into small text. Money right-aligned, tabular, labelled rows at 390px.
  - Files: `src/pages/VatFlow.tsx`, `src/pages/VatFigures.tsx`, `src/pages/VatFigures.test.tsx`, `src/pages/VatPage.test.tsx`
  - Acceptance criteria the planner set:
    - Each amount has plain wording plus Box N in small muted text
    - Why is this amount? expands payments linking to /expenses; empty box says so
    - Truncation note appears when lines < totals
    - No horizontal scroll at 390 or 1440
    - Tests for expand/collapse, empty, truncated, refund; typecheck, lint, test pass
  - Commit: `92f9522a10ca`

- [x] **Task 4: Final step: one-sentence summary, declaration and Send to HMRC** (after 3)
  - Intent: Build the last step: plain sentence, key figures, declaration checkbox, 'Send to HMRC' button. Keep the gate exactly: declaration enables confirm (period lock), stale needs re-confirm, reviewState.canSubmit alone enables sending, confirm dialog with preview stays (reworded plain). Test mode labelled on step and dialog. Receipt, unknown-outcome warning and filed lock stay in plain words. Raw preview behind a small disclosure. Do not alter reviewState logic, only labels.
  - Files: `src/pages/VatFlow.tsx`, `src/pages/VatPage.tsx`, `src/pages/VatPreviewPanel.tsx`, `src/pages/VatPreviewPanel.test.tsx`, `src/pages/VatPage.test.tsx`
  - Acceptance criteria the planner set:
    - Sentence matches figures for owe, refund, nil
    - Send disabled until confirmed, fresh, unfiled, outcome known
    - submitVatReturn not called before dialog confirm (tested)
    - Sandbox label on final step and dialog; live says it cannot be undone
    - Receipt and warning render in plain words
    - No change under api/ or src/lib/hmrc; typecheck, lint, test pass
  - Risk: Touches the submission gate UI; Opus high because a mistake could weaken the confirm-before-send safeguard.
  - Commit: `5ed12387d9b9`

- [x] **Task 5: Keep e2e journey green; update VAT workflow doc** (after 4)
  - Intent: Update e2e/journey.spec.ts VAT steps and e2e/mockApi.ts only as far as the new screens require. Ensure vat-obligations query mocks always return defined data. Update docs/workflows/vat-return.md. Do not edit jargonRender.test.tsx (STF-120).
  - Files: `e2e/journey.spec.ts`, `e2e/mockApi.ts`, `docs/workflows/vat-return.md`, `src/pages/VatPage.test.tsx`
  - Acceptance criteria the planner set:
    - Mocked e2e walks the new flow to the send dialog
    - Doc matches the new step order
    - lint, typecheck, test, build pass
  - Risk: e2e files also in STF-119 plan; keep hunks narrow.
  - Commit: `2e589926b00c`

- [x] **Task 6: Capture first-time-user evidence, captions and review notes** (after 5)
  - Intent: Run the app in sandbox mode with invented figures and walk the flow as a new user at 1440 and 390, light and dark, committing images to browser-evidence/STF-121/ with captions.md giving each a plain-English title, plus notes on where screens differ from the spec and why.
  - Files: `browser-evidence/STF-121/captions.md`, `browser-evidence/STF-121/`
  - Acceptance criteria the planner set:
    - Images for every step at 1440 and 390, light and dark (dark noted if not shipped)
    - Every image captioned
    - Deviations from the spec listed with reasons
    - No real data or paths
  - Commit: `ea63865a70f6`

- [x] **Task 7: Fix: address 14 review findings (cycle 1)** (after 6)
  - Intent: Review left 14 findings unresolved (NEEDS_WORK): **correctness** — APPROVED The correctness lens found nothing blocking. I traced the step state (saved step, override, single versus multiple returns, Back, Save and leave) and the submission gate. Th The agent is fixing them; nothing is needed from you.
  - Commit: `278a2deb6edf`
