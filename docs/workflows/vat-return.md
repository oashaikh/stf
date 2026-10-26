# VAT return workflow

How a VAT return is built from the ledger. The computation lives in `src/lib/vat.ts`
(`buildVatReturnFromLedger`) and is pure: route handlers load rows, call it, and never
do tax arithmetic themselves.

## Steps

1. Fetch open HMRC obligations and let the user select one (period key, start, end). If there is only one open obligation, select it automatically. If there are none, say so and offer no review or submit. Sandbox mode unless
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
   - **Open obligation check:** Before claiming the submission, the server fetches the user's open HMRC obligations
     and verifies the period matches one exactly (same periodKey, start, end, and status='O'). Requests for periods that are not open are refused with `PERIOD_NOT_OPEN` (409). This guards against submitting stale or invalid periods.
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

## Preview

On the VAT page, once a return is confirmed and not stale or submitted, "Preview what will be sent" sits beside
the submit button. It calls `POST /api/vat/preview` and shows the endpoint (sandbox or live, VRN masked), boxes 1 to 9
in pounds as they will be sent, the header names and values (Authorization reads "Bearer (hidden)") and the raw JSON
in a collapsible block (`src/pages/VatPreviewPanel.tsx`). The submit confirmation dialog fetches and shows the same
preview when it opens. Nothing is sent to HMRC and no submission row is written.

## History

`GET /api/vat/history` lists the newest returns for the signed-in user. The VAT page shows them under
"VAT return history" with a status of Draft, Confirmed, Submitted or Accepted, the period and net VAT due (box 5).
Sandbox receipts carry a "Sandbox" label.

Submitted and accepted returns are immutable. Opening one shows a view-only copy of boxes 1 to 9 and the stored
HMRC receipt (form bundle number, processing date), with no Edit, Reopen, Confirm or Submit control.
Drafts and confirmed returns are edited on the review above, not in the history.

## Fraud prevention headers

Every HMRC MTD call (obligations, preview, submit) includes mandatory fraud prevention headers that identify the connection method, user, and device. HMRC checks these headers to prevent spoofed submissions. STF uses the `WEB_APP_VIA_SERVER` connection method.

**Full reference:** See `docs/fraud-prevention-headers.md` for the complete header table, vendor IP and licence ID configuration, percent-encoding rules, and HMRC's official specification link.

### Building the headers

The complete header set for WEB_APP_VIA_SERVER is built by `src/lib/hmrc/fraudHeaders.ts::buildFraudHeaders()`. The function reads from three sources:

1. **Server config:** Application name, version (from package.json + git), user ID from the database
2. **Request headers:** Client IP from `x-vercel-forwarded-for` (Vercel) or `x-forwarded-for`; vendor IP from `HMRC_VENDOR_PUBLIC_IP` environment variable
3. **Browser values:** Device ID, timezone, screen dimensions, window size, DNT preference, User-Agent; sent by the SPA as `x-stf-*` headers

Malformed browser-supplied values (those that don't match HMRC's format) are dropped rather than forwarded, preventing silent validation failures at HMRC.

### Header set for WEB_APP_VIA_SERVER

| Header | Mandatory | Source |
|---|---|---|
| `Gov-Client-Connection-Method` | Yes | Server constant (`WEB_APP_VIA_SERVER`) |
| `Gov-Client-User-IDs` | Yes | User database (internal STF id, percent-encoded) |
| `Gov-Vendor-Product-Name` | Yes | Server constant (`stf`) |
| `Gov-Vendor-Version` | Yes | package.json version, plus short git commit SHA when available (e.g., `stf=0.1.0+abc1234`) |
| `Gov-Client-Public-IP` | No | Client IP (extracted from request headers, validated with `isIP()`) |
| `Gov-Client-Public-IP-Timestamp` | No | ISO 8601 with milliseconds (set when client IP is present) |
| `Gov-Vendor-Public-IP` | No | Server's public egress IP (from `HMRC_VENDOR_PUBLIC_IP` env var) |
| `Gov-Vendor-Forwarded` | No | `by=<vendor-ip>&for=<client-ip>` (set when both IPs are known, percent-encoded) |
| `Gov-Vendor-License-IDs` | No | SHA-256 hash of licence id (from `HMRC_VENDOR_LICENSE_ID` env var; never sends the id itself) |
| `Gov-Client-Device-ID` | No | UUID v4 from browser (dropped if malformed) |
| `Gov-Client-Timezone` | No | Browser timezone in `UTC±HH:MM` format (dropped if malformed) |
| `Gov-Client-Screens` | No | Comma-separated list of display dimensions (dropped if any entry is malformed) |
| `Gov-Client-Window-Size` | No | Application window size as `width=N&height=N` (dropped if malformed) |
| `Gov-Client-Browser-Do-Not-Track` | No | `true` or `false` (dropped if neither) |
| `Gov-Client-Browser-JS-User-Agent` | No | Browser User-Agent string (percent-encoded) |

**Multi-factor authentication:** `Gov-Client-Multi-Factor` is never sent. HMRC specifies this header only when multi-factor authentication is used. STF uses password-only authentication, so the header is omitted per HMRC's guidance.

### Fraud headers validation check

Before submitting VAT returns to HMRC, use the built-in fraud headers check to validate that all headers conform to HMRC's spec.

**To run the check:**
1. Sign in to Settings.
2. Scroll to the HMRC section.
3. Click "Check HMRC fraud headers".
4. The check calls HMRC's sandbox Test Fraud Prevention Headers validator (not a real submission) and displays the result:
   - **Pass:** All headers are valid. The app is ready for VAT submissions.
   - **Errors:** HMRC reports which headers are invalid, with a message for each. Fix the header and recheck.
   - **Warnings:** HMRC reports suggestions; warnings do not block submissions.

**Audit trail:** Each validation run is recorded in `audit_events` with action `hmrc.fraud_headers.validated`. The snapshot includes the outcome, HMRC's response code, and the names of all headers sent (values are not logged, per DP-8).

**Sandbox only:** The validator is available only in the HMRC sandbox. The endpoint is `POST /api/vat/fraud-headers-check` and requires the user to be signed in.

## Units

Everything is integer pence internally. Pounds appear only in `boxesToHmrcPayload`;
HMRC takes whole pounds for boxes 6 to 9 and absolute value for box 5.
