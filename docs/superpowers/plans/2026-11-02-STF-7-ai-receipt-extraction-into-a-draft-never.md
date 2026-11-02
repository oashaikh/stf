# STF-7: AI receipt extraction into a draft (never a confirmed record)

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

- No receipt screen change is in scope: the ticket lists only the server route, prompt, docs and config. Wiring the route into ReceiptsPage and the confirm-the-details screen is a follow-up, and STF-74 is editing ReceiptsPage now.
- The model id env var is RECEIPT_AI_MODEL and the kill switch is RECEIPT_AI_ENABLED (default on); the default model should be a current Haiku id, checked against the claude-api reference when implementing.
- The existing receipts, receipt_extractions and audit_events tables already fit, so no migration is needed (STF-74 owns migration 0022).
- @anthropic-ai/sdk ^0.51.0 supports image and document content blocks; if not, raise it rather than bumping the dependency in this PR ().

## Out of scope

- Confirming a draft into a transaction and the owner's review screen
- Automatically triggering extraction after upload from the browser
- Adding ANTHROPIC_API_KEY in Vercel (owner action)
- Any migration or index change

## Tasks

- [x] **Task 1: Write the receipt extraction agent procedure**
  - Intent: Add docs/agents/receipt-extraction.md (docs/agents does not exist yet; CLAUDE.md says to create it with the first SOP). Cover six points: what the model may read (the owner's own ready receipt file only); what it may write (receipt_extractions draft rows, receipts.ai_status/ai_model/ai_confidence/ai_raw_output, one audit event, never transactions); what triggers it (an owner-session request for one ready receipt); what the owner sees before anything is saved (every field a draft, in plain words per docs/design/ease-of-use.md, nothing becomes a record until they confirm); the audit event (actor_type ai_agent, action name, resource receipts, metadata with model and status only, no receipt content); and the kill switch (env var, plus no-key behaviour: extraction skipped, ai_status 'skipped', owner enters by hand). Pin the env var names here (ANTHROPIC_API_KEY, RECEIPT_AI_MODEL with a documented default, RECEIPT_AI_ENABLED) so later tasks match.
  - Files: `docs/agents/receipt-extraction.md`
  - Acceptance criteria the planner set:
    - docs/agents/receipt-extraction.md exists with one clearly headed section for each of the six points
    - States that nothing is written to transactions and that the owner must confirm every field
    - Names the audit actor type ai_agent and the kill-switch variable
    - Written in plain words with no filler
  - Risk: Docs only.
  - Commit: `06da5deced0c`

- [x] **Task 2: Align receiptPrompt.ts with the data rules and add a zod reply schema**
  - Intent: Change src/lib/receiptPrompt.ts so the system prompt asks for: amounts as integer pence (not decimal strings), today's date passed in (buildReceiptSystemPrompt takes a today ISO date), JSON only, one overall confidence, and a not_a_receipt error reply. Replace the hand-rolled parseReceiptDraft and extractionAmountToPence (parseFloat*100, float money maths) with a zod schema (zod ^3 is installed): non-negative integer pence fields, ISO date, confidences 0-1 converted to integer thousandths (0-1000), category from the fixed list, currency GBP. The result type distinguishes ok / not_a_receipt / invalid (malformed JSON, decimals where pence were required). Update src/lib/__tests__/receiptPrompt.test.ts to cover good reply, malformed JSON, decimal amounts rejected, not-a-receipt and out-of-range confidence, and keep the existing injection-delimiter tests. The only importer found is that test.
  - Files: `src/lib/receiptPrompt.ts`, `src/lib/__tests__/receiptPrompt.test.ts`
  - Acceptance criteria the planner set:
    - Prompt text asks for integer pence, includes today's date, JSON only, overall confidence and the not_a_receipt error
    - Parser rejects decimal amounts, malformed JSON and unknown categories, and returns confidence as an integer 0-1000
    - No parseFloat or float money maths remains in the file
    - npm test, npm run typecheck and npm run lint pass
  - Risk: Money-path parser, so tests must fail if the logic breaks.
  - Commit: `74c61fb6e243`

- [x] **Task 3: Extraction service with fake-client tests: storage read, Anthropic call, draft rows, audit event** (after 2)
  - Intent: Add a getObject(key) method to ReceiptStorage in api/_lib/receiptStorage.ts (S3 GetObject returning bytes; the 10 MB upload cap bounds it) and a new api/_lib/receiptExtraction.ts with injected deps: a store (find the owner's ready receipt filtered by userId from the session, LIMIT 1; write the result), storage, an Anthropic-like client (@anthropic-ai/sdk is already installed: images as image blocks, PDFs as document blocks, base64) and a clock. Flow: if the kill switch is off or ANTHROPIC_API_KEY is missing, set ai_status 'skipped' and call nothing; else read the file, call the model (id from RECEIPT_AI_MODEL, documented default), parse with the task 2 schema. File read and model call run OUTSIDE any DB transaction (); then in one transaction insert one receipt_extractions row per non-null field (confidence in thousandths), set ai_status 'extracted', ai_model, ai_confidence and the raw reply in ai_raw_output, and insert an audit_events row with actor_type ai_agent. Malformed, invalid or not_a_receipt replies and API errors set ai_status 'failed' with no extraction rows (still audited). Logs carry only the receipt id and an error class, never receipt content or keys. Never touch transactions. Tests in api/_lib/__tests__/receiptExtraction.test.ts use a fake client and fake store: good reply stored as drafts, malformed JSON, decimals instead of pence, not-a-receipt, no key, switch off, wrong owner or not-ready returns not found, nothing written to transactions. Add a database-backed store with explicit columns and limits; register its queries for the query audit if the repo has such a registry (check how receipts.ts queries are registered). Verify an index exists on receipt_extractions.receipt_id; if not, report it rather than adding a migration (STF-74 owns migration 0022).
  - Files: `api/_lib/receiptStorage.ts`, `api/_lib/receiptExtraction.ts`, `api/_lib/__tests__/receiptExtraction.test.ts`, `api/_lib/__tests__/receiptStorage.test.ts`
  - Acceptance criteria the planner set:
    - Good fake reply produces one receipt_extractions row per field with integer thousandths confidence, raw reply in ai_raw_output, ai_status 'extracted', and an audit event with actor type ai_agent
    - Malformed JSON, decimal amounts and not-a-receipt each set ai_status 'failed' and create zero extraction rows
    - Missing key or switch off sets 'skipped' and never calls the client
    - No test or code path writes to transactions
    - Every query filters by the session userId and has an explicit limit
    - No log line contains receipt content or the API key (asserted in a test)
    - Images go as image blocks and PDFs as document blocks (asserted)
  - Risk: Opus at high: tenant isolation, secrets, AI-draft rule and audit trail. Edits receiptStorage.ts, which STF-74 also edits; add only a new method so the hunks merge.
  - Commit: `c79f21b1ae77`

- [x] **Task 4: Serverless route, vercel.json maxDuration, .env.example, input inventory** (after 3)
  - Intent: Add api/receipt-extract.ts (POST, body { id } validated with validateReceiptId from api/_lib/receipts.ts) wrapped in withAuth like api/receipts.ts, with userId taken from the session only. It calls the task 3 service with real deps built per request (storage config errors answer 503, as in api/receipts.ts) and returns only the receipt id, ai_status and the draft fields, never file_key or the raw reply. Other methods get 405; an unknown or not-ready receipt gets 404. Add the route to vercel.json functions with maxDuration 60. Add RECEIPT_AI_MODEL (default noted) and RECEIPT_AI_ENABLED (kill switch) to .env.example and update the Anthropic comment block; src/lib/__tests__/envExample.test.ts must keep passing, so read env as process.env.NAME. Add the route to docs/security/input-inventory.md. Route test in api/_lib/__tests__/receiptExtractionRoute.test.ts: unauthenticated refused, wrong method, bad id, a second user's receipt id refused with 404, happy path with the fake client. Finish by confirming the procedure doc matches the final env var names and behaviour.
  - Files: `api/receipt-extract.ts`, `api/_lib/__tests__/receiptExtractionRoute.test.ts`, `vercel.json`, `.env.example`, `docs/security/input-inventory.md`, `docs/agents/receipt-extraction.md`
  - Acceptance criteria the planner set:
    - Route refuses without a session, accepts only POST, and a second user's receipt id is refused
    - vercel.json has a maxDuration for api/receipt-extract.ts
    - The two new variables are in .env.example and the envExample test passes
    - Response carries no file_key or raw model output
    - npm run lint, typecheck, test and build all pass
  - Risk: Opus at high: authenticated route taking a record id and making a paid third-party call. Edits docs/security/input-inventory.md, which STF-74 also edits (different rows).
  - Commit: `58ce49466237`

- [x] **Task 5: Fix: address 11 review findings (cycle 1)** (after 4)
  - Intent: Review left 11 findings unresolved (NEEDS_WORK): **correctness** — NEEDS_WORK Correctness lens: the extraction route can be called repeatedly on one receipt, and each call inserts a new set of draft rows. The procedure doc also contradicts the code  The agent is fixing them; nothing is needed from you.
  - Commit: `2afe9e2354e0`
