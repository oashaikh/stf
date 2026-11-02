# STF-37: AI category suggestions for bank lines (drafts only)

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

- STF-38 (bank reconciliation, BankSortSection, confirm-to-draft path) and STF-7 (Anthropic client, model-id variable, kill switch, docs/agents/) land before this ticket is implemented. Neither is in this worktree, so the plan cannot name their exact symbols and env var names.
- The ticket's 'accepting creates a draft entry via STF-38' means calling STF-38's existing confirm route, not writing a new entry path.
- Only the line description, amount and date, plus the owner's account names and codes, are sent to Anthropic. No payee account numbers or other personal fields are sent.
- Migration 0026 is free. 0025 is reserved by STF-38 and 0022 by STF-74, so the implementer re-checks against the base branch.

## Out of scope

- Automatic or scheduled categorisation; the owner triggers it
- Learning from the owner's corrections, or the 'same for all from this payee' rule (STF-38)
- Receipt extraction changes (STF-7)
- Posting anything to the ledger without owner confirmation
- Supplying the Anthropic API key (owner provides it)

## User journey

Starts at: Home to-do list item 'Sort N bank payments'

1. Home to-do list (`src/lib/homeTodos.ts`)
   - Before: Shows 'Sort N bank payments'
   - After: Unchanged
   - Depends on: STF-122 (merged)
2. Bank page, Sort bank payments (`src/pages/BankSortSection.tsx`)
   - Before: Each payment is sorted by hand, one at a time
   - After: A 'Suggest categories' button fills in a plain-words suggested category on each payment. One tap accepts it into a draft entry, or the owner picks another.
   - Depends on: STF-38

Also depends on:
- STF-38
- STF-7
- STF-36

## Tasks

- [x] **Task 1: Write the bank-line categorisation agent procedure**
  - Intent: Add docs/agents/bank-categorisation.md before any code. Cover: what it reads (unmatched line descriptions, amounts and dates, plus the owner's account list names and codes only), what it writes (suggested account id and confidence on the bank line, never a ledger row), the trigger (owner taps 'Suggest' in Sort bank payments, nothing automatic), what the owner sees (plain-words suggestion with one-tap confirm), the audit event, the kill switch and model-id variables (the same ones STF-7 defines), the data sent to Anthropic, and the fallback when the call fails (manual sorting). Add the new route to the route index and inputs table in docs/security/input-inventory.md. STF-7 may create docs/agents/ and its own SOP; this task adds only the new file and must not recreate STF-7's.
  - Files: `docs/agents/bank-categorisation.md`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - docs/agents/bank-categorisation.md names reads, writes, trigger, what the owner sees, audit event, kill switch and fallback
    - The doc states nothing is posted to the ledger and the owner must confirm each suggestion
    - The doc names the exact env var names for the model id and kill switch as STF-7 defines them, or notes they are to be read from STF-7's merged code
    - input-inventory.md has a row for the new route, with the enforcing file
  - Risk: STF-7 is unmerged in this worktree, so the env var names are not visible here. The implementer must check the base branch for them and reuse them rather than invent new ones.
  - Commit: (none — no code change for this task)

- [x] **Task 2: Store category suggestions on bank lines (schema and migration)** (after 1)
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0032_bank_suggestions.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0026_snapshot.json`
  - Acceptance criteria the planner set:
    - Both new columns are nullable, with no default that looks like a decision
    - Confidence is an integer with a 0-100 check
    - The journal has one head and a unique version prefix
    - The migration adds no grants beyond what the existing table has, or states why none are needed
    - Schema test covers the new columns
    - npm run typecheck and npm test pass
  - Risk: Schema and migration work, so opus at high. Merge conflict risk with STF-38 and STF-74 on schema.ts and the journal.
  - Commit: `909a56ab84a3`

- [x] **Task 3: Suggestion service and route with a fake-client test** (after 1, 2)
  - Intent: Add api/_lib/bankCategorise.ts and api/bank/categorise.ts, behind withAuth. The route takes a bounded batch of the owner's unmatched bank line ids. The server loads descriptions and the owner's account list scoped to the session user, never trusting the client for descriptions. It checks the STF-7 kill switch first; when off it makes no call and returns a clear 'suggestions are off' result. It calls the Anthropic client STF-7 added (reuse it, add no dependency) with the model id from STF-7's env variable. It validates the model reply with zod, accepts only account ids that belong to the owner, clamps confidence to an integer, writes only the two suggestion columns, and does not touch status or the ledger. No network call while a transaction is open (). It logs an internal id and an audit event with no description text. It has a rate limit and a batch cap. Tests use a fake client: suggestions stored as drafts only, kill switch off means zero calls, an unknown account id is dropped, another user's line id is refused, and a failed call leaves lines unchanged and visible as an error.
  - Files: `api/_lib/bankCategorise.ts`, `api/bank/categorise.ts`, `api/_lib/bankStore.ts`, `api/_lib/__tests__/bankCategorise.test.ts`, `api/_lib/__tests__/bankCategoriseRoute.test.ts`, `api/_lib/__tests__/apiRoutes.test.ts`, `api/_lib/__tests__/maliciousInputRoutes.test.ts`, `vercel.json`, `docs/security/input-inventory.md`, `.env.example`
  - Acceptance criteria the planner set:
    - With the kill switch off the fake client records zero calls
    - Stored rows get only suggested account and confidence; status and ledger tables are unchanged
    - Account ids not in the owner's list are discarded
    - A second user sending the first user's line id is refused
    - The batch size is capped and the query is bounded and indexed
    - `.env.example` is touched only if STF-7 has not already added the kill switch and model variables
    - npm run lint, typecheck and test pass
  - Risk: Opus at high: sends personal bank text to a third party, with an owner-scoped data and permission boundary. Depends on STF-7 for the client, model variable and kill switch; if they are not on the base branch the implementer must stop and ask. Overlaps STF-38 and STF-7 on apiRoutes.test.ts, input-inventory.md and .env.example.
  - Commit: `be7cc0e2d3f8`

- [x] **Task 4: Show suggestions in Sort bank payments and accept as a draft** (after 3)
  - Intent: Add src/lib/bankCategoriseApi.ts as the client for the new route. In the STF-38 Sort bank payments view (BankSortSection), show the suggested category in plain words, e.g. 'Looks like Office costs', with confidence as a small muted note and the official account name in small muted text. Add a 'Suggest categories' button. When off or failed, show the fix beside the message and keep manual sorting working. Accepting calls STF-38's existing confirm path, which creates a draft entry; the owner can pick a different category. No suggestion is applied without a tap. Follow docs/design/ease-of-use.md. Use shared loading, empty and error components, 44px tap targets, and money via formatPence. Update the jargon render test. Provide screenshots at 1440 and 390 px.
  - Files: `src/lib/bankCategoriseApi.ts`, `src/lib/bankReconcileApi.ts`, `src/pages/BankSortSection.tsx`, `src/pages/BankSortSection.test.tsx`, `src/pages/__tests__/jargonRender.test.tsx`, `e2e/mockApi.ts`, `e2e/bank-categorise.spec.ts`, `browser-evidence/STF-37/captions.md`
  - Acceptance criteria the planner set:
    - A suggestion shows in plain words with the official name only in small muted text
    - Accepting creates a draft through STF-38's path and nothing is posted automatically
    - A kill-switch-off or failed response shows a message and a manual way forward
    - The jargon test passes
    - Component tests mock the API client
    - Screenshots at 1440 and 390 px are included
    - npm run lint, typecheck, test and build pass
  - Risk: Hard dependency: STF-38 must be merged so BankSortSection and its confirm path exist; this worktree does not have them. Heavy file overlap with STF-38, so rebase on its merge before starting.
  - Commit: `ad96bdddbbbe`

- [x] **Task 5: Fix: address 10 review findings (cycle 1)** (after 4)
  - Intent: Review left 10 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK The correctness lens found no logic defects, but the required 1440 px and 390 px light screenshots are missing, which forces NEEDS_WORK. Nothing exists under browser-evide The agent is fixing them; nothing is needed from you.
  - Commit: `7c9d392ff8d4`
