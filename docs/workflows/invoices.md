# Invoices (draft stage)

`api/invoices.ts` creates and edits draft invoices. Issuing, PDF and payment are separate tickets and are not part of this route.

## Endpoints

All require a signed-in owner; every query is scoped to the session's user id. Errors use `{ ok, error, code, fields }`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/invoices` | Create a draft. Takes the owner's next number. |
| PUT | `/api/invoices?id=` | Replace a draft's details and lines. Number is kept. |
| GET | `/api/invoices?status=&cursor=&limit=` | List, newest first. Limit defaults to 25, capped at 100. |
| GET | `/api/invoices?id=` | One invoice with its lines. |
| DELETE | `/api/invoices?id=` | Void a draft. Body `{ "reason": "..." }` is required. |

Another owner's id returns 404. Editing or voiding a non-draft returns 409.

## Numbering

The number is the owner's prefix plus the counter, zero padded to four digits. Creating an invoice locks the owner's user row, reads the counter, increments it and inserts the invoice in one transaction, so concurrent creates get distinct sequential numbers. The counter never goes back: a voided invoice keeps its number and the next invoice takes the next one. The void reason is stored in the audit event.

## Totals

Quantity is an integer scaled by 10,000. The server recomputes line and invoice totals from quantity and unit price (`src/lib/invoiceMaths.ts`); totals, number and status sent by the client are ignored. VAT (0, 5 or 20 percent per line) applies only when the owner has a VAT number; otherwise every line is forced to 0 VAT.
