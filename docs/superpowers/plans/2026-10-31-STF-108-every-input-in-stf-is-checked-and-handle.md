# STF-108: Every input in STF is checked and handled safely

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

- The API is Request/Response handlers with zod already used in most _lib modules; the hand-written validators in accounts, mileage, auth and hmrc routes are the likely gaps, to be confirmed by task 1.
- Single-owner app: no webhook endpoints, imported files or rich text appear to exist. Task 1 confirms with grep and records them as absent.
- Row-level security is not used; routes scope every query by session userId, and this ticket does not weaken that.
- Pages render user text through React JSX only; no layout change is needed.

## Out of scope

- Any layout or visual change (needs its own ticket)
- Building a new upload or webhook feature if none exists
- Dependency upgrades
- Live penetration test or OWASP pass ( release exercise)

## Tasks

- [x] **Task 1: Write the input inventory document**
  - Intent: Create docs/security/input-inventory.md listing every input with its server-side rule and where it is enforced: login password and MFA code; entries body and list query (search, dates, amounts, cursor); invoices and invoice-pdf id; accounts (code, name, type, id); mileage trips; recurring entries; business profile, tax identifiers, VAT number and trading allowance; hmrc mode, callback (code/state) and its-businesses; vat preview/return/submit/return-confirm; export and report query params; cron routes (auth header); trusted headers (cookie, fraud-prevention headers, x-forwarded-for); the receipt/AI prompt path; and uploads. Each row says validated by (zod schema, hand validator or none) and marks gaps. Include a short 'how to update' note and state which input classes do not exist (webhooks, imported files, rich text), verified by grep. Done when every api/*.ts, api/*/*.ts and server/src route is covered.
  - Files: `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Every route file under api/ and server/src appears in the inventory with each body field, query param and trusted header
    - Each row names the rule (type, max length, charset/format, allowed values) and the file that enforces it, or is flagged GAP
    - Upload, webhook, imported-file, rich-text and AI input classes are each listed as present or absent with evidence
    - Doc explains it must be updated whenever an input changes
  - Risk: Documentation only. Gaps found feed tasks 2 to 4.
  - Commit: `f764e5587850`

- [x] **Task 2: Shared server text checks and close the validation gaps** (after 1)
  - Intent: Add one shared zod text helper (api/_lib/inputRules.ts) that trims, rejects control characters (except newline/tab where multiline is allowed) and enforces max length, and reuse it in the existing schemas (entries, invoices, accounts, mileage, recurring entries, business profile, tax identifiers). Fix the gaps task 1 found: hand validators in accounts, mileage, login, mfa and hmrc callback lacking max length or control-character rejection, and unbounded password length. Reject with a clear 400 message, keep existing error codes, keep valid input working. Keep escapeLike and parameterised queries. Change shared functions, not single callers.
  - Files: `api/_lib/inputRules.ts`, `api/_lib/entries.ts`, `api/_lib/invoices.ts`, `api/_lib/accounts.ts`, `api/_lib/mileage.ts`, `api/_lib/recurringEntries.ts`, `api/_lib/businessProfile.ts`, `api/_lib/taxIdentifiers.ts`, `api/_lib/tradingAllowance.ts`, `api/_lib/vatReturns.ts`, `api/auth/login.ts`, `api/auth/mfa.ts`, `api/hmrc/callback.ts`, `api/hmrc/mode.ts`, `api/accounts.ts`, `api/mileage.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Every free-text field on the server has a max length and rejects control characters with a 400 and a readable message
    - Every id and enumerated parameter is checked as uuid or against allowed values before use
    - Existing route tests pass unchanged for valid input
    - Inventory rows for fixed gaps are updated
    - npm run lint, typecheck and test pass
  - Risk: Touches many handlers; must not change behaviour for valid input or any layout.
  - Commit: `8cd5ee097f0c`

- [x] **Task 3: Rate limit sign-in, MFA and message-sending routes** (after 1)
  - Intent: Review api/_lib/loginThrottle.ts and its use in login and MFA. Ensure MFA code attempts and any route that sends email or messages are rate limited per client, with a tighter limit on sign-in, via one shared limiter reused by the routes. Add no dependency unless the existing throttle cannot be reused. If no route sends email, record that in the inventory. Derive the client key from a trusted source, not a spoofable header taken at face value.
  - Files: `api/_lib/loginThrottle.ts`, `api/auth/login.ts`, `api/auth/mfa.ts`, `api/_lib/auth.ts`, `api/auth/__tests__/login.test.ts`, `api/auth/__tests__/mfa.test.ts`, `api/_lib/__tests__/loginThrottle.test.ts`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - Repeated failed sign-in and MFA attempts return 429 after the documented limit
    - Limit is keyed per client and a test fails if the limiter is removed
    - Queries added or changed are indexed and bounded, and noted in the query audit comment
    - Existing auth tests pass
  - Risk: Authentication and session work: Opus at high per . A mistake could lock out the owner.
  - Commit: `660ced0da781`

- [x] **Task 4: Safe display, links, AI prompt and upload guards** (after 1)
  - Intent: Verify and enforce safe output: confirm no dangerouslySetInnerHTML or innerHTML in src, that user text renders as text in React and in api/_lib/invoicePdf.ts, and that any user-supplied URL rendered as a link allows http/https only (one small helper in src/lib if such links exist). Review src/lib/receiptPrompt.ts so receipt text is passed as delimited data, not instructions, with no keys or settings in the prompt, and output stays a draft. Record or enforce upload type, size and safe-name rules where ReceiptsPage submits; document as absent if no upload endpoint exists. Check the CSV export neutralises formula-leading characters (= + - @) in entriesExport and fix there if not. Change only real gaps.
  - Files: `api/_lib/entriesExport.ts`, `src/lib/receiptPrompt.ts`, `src/lib/safeUrl.ts`, `src/pages/ReceiptsPage.tsx`, `docs/security/input-inventory.md`
  - Acceptance criteria the planner set:
    - No raw HTML insertion exists in src or api
    - Any rendered user link rejects javascript:, data: and other non-http(s) schemes
    - CSV export neutralises cells starting with = + - @
    - Receipt prompt wraps user content as data with an instruction not to follow it, and output remains a draft
    - Upload rules are enforced or the inventory states there is no upload endpoint
  - Risk: Some items may be no-ops; change only what is a real gap. ReceiptsPage change must not alter layout.
  - Commit: (none — no code change for this task)

- [x] **Task 5: Malicious-input test suite across every input class** (after 2, 3, 4)
  - Intent: Add one shared fixture of hostile strings (script tags, HTML, SQL fragments, 10k-char values, control characters and NUL, path traversal, wrong file types, formula prefixes) and run it through each input class: entries, invoices, accounts, mileage, recurring entries, business profile, tax identifiers, VAT number, trading allowance, login/MFA, list query params, export params. Assert each is rejected with 400 or round-trips as inert text via fake stores (no live DB). Add a component test that hostile text renders as text on entries list and invoices. Add a test that fails when an api route file is missing from the inventory doc.
  - Files: `api/_lib/__tests__/maliciousInputs.ts`, `api/_lib/__tests__/maliciousInputRoutes.test.ts`, `src/pages/__tests__/hostileTextRender.test.tsx`, `api/_lib/__tests__/inputInventory.test.ts`
  - Acceptance criteria the planner set:
    - Every input class in the inventory has a hostile-input test that fails if its validation is removed
    - Tests use fakes only, no network or database
    - Inventory coverage test fails when a route is added without an entry
    - npm run lint, typecheck, test and build pass
  - Risk: Large test volume; use table-driven tests to stay near the size guide.
  - Commit: (none — no code change for this task)

- [x] **Task 6: Fix (recovered): address 8 review findings (cycle 1)** (after 5)
  - Intent: Review left 8 findings unresolved (NEEDS_WORK): **correctness** — APPROVED The correctness lens found no blocking defects. I read the diff and the login handler, and ran no tests; the orchestrator's typecheck, test, lint and build runs all passed.  The agent is fixing them; nothing is needed from you.
  - Commit: `5757e0886eb8`

- [x] **Task 7: Fix: address 8 review findings (cycle 0)** (after 6)
  - Intent: Review left 8 findings unresolved (NEEDS_WORK): **correctness** — APPROVED The correctness lens found no defects. The earlier unused WRONG_FILE_TYPES export is gone. The per-client throttle is keyed consistently across login, MFA and authenticator. The agent is fixing them; nothing is needed from you.
  - Commit: (none — no code change for this task)
