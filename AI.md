# AI.md — STF (Sole Trader Finance)

## Purpose

This file is the standing operating instruction for any AI coding agent working on this repository.

It inherits the readiness principles from the URDF Studio project. The central rule is the same:

> Readiness before deployment. Sequence before speed. Engineering before theatre.

STF handles real money, real tax obligations, and real HMRC submissions. The consequences of incorrect data are financial penalties, legal liability, and loss of user trust. Every architectural decision must reflect that.

Do not build screens first. Build operating truth first.

---

## Prime directive

Before adding code, changing architecture, installing dependencies, or wiring an automation, prove the project is ready for that change.

A project is not ready because the idea is clear. It is ready when the workflow, data, ownership, guardrails, failure path, and operating cadence are clear.

Do not optimise for demos. Optimise for correctness and production survival.

---

## STF-specific operating rules

### Money and tax rule

Any feature that touches transaction amounts, VAT, tax calculations, or HMRC submissions is **high-risk by default**.

- No amount may be computed outside a pure, unit-tested domain function.
- No tax figure may be submitted to HMRC without explicit user review and confirmation.
- No financial record may be silently deleted. Soft-delete only; all mutations audited.
- AI may extract, suggest, and draft. AI must not submit or finalise.

### HMRC rule

HMRC API calls (MTD VAT, MTD Income Tax, Corporation Tax) are **irreversible in most cases**.

- Every HMRC API call must be preceded by a user-visible confirmation step.
- Every HMRC API call must be logged with full request/response, user ID, and timestamp.
- Sandbox mode must be the default; production mode requires explicit user configuration.
- No HMRC submission may be triggered by an automated job without a human approval gate.

### Receipt and document AI rule

Claude Haiku is used for receipt OCR and document extraction. AI output is **always a draft**.

- AI-extracted fields (amount, date, vendor, category) are suggestions only.
- Every AI extraction must be confirmed or corrected by the user before the record is saved as authoritative.
- Confidence scores must be stored with every extraction.
- AI must never classify an expense as a specific tax category without user confirmation.

### Open source rule

STF is open source. Users supply their own API keys.

- No secrets, credentials, or personal data may be committed to the repository.
- All environment variables must be documented in `.env.example`.
- The app must function with any valid Anthropic API key; it must not phone home.
- HMRC credentials are always user-supplied and stored in user config, never in the repo.

---

## Operating principles

1. Readiness beats hype.
2. Sequence beats sprinting.
3. Money and tax require exact arithmetic — no floating-point for currency; use integer pence.
4. Every workflow needs an owner.
5. Every high-risk action (HMRC submission, bulk delete, plan change) needs a human boundary.
6. Every system needs logging, rollback, and retirement.
7. Every dependency must earn its place.
8. Every automation needs a supervisor.
9. Every feature must survive failure before it reaches users.
10. Every shipped system must be measured, audited, and reviewed.

---

## Required read order for AI agents

Before planning or coding, read in order:

1. `AI.md` (this file)
2. `architectures.md`
3. `PLAN.md`
4. `docs/workflows/` (relevant workflow)
5. `docs/data-model.md` (when it exists)
6. `docs/adr/` (relevant ADRs)
7. Relevant source code

---

## Work order

### Layer 0: Readiness

Before implementation, answer:

- What accounting or tax workflow is being solved?
- What is the blast radius if this is wrong?
- What data is authoritative and where does it live?
- What happens if HMRC rejects the submission?
- Who is accountable?

### Layer 1: Workflow truth

Document the trigger, inputs, outputs, owner, and failure states for every workflow before coding it.

### Layer 2: Data truth

Currency: **always store amounts as integer pence (GBP × 100)**. Never use floating-point for money. All monetary display values must be formatted, never raw.

Every transaction, invoice, expense, receipt, and tax record must have a single canonical table as source of truth.

### Layer 3: Access governance

- User-scoped: every record belongs to exactly one user. No cross-user data access.
- Admin routes (future multi-tenancy) must be separately gated.
- HMRC credentials are user-supplied and stored encrypted per user.

### Layer 4: Minimal dependency policy

Prefer: existing primitives → language stdlib → framework features → one stable dep with one clear job → external vendor only after the vendor gate passes.

Never add a new package because it is convenient. Add it because it is necessary.

### Layer 5: Vendor gate

For every external vendor (HMRC MTD API, Anthropic, Clerk, Stripe), document before integrating:

- What data it receives.
- What happens if it is unavailable.
- How to remove it.
- Who owns the data.

### Layer 6: Core architecture

See `architectures.md`.

### Layer 7: Interface

Every screen must handle: loading, empty, success, validation error, network failure, server error.

Every financial form must show the computed total before the user confirms.

### Layer 8: Business rules

All tax rules are encoded as versioned, unit-tested pure functions. No tax logic in route handlers.

### Layer 9: Logging and audit

Every mutation to a financial record, every HMRC API call, every AI extraction, and every user confirmation must emit a structured audit event.

### Layer 10: Failure and rollback

Every HMRC integration must have a sandbox fallback. Every bulk operation must be reversible or have an undo window.

### Layer 11: Testing

- Unit tests for all financial calculations (pence arithmetic, VAT, tax band logic).
- Integration tests for HMRC sandbox API calls.
- Permission tests for all protected routes.
- AI extraction tests with fixture receipts.

### Layer 12: AI/automation

AI agents (receipt extraction, categorisation suggestion) are Layer 1 read-only agents until measured accuracy justifies promotion. See agent SOPs in `docs/agents/`.

---

## Architectural hard stops

Stop and produce architecture docs instead of code when:

- The source of truth for an amount is unclear.
- A tax calculation involves floating-point.
- An HMRC API call has no confirmation step.
- A financial record can be hard-deleted.
- An AI-extracted value is used without user confirmation.
- A dependency has no removal path.
- A feature cannot be observed or rolled back.
