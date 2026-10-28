# STF-99: Retrospective UI check with design skills: VAT and tax screens merged since 14 Oct

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

- The app is light-only: src/styles/index.css defines no dark tokens, so dark screenshots are not applicable
- The design tokens are the Tailwind palette plus the CSS variables in index.css, with min-h-11 as the 44px convention
- Mock-mode Playwright (JOURNEY_MOCK=1) can render all seven screens without Docker or a live HMRC connection
- The Skill tool in the implementer session can load the three named design skills; if it cannot, the implementer reports that and stops

## Out of scope

- Dark theme
- Layout restructuring, moving sections, new features, or changes to data, behaviour or routes
- Screens other than the seven listed, apart from shared files they require

## User journey

Starts at: Signed-in owner opens the main nav

1. VAT page with preview panel, history and obligations (`src/pages/VatPage.tsx`)
   - Before: Visual and copy defects not yet audited
   - After: Same layout, with token, contrast, hit-target and copy fixes
2. Tax page and Income Tax obligations (`src/pages/TaxPage.tsx`)
   - Before: Visual and copy defects not yet audited
   - After: Same layout, with fixes
3. Tax identifiers in Settings (`src/pages/TaxIdentifiersSection.tsx`)
   - Before: Visual and copy defects not yet audited
   - After: Same layout, with fixes

## Tasks

- [x] **Task 1: Invoke design skills, capture BEFORE screenshots and write the defect list**
  - Intent: Invoke ui-ux-pro-max:ui-ux-pro-max, ui-styling:ui-styling and taste-skill:taste-skill before looking at any screen. Run the app against the mock API (JOURNEY_MOCK=1, existing e2e/mockApi.ts and the captureEvidence helper in e2e/journey.spec.ts, which already saves 1440 and 390 full-page shots). Capture VAT page, VAT preview panel, VAT history, VAT obligations, Tax page, Income Tax obligations and Tax identifiers (Settings) at 1440 and 390, including the loading, empty, error and not-connected states the mock can produce. Save them to browser-evidence/STF-99/before/. The app ships light only (src/styles/index.css has no dark tokens), so dark is recorded as not applicable. Audit each screen against: spacing rhythm, type scale, contrast, focus ring (index.css), 44px hit targets at 390, truncation/overflow (/), empty/loading/error states (), money alignment (), and copy. Write the numbered defect list, and the separate 'Proposed, not done' list for anything that needs a layout, feature, data or route change, to browser-evidence/STF-99/AUDIT.md. Also check git log for any other STF-3..98 ticket that touched these files. No source edits.
  - Files: `browser-evidence/STF-99/before/`, `browser-evidence/STF-99/AUDIT.md`
  - Acceptance criteria the planner set:
    - The three named skills were invoked before any screenshot was inspected
    - 14 before screenshots exist (7 screens x 1440/390) under browser-evidence/STF-99/before/, and none contain real data
    - AUDIT.md lists each defect with file, screen and viewport, plus a 'Proposed, not done' section
    - No file under src/ or api/ is modified
  - Commit: (none — no code change for this task)

- [x] **Task 2: Fix VAT screen defects in place (page, preview panel, history, obligations)** (after 1)
  - Intent: Fix the VAT-side defects from AUDIT.md in VatPage.tsx, VatPreviewPanel.tsx, VatHistoryList.tsx and VatObligationsList.tsx. Known candidates to check: raw pixel sizes such as min-h-[44px] versus the min-h-11 used elsewhere, text-gray-500 on white for small text, red-700 versus red-800 inconsistency (VatObligationsList uses text-red-700 and blue-700, siblings use 800), max-w-3xl set on a table, and copy that is not plain. Run every changed visible string through humanize:humanize. Do not move sections or change behaviour, data, routes or the layout. Update the matching *.test.tsx only where a changed string or class is asserted.
  - Files: `src/pages/VatPage.tsx`, `src/pages/VatPreviewPanel.tsx`, `src/pages/VatHistoryList.tsx`, `src/pages/VatObligationsList.tsx`, `src/pages/VatPage.test.tsx`, `src/pages/VatPreviewPanel.test.tsx`, `src/pages/VatHistoryList.test.tsx`, `src/pages/VatObligationsList.test.tsx`
  - Acceptance criteria the planner set:
    - Every VAT item in AUDIT.md is fixed, or moved to 'Proposed, not done' with a reason
    - Money amounts stay integer pence and go through formatPence
    - npm run lint, typecheck and test pass
    - The diff contains no layout restructuring and no behaviour change
  - Commit: `ed29914731dc`

- [x] **Task 3: Fix Tax page, Income Tax obligations and Tax identifiers defects in place** (after 1)
  - Intent: Fix the tax-side defects from AUDIT.md in TaxPage.tsx, ItsObligationsSection.tsx and TaxIdentifiersSection.tsx. Known candidates to check: the heading style of the h1 'Tax Estimate' and other titles, whether the main wrapper uses the shared page container (), the 'Next due' badge contrast and its dependence on the colour of the row, input field sizes at 390, and the sentence-case, plain wording of strings. Run every changed visible string through humanize:humanize. Keep behaviour and layout unchanged. Update the matching tests only where an asserted string or class changes.
  - Files: `src/pages/TaxPage.tsx`, `src/pages/ItsObligationsSection.tsx`, `src/pages/TaxIdentifiersSection.tsx`, `src/pages/TaxPage.test.tsx`, `src/pages/ItsObligationsSection.test.tsx`, `src/pages/TaxIdentifiersSection.test.tsx`
  - Acceptance criteria the planner set:
    - Every tax item in AUDIT.md is fixed, or moved to 'Proposed, not done' with a reason
    - NINO and UTR remain masked and nothing sensitive is logged or shown
    - Tax band values stay in src/lib/taxBands.ts and no computation is changed
    - npm run lint, typecheck and test pass
  - Commit: `b1f2393610a8`

- [x] **Task 4: Capture AFTER screenshots and finish PR evidence notes** (after 2, 3)
  - Intent: Re-run the same capture as task 1 into browser-evidence/STF-99/after/ for every screen changed, at 1440 and 390, then run the full checks (npm run lint, typecheck, test, build). Complete AUDIT.md: per fix, say which skill drove it (ui-ux-pro-max, ui-styling or taste-skill), and keep the 'Proposed, not done' list with before-screenshot references. This is the source for the PR body.
  - Files: `browser-evidence/STF-99/after/`, `browser-evidence/STF-99/AUDIT.md`
  - Acceptance criteria the planner set:
    - A before and an after screenshot exist at 1440 and 390 for every changed screen
    - Screenshots show only invented mock records
    - lint, typecheck, test and build all pass
    - AUDIT.md names the driving skill for each change
  - Commit: `e30dd0ae18ab`

- [x] **Task 5: Fix: address 20 review findings (cycle 1)** (after 4)
  - Intent: Review left 20 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Correctness lens. The code diff is small and safe: Tailwind class and copy edits, one role change, and one test-clock fix. The orchestrator's validation passed, and I foun The agent is fixing them; nothing is needed from you.
  - Commit: `80308e2dbd7c`

- [x] **Task 6: Fix: address 18 review findings (cycle 2)** (after 5)
  - Intent: Review left 18 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The code fixes the cycle-1 problems, but the after screenshots were not recaptured and still show the old behaviour. The commit 80308e2 code adds the stale-notice full sto The agent is fixing them; nothing is needed from you.
  - Commit: `be5d71a8d944`
