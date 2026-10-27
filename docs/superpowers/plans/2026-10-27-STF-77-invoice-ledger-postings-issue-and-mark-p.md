# STF-77: Invoice ledger postings: issue and mark paid

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

- STF-64's posting function is postEntry in src/lib/postingRules.ts and STF-66's lock/void rules are isDateLocked and voidLiveEntry in api/_lib/entries.ts; both are already in this branch (dev is an ancestor of HEAD).
- Invoice income posts to the system Sales account (code 4000); the chart has no invoice-specific income account.
- Issue and mark-paid are API-only; src/pages/InvoicesPage.tsx is a 'Coming soon' stub and no invoice UI is in scope.
- Migration prefix 0014 avoids the existing 0011 and the 0011/0012 names reserved by STF-49 and STF-31; re-check the journal head and renumber if those merge first.
- Owners without a VAT number get zero-rate lines, as postEntry already forces.

## Out of scope

- VAT cash accounting scheme (STF-22)
- Invoice UI, PDF or email sending
- Partial payments, credit notes, choosing the bank account at payment time (default bank account 1000 is used)
- A scheduled job to store overdue

## Tasks

- [x] **Task 1: Add invoices.payment_transaction_id column and migration**
  - Intent: Add a nullable uuid column payment_transaction_id (FK to transactions.id) to invoices in server/src/db/schema.ts, with the next Drizzle migration, journal entry and snapshot. Use prefix 0014_invoice_payment_transaction (0011 exists; 0011/0012 are reserved by the STF-49/STF-31 plans). Parent on current head so the journal keeps one head. Extend schema.test.ts to assert the column. The existing transaction_id column links the issue transaction. No new index: the column is only read through the invoice row.
  - Files: `server/src/db/schema.ts`, `server/src/db/schema.test.ts`, `server/src/db/migrations/0014_invoice_payment_transaction.sql`, `server/src/db/migrations/meta/_journal.json`, `server/src/db/migrations/meta/0014_snapshot.json`
  - Acceptance criteria the planner set:
    - Migration uses ADD COLUMN IF NOT EXISTS payment_transaction_id uuid REFERENCES transactions(id)
    - _journal.json has one new entry after the current head and a matching snapshot
    - schema.test.ts asserts invoices has transactionId and paymentTransactionId
    - npm run typecheck and npm test pass
  - Risk: Opus/high: schema migration work; journal is a likely merge-conflict point with STF-31 and STF-49, re-check against base before finishing.
  - Commit: `5855784b364f`

- [x] **Task 2: Pure invoice posting functions (issue and payment) with VAT box tests**
  - Intent: Add src/lib/invoicePostings.ts with two pure integer-pence functions. postInvoiceIssue groups invoice lines by VAT rate and returns balanced ledger lines: one income category line per rate (credit, carrying vat_pence), one VAT control line per rate with VAT, and a single trade debtors debit for the gross. Reuse postEntry (the STF-64 function, settleAgainst 'debtors') per rate group where it gives the same result; per-line rounded VAT from invoiceMaths must sum exactly to the header vat_pence/total_pence, so if postEntry's vatOnNet on the group net could differ by a penny, build from stored line totals and assert equality. postInvoicePayment returns debit bank, credit trade debtors for total_pence, no VAT or category lines. Tests (src/lib/invoicePostings.test.ts) feed lines to buildVatReturnFromLedger from src/lib/vat.ts: issue gives right box 1 and box 6 for the issue-date period; mixed 0/5/20 gives one category line per rate; payment lines leave all nine boxes unchanged; every posting sums to zero.
  - Files: `src/lib/invoicePostings.ts`, `src/lib/invoicePostings.test.ts`
  - Acceptance criteria the planner set:
    - Issue postings balance to zero and the debtors line equals total_pence for mixed-rate and zero-VAT invoices
    - buildVatReturnFromLedger over issue lines gives box1 = invoice VAT and box6 = net for the issue-date period only
    - Adding payment lines leaves boxes 1 to 9 unchanged
    - No floating point; npm test passes
  - Commit: `f8698359066e`

- [x] **Task 3: Invoice store: issue, mark paid, void with postings, derived overdue, audit events** (after 1, 2)
  - Intent: Extend api/_lib/invoices.ts with InvoiceStore.issue(userId, invoiceId) and markPaid(userId, invoiceId, paymentDate), and extend void to handle issued and paid invoices as well as drafts. Issue runs in one DB transaction: lock the invoice row FOR UPDATE scoped by user_id, require draft, check the issue date is not in a confirmed/filed VAT period by reusing databaseEntryStore.isDateLocked (409 PERIOD_LOCKED, same message), insert a transactions row (manual, confirmed, dated issue_date) with lines from postInvoiceIssue. Account ids (Sales 4000, bank, debtors, VAT control) load as in loadPostingContext, bounded by LIMIT. Set status 'sent', invoices.transaction_id, write invoice.issue audit. markPaid requires status sent, rejects a payment date before the issue date or beyond MAX_DAYS_AHEAD, posts postInvoicePayment dated the payment date, sets payment_transaction_id and status 'paid', writes invoice.paid. Void of an issued/paid invoice voids the issue transaction (and payment transaction) via the same voidLiveEntry rules as STF-66 after checking isDateLocked on issue and payment dates, so a void in a filed period gives 409 PERIOD_LOCKED; then soft-delete the invoice and write invoice.void with the reason. Editing stays blocked for non-draft through lockOwnedDraft 409. List derives overdue: sent with due_date before today returns status 'overdue' and the overdue filter maps to sent and due_date < today; nothing stored by a job. Every query filters on the session user id and has an explicit limit. No network work inside a transaction.
  - Files: `api/_lib/invoices.ts`, `api/_lib/entries.ts`, `src/lib/chartOfAccounts.ts`
  - Acceptance criteria the planner set:
    - issue, markPaid and void each run in a single db.transaction and write exactly one audit event (invoice.issue, invoice.paid, invoice.void)
    - Every query in the new code is scoped by eq(invoices.userId, userId) from the session, never the body
    - A void whose issue or payment date is in a confirmed or filed period throws InvoiceRuleError 409 PERIOD_LOCKED and changes nothing
    - issue on a non-draft, or markPaid on a non-sent invoice, throws 409; update on a sent or paid invoice throws 409
    - list returns 'overdue' for sent invoices past due_date and the overdue filter works; 'overdue' is never written
    - Any export added to entries.ts or chartOfAccounts.ts is reused, not duplicated; typecheck and lint pass
  - Risk: Opus/high: ledger postings, financial integrity, period lock and tenant scoping; lock check and posts must be consistent in one transaction.
  - Commit: `63990b1113d8`

- [x] **Task 4: Routes for issue and mark-paid, plus route tests with an in-memory store** (after 3)
  - Intent: Extend api/invoices.ts with issue and mark-paid actions following the existing id/method pattern: POST issue, POST paid with validated body { paymentDate: isoDate }, UUID-gated, behind the owner session, mapping InvoiceRuleError via run(). The paid-date schema in api/_lib/invoices.ts strips unknown keys so the client cannot send status, totals or account ids. Extend api/_lib/__tests__/invoicesRoute.test.ts with a fake store: issue gives sent; issue of non-draft 409; mark paid gives paid with payment link; bad paymentDate 400; no session 401; second user using first user's id gets 404 on issue, paid and void; PUT on sent/paid 409; void in a filed period 409 PERIOD_LOCKED. Add an integration-style test with the real posting functions and an in-memory ledger showing issue puts the right figures in boxes 1 and 6 for the issue-date period and paying leaves the VAT boxes unchanged.
  - Files: `api/invoices.ts`, `api/_lib/invoices.ts`, `api/_lib/__tests__/invoicesRoute.test.ts`, `api/_lib/__tests__/invoicePostingsRoute.test.ts`
  - Acceptance criteria the planner set:
    - Issue and mark-paid routes exist; unknown methods give 405 and a non-uuid id gives 400
    - Tests cover issue boxes 1 and 6, pay leaves boxes unchanged, void in a filed period refused, paid invoice cannot be edited, cross-user id refused, validation errors, missing session
    - No test touches a real database or network
    - npm test, npm run lint, npm run typecheck pass
  - Risk: Opus/high: authorisation and tenant isolation on new mutating routes.
  - Commit: `6d242feb48dd`

- [x] **Task 5: Document the issue, pay and void flow** (after 4)
  - Intent: Update docs/workflows/invoices.md with the issue, mark-paid and void rules: income posts at issue date against trade debtors, payment moves debtors to bank without touching VAT, void goes through the VAT period lock, overdue is derived at list time, and the audit actions. Note cash-accounting VAT is handled in STF-22.
  - Files: `docs/workflows/invoices.md`
  - Acceptance criteria the planner set:
    - Doc states the posting lines for issue and payment, the lock behaviour on void, and the audit event names
    - npm run build still passes
  - Commit: `ac6a080b1c1a`

- [x] **Task 6: Fix: address 8 review findings (cycle 1)** (after 5)
  - Intent: Review left 8 findings unresolved (NEEDS_WORK): **correctness** — APPROVED The correctness lens found no blocking defects. I read the diff and `voidLiveEntry`/`MAX_DAYS_AHEAD` in `api/_lib/entries.ts`; I did not re-run tests. Issue, mark-paid and v The agent is fixing them; nothing is needed from you.
  - Commit: `5d7b92b3299d`
