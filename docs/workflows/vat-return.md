# VAT return workflow

How a VAT return is built from the ledger. The computation lives in `src/lib/vat.ts`
(`buildVatReturnFromLedger`) and is pure: route handlers load rows, call it, and never
do tax arithmetic themselves.

## Steps

1. Fetch the open obligation from HMRC (period key, start, end). Sandbox mode unless
   `HMRC_SANDBOX_MODE=false` and the user has opted in under Settings.
2. Load the user's transaction lines for the period, joined to the transaction (date,
   status, `deleted_at`) and account (`account_type`), as `LedgerLine[]`.
3. Call `buildVatReturnFromLedger(lines, { start, end })`. The result is a draft.
4. Draft and confirmation: the user reviews the nine boxes and confirms.
   - **Draft state:** `PUT /api/vat/return` with `{ periodKey, start, end, reopen?: boolean }` saves
     a draft snapshot to `vatReturnDrafts` with status `draft`. The server recomputes the boxes
     from the ledger every time (never trusts the client boxes). A user can leave and return to
     review later, or reopen a confirmed return with `reopen: true`.
   - **Server recompute:** Every request to `/api/vat/return` (both GET and PUT) recomputes the
     boxes from the current ledger. If the UI shows stale data (a new transaction was recorded),
     the server always uses live numbers.
   - **Confirmation:** `POST /api/vat/return-confirm` with `{ periodKey, start, end, declaration: true }`
     recomputes the boxes, records them with status `confirmed`, stores `confirmedAt` and
     `declarationAcceptedAt` timestamps, and writes an audit event. Only a confirmed return may
     be submitted.
   - **Stale rule:** If the ledger changes after confirmation, the submission gate `requireConfirmedReturn`
     (in `api/_lib/vatReturns.ts`) throws `STALE_CONFIRMATION`. The user must review and confirm
     again. This prevents silent mismatches between what was confirmed and what is submitted.
   - **Submission gate:** `requireConfirmedReturn(userId, periodKey)` is called by STF-19 (the submit
     endpoint). It verifies the return is confirmed and the boxes still match the ledger. Without
     this gate, no VAT return may be submitted to HMRC.
5. At submission only, `boxesToHmrcPayload` converts pence to pounds.

## What counts

A line is included when its transaction is `confirmed` or `reconciled`, has no
`deleted_at`, and its date falls inside the period (both ends inclusive). Only
`income` and `expense` accounts contribute. `amount_pence` is the net, ex-VAT amount.

Pass lines with the raw ledger signs: debit positive, credit negative, and `vat_pence`
signed like its `amount_pence`. Income is a credit, so the function flips its sign;
expense is a debit and is summed as is. A sales credit note (a debit on an income
account) therefore reduces boxes 1 and 6, and a purchase credit note reduces boxes 4
and 7. The loader must not take absolute values.

## The nine boxes

| Box | Meaning | Source |
|---|---|---|
| 1 | VAT due on sales | sum of `vat_pence`, income lines |
| 2 | VAT due on EC acquisitions | 0 |
| 3 | Total VAT due | box 1 + box 2 |
| 4 | VAT reclaimed on purchases | sum of `vat_pence`, expense lines |
| 5 | Net VAT to pay or reclaim | box 3 - box 4 (negative means a refund is due) |
| 6 | Total sales ex VAT | sum of `amount_pence`, income lines |
| 7 | Total purchases ex VAT | sum of `amount_pence`, expense lines |
| 8 | EC supplies | 0 |
| 9 | EC acquisitions | 0 |

## Nil return

A period with no qualifying lines gives all nine boxes as 0. It is a valid return and
is covered by a test.

## Units

Everything is integer pence internally. Pounds appear only in `boxesToHmrcPayload`;
HMRC takes whole pounds for boxes 6 to 9 and absolute value for box 5.
