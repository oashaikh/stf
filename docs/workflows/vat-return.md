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
   - **Submission gate:** `requireConfirmedReturn(userId, period, store?)` is called by STF-19 (the submit
     endpoint). `period` is the full `{ periodKey, start, end }`. It verifies the return is confirmed, the stored dates equal `period`, and the boxes still match the ledger. Without
     this gate, no VAT return may be submitted to HMRC.
5. At submission only, `boxesToHmrcPayload` converts pence to pounds.
6. **Submission:** `POST /api/vat/submit` with `{ periodKey, start, end, confirm: true }` files the confirmed return
   to HMRC (or the sandbox). The submission flow:
   - **Confirmed gate:** Verifies the return is confirmed and the ledger still matches (calls `requireConfirmedReturn`).
   - **Dual mode check:** Requires both `HMRC_SANDBOX_MODE` environment variable and the user's Settings opt-in to agree.
     This blocks live filing on either switch alone.
   - **Idempotency claim:** Inserts a row into `vatSubmissions` with status `pending`. The unique index on
     `(user_id, period_key, sandbox)` ensures only one submission claim per period per mode. A concurrent request
     gets `ALREADY_SUBMITTED`. A request after a failed claim may flip the status back to `pending` to retry.
   - **HMRC filing:** Sends the boxes and fraud headers (connection method, user IDs and vendor version) to HMRC,
     with the access token in the Authorization header. All HMRC tokens are decrypted in-memory only; they never appear in logs or audit trails.
   - **Outcome handling:** On HMRC success, writes `vat_return.submitted` audit event with the form bundle number,
     processing date, request payload, response, and fraud headers (authorization header excluded). On HMRC 4xx error
     (client mistake), marks the claim `failed` and writes `vat_return.submit_failed`. On HMRC 5xx or network failure,
     keeps the claim `pending` because the outcome is ambiguous: HMRC may have processed the return even if the response failed.
   - **Receipt storage:** The receipt is the form bundle number and processing date from HMRC. Both are stored on the
     `vatSubmissions` row when the claim transitions to `submitted`.
   - **Response:** Returns `{ ok: true, data: { formBundleNumber, processingDate, sandbox } }`. The `sandbox` flag tells
     the UI whether this was filed to the sandbox or live.

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

## Submission states and recovery

A period can be in one of three submission states. The `vatSubmissions` row tracks them:

| State | Meaning | Recovery |
|---|---|---|
| `pending` | Submission was claimed but the outcome is unknown (HMRC 5xx, network failure, or in-flight). The period is locked: no new submission attempt is allowed. | Check HMRC directly. Do not resubmit; call the user to verify the return reached HMRC. If confirmed lost, ask them to contact HMRC support. |
| `submitted` | Receipt confirmed by HMRC. The form bundle number and processing date are stored. The period is locked: no new submission attempt is allowed. | No action needed; the return is filed. |
| `failed` | HMRC rejected the submission (4xx error, e.g. invalid box values). The claim can be retried by submitting again. | Fix the validation error and resubmit via `POST /api/vat/submit`. |

**Outcome unknown:** If the submission returns code `OUTCOME_UNKNOWN`, HMRC may have processed the return despite the failed response. The claim stays `pending` to prevent double-submission. Instruct the user to:
1. Check their HMRC account (MyVAT) for evidence of filing.
2. If the return appears in HMRC, no action is needed (it will sync on the next obligations refresh).
3. If the return does not appear, contact HMRC support before retrying.

## Dual gates for live submission

Filing goes to the sandbox by default and requires both of:
1. Server config: `HMRC_SANDBOX_MODE=false` in the deployment environment.
2. User opt-in: Settings → HMRC → "Allow live filing with HMRC" plus typing FILE LIVE to confirm (stored as `users.hmrc_sandbox_mode = false`).

If only one switch is set, the request fails with `MODE_MISMATCH`. Both must match exactly.

## Audit events

The submission process writes two audit events (action, resource type, resource id, and snapshot):

| Action | Resource | Snapshot | Trigger |
|---|---|---|---|
| `vat_return.submitted` | `vat_submission` | Request payload, HMRC response (form bundle number + processing date), fraud headers (no auth header), period key, sandbox flag | Successful HMRC filing |
| `vat_return.submit_failed` | `vat_submission` | Request payload, HMRC error code and status, fraud headers (no auth header), period key, sandbox flag | HMRC 4xx rejection |

**Testing note:** Every test mocks the HMRC API via the `submitVatReturn` function. Live HMRC is never called in any test. Sandbox filing is tested end-to-end with mocked responses; live filing is tested only via the mode mismatch gate and does not interact with HMRC.

## Units

Everything is integer pence internally. Pounds appear only in `boxesToHmrcPayload`;
HMRC takes whole pounds for boxes 6 to 9 and absolute value for box 5.
