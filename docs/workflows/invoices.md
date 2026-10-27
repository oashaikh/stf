# Invoices

`api/invoices.ts` manages invoices across their lifecycle: draft (editable), sent (issued to ledger), paid, voided, and overdue (a derived state for sent invoices past their due date). All operations require a signed-in owner; every query is scoped to the session's user id. Errors use `{ ok, error, code, fields }`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/invoices` | Create a draft. Takes the owner's next number. |
| POST | `/api/invoices?id=UUID&action=issue` | Issue (send to ledger). Draft → sent. |
| POST | `/api/invoices?id=UUID&action=paid` | Mark paid. Sent → paid. Body: `{ "paymentDate": "YYYY-MM-DD" }`. |
| PUT | `/api/invoices?id=UUID` | Replace a draft's details and lines. Number is kept. |
| GET | `/api/invoices?status=&cursor=&limit=` | List, newest first. Status filters: draft, sent, paid, overdue, voided. Limit defaults to 25, capped at 100. |
| GET | `/api/invoices?id=UUID` | One invoice with its lines. |
| DELETE | `/api/invoices?id=UUID` | Void an invoice. Body: `{ "reason": "..." }` is required. |

Another owner's id returns 404. Editing a non-draft returns 409. Marking paid a non-sent invoice, or voiding inside a locked VAT period, returns 409 with code `PERIOD_LOCKED`.

## Numbering

The number is the owner's prefix plus the counter, zero padded to four digits. Creating an invoice locks the owner's user row, reads the counter, increments it and inserts the invoice in one transaction, so concurrent creates get distinct sequential numbers. The counter never goes back: a voided invoice keeps its number and the next invoice takes the next one. The void reason is stored in the audit event.

## Totals

Quantity is an integer scaled by 10,000. The server recomputes line and invoice totals from quantity and unit price (`src/lib/invoiceMaths.ts`); totals, number and status sent by the client are ignored. VAT (0, 5 or 20 percent per line) applies only when the owner has a VAT number; otherwise every line is forced to 0 VAT.

## Issue (draft to sent)

Posting the income against the ledger. Under standard VAT accounting, VAT is due by the invoice date, not the payment date; income posts when the invoice is issued.

Action:
- Locks the invoice from further editing.
- Sets status to `sent`.
- Posts one transaction dated the **issue date** with posting lines per VAT rate:
  - **Income**: one credit line per VAT rate group, net of VAT, carrying that rate's VAT amount.
  - **VAT control**: one credit line per VAT rate with VAT > 0, crediting the VAT Control account (a liability).
  - **Debtors**: one debit line to Trade Debtors for the gross total.
- Links the invoice to its posting via `invoices.transaction_id`.
- Audit event: `invoice.issue` with `transactionId`.

Errors:
- 404 if the invoice does not belong to the owner.
- 409 if the invoice is not in `draft` status.
- 409 `PERIOD_LOCKED` if the issue date falls inside a confirmed or filed VAT period.

## Mark paid (sent to paid)

Recording payment received. Payment does not change VAT since it was already recorded on issue.

Action:
- Posts one transaction dated the **payment date** with two lines:
  - **Bank**: debit from the Business Bank account, the invoice gross.
  - **Debtors**: credit to Trade Debtors, the invoice gross.
- Sets status to `paid`.
- Links the payment posting via `invoices.payment_transaction_id`.
- Audit event: `invoice.paid` with `paymentTransactionId` and `paymentDate`.

Errors:
- 404 if the invoice does not belong to the owner.
- 409 if the invoice is not in `sent` status.
- 400 if the payment date is before the issue date or more than 7 days ahead.
- 409 `PERIOD_LOCKED` if the payment date falls inside a confirmed or filed VAT period.

## Void

Soft-deletes the invoice and voids any ledger postings, under the same rules as entries (STF-66). Drafts have no postings. Sent invoices have an issue posting. Paid invoices have both an issue and a payment posting.

Action:
- Sets status to `voided`.
- Soft-deletes (sets `deleted_at`); the number is not reclaimed.
- Voids each posting (issue and/or payment) by checking each posting's date against the VAT period lock.
- Stores the void reason in the audit event metadata.
- Audit event: `invoice.void` with `reason`.

Errors:
- 404 if the invoice does not belong to the owner.
- 409 `PERIOD_LOCKED` if any posting (issue or payment) falls inside a confirmed or filed VAT period.

The void reason is required and stored in the audit trail.

## Overdue

Overdue is derived from the due date, not stored. A `sent` invoice is shown as `overdue` if its `dueDate` is before today. Paid invoices are never overdue. When listing with `status=overdue`, only sent invoices with a past due date are returned.

## Cash accounting VAT (STF-22)

The issue, mark-paid and void posting rules assume standard VAT accounting (VAT due by invoice date). Owners on the cash accounting scheme follow the payment date instead, and that logic is deferred to STF-22; for now all invoices post under standard accounting.

## Audit events

- **`invoice.create`**: Draft created. No before snapshot.
- **`invoice.edit`**: Draft edited.
- **`invoice.issue`**: Draft issued. Metadata: `transactionId`.
- **`invoice.paid`**: Invoice marked paid. Metadata: `paymentTransactionId`, `paymentDate`.
- **`invoice.void`**: Invoice voided (draft, sent, or paid). Metadata: `reason`.

Each audit event captures the invoice id, public number, status, and financial totals (net, VAT, gross) before and after the action.

## PDF download (STF-79)

`GET /api/invoice-pdf?id=<uuid>` renders the signed-in owner's invoice to PDF on the server. The owner id comes from the session only. A bad id is a 400; an unknown invoice, another owner's invoice and a voided invoice are all a 404 `NOT_FOUND` JSON body, so a caller cannot tell them apart. Drafts, sent, paid and overdue invoices render, so the owner can preview a draft before issuing it.

The response is `application/pdf` with `Content-Disposition: attachment` (file name from the public number, with anything outside letters, digits, `_` and `-` replaced) and `Cache-Control: no-store`. `vercel.json` gives the function a 30 second `maxDuration`.
