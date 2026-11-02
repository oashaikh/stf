# Income Tax cumulative quarterly update workflow

How a self-employed taxpayer's quarterly income and expenses are built from the tax year summary and formatted for HMRC's Self Employment Business API. The computation lives in `src/lib/itsCumulativeUpdate.ts` (`buildCumulativePeriodSummary`) and is pure: the preview route loads the summary, calls it, and never does tax arithmetic itself. **Submission to HMRC is handled in STF-85 and not done here.**

## Quarter-end dates

Quarterly updates are due on fixed HMRC dates. Each tax year runs from 6 April to 5 April, and quarters end on:

| Quarter | End Date | Note |
|---------|----------|------|
| Q1 | 5 July | Same calendar year |
| Q2 | 5 October | Same calendar year |
| Q3 | 5 January | Following calendar year |
| Q4 | 5 April | Following calendar year |

The period always starts on 6 April (the tax year start) and cumulates up to the quarter end. See `src/lib/itsCumulativeUpdate.ts::quarterEndDate()`.

## Field mapping: STF categories to HMRC fields

The cumulative period payload is sent to HMRC's Self Employment Business API v5.0 at:
```
PUT /individuals/business/self-employment/{nino}/{businessId}/cumulative/{taxYear}
```

This URL pattern is from:
```
https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/self-employment-business-api
```

**Not yet verified against HMRC's live documentation.** The endpoint, version (v5.0, Accept header `application/vnd.hmrc.5.0+json`) and field names were written from the published spec without access to the docs page at build time, as the comment in `src/lib/hmrc/client.ts` says. STF-85 must re-check them before the first sandbox submission.

Income and expense categories map to HMRC's `CumulativePeriodSummary` type. The mapping is defined in `src/lib/itsCumulativeUpdate.ts::HMRC_EXPENSE_FIELD`.

| STF Category | HMRC Field | Notes |
|---|---|---|
| turnover | `periodIncome.turnover` | Sum of sales receipts ex VAT |
| other income | `periodIncome.other` | Grants, refunds, interest |
| cost-of-goods | `periodExpenses.costOfGoods` | Materials, stock costs |
| travel | `periodExpenses.carVanTravelExpenses` | Motor, fuel, public transport |
| premises | `periodExpenses.premisesRunningCosts` | Rent, rates, utilities |
| admin-office | `periodExpenses.adminCosts` | Stationery, software, telephone |
| advertising | `periodExpenses.advertisingCosts` | Marketing and promotion |
| professional-fees | `periodExpenses.professionalFees` | Accountant, solicitor, consultants |
| finance-costs | `periodExpenses.financeCharges` | Interest, bank charges |
| other-allowable | `periodExpenses.otherExpenses` | Uncategorised allowable spend |
| trading allowance | `periodAllowances.tradingIncomeAllowance` | Flat-rate replacement for expenses (see below) |

**Disallowable expenses and uncategorised accounts are never sent to HMRC.** They are omitted from the payload; the ledger simply does not contribute them. The mapping function filters them out.

## Allowance vs actual expenses

A self-employed trader may either:
- **Actual expenses:** Record and claim every category listed above
- **Trading allowance:** Claim a flat-rate allowance instead of itemised expenses

Only one method is sent per quarter. If `summary.expenseMethod` is `'allowance'`, the payload carries:
```json
{
  "periodDates": { "periodStartDate": "...", "periodEndDate": "..." },
  "periodIncome": { "turnover": "...", "other": "..." },
  "periodAllowances": { "tradingIncomeAllowance": "..." }
}
```

The `periodExpenses` field is entirely omitted. HMRC rejects a payload with both `periodAllowances` and `periodExpenses`, so the code chooses one or the other (never both).

## Currency and precision

All amounts are **integer pence** internally and converted to **pounds with two decimals** only when building the HMRC payload. The conversion uses string maths (no floating-point) to preserve exactness.

- `0 pence` → `"0.00"`
- `5 pence` → `"0.05"`
- `100 pence` → `"1.00"`
- `123456 pence` → `"1234.56"`
- `-5 pence` → `"-0.05"`

## Preview route: request and response

### Request: `POST /api/hmrc/its-cumulative-preview`

The route is defined in `api/hmrc/its-cumulative-preview.ts` and implemented in `api/_lib/itsCumulativePreview.ts`.

The route requires a signed-in user. No NINO or business ID are accepted from the request; both come from the signed-in user's Settings and HMRC connection.

**Request body:**
```json
{
  "taxYear": "2026-27",
  "quarter": 1
}
```

- `taxYear` (required): A four-digit tax year in the form `YYYY-YY`, e.g. `2026-27`. Must be a key in `src/lib/taxBands.ts` (i.e. a year with published HMRC tax bands).
- `quarter` (required): An integer 1, 2, 3 or 4 (the HMRC quarter within that tax year).

**Validation:**
- Both fields are required.
- `taxYear` must exist as a key in `TAX_BANDS` in `src/lib/taxBands.ts`.
- `quarter` must be one of the literal integers 1, 2, 3 or 4.
- Invalid input returns `400 BAD_REQUEST`.

### Response: `200 OK`

On success, returns a preview object with no HMRC call made and no state written (except the audit event):

```json
{
  "ok": true,
  "data": {
    "endpoint": {
      "method": "PUT",
      "url": "https://[test-]api.service.hmrc.gov.uk/individuals/business/self-employment/••••••56C/•••••••••••910/cumulative/2026-27",
      "sandbox": true
    },
    "body": {
      "periodDates": { "periodStartDate": "2026-04-06", "periodEndDate": "2026-07-05" },
      "periodIncome": { "turnover": "5000.00", "other": "50.00" },
      "periodExpenses": {
        "costOfGoods": "100.00",
        "carVanTravelExpenses": "250.00"
      }
    },
    "headers": {
      "Accept": "application/vnd.hmrc.5.0+json",
      "Content-Type": "application/json",
      "Authorization": "Bearer (hidden)"
    }
  }
}
```

The `endpoint.url` includes the NINO and business ID masked (bullets with only the last three characters of each shown, e.g. `••••••56C` for NINO `AB123456C`, via `maskNino()`, which is applied to both). The full credentials are never returned. `Authorization` reads `Bearer (hidden)` so callers can see the header was present but never access the token.

The `body` is the exact cumulative period summary that would be sent to HMRC. Its structure and fields are identical to the submission payload. See above for field names and rules.

### Error responses

| Status | Code | Condition |
|---|---|---|
| `400` | `BAD_REQUEST` | Invalid taxYear or quarter in the request |
| `401` | `UNAUTHORIZED` | No signed-in user (session missing) |
| `403` | `LIVE_MODE_REFUSED` | The server is in sandbox mode but the user chose live, or vice versa |
| `404` | `ITSA_DISABLED` | The server has `HMRC_ITSA_ENABLED !== 'true'` |
| `405` | `METHOD_NOT_ALLOWED` | HTTP method is not POST |
| `409` | `HMRC_NOT_CONNECTED` | HMRC is not connected (no OAuth token) |
| `409` | `ITS_SCOPE_MISSING` | HMRC token is missing the Income Tax scope; user must reconnect |
| `409` | `NO_BUSINESS_SELECTED` | No self-employment business is chosen in Settings |
| `409` | `NO_NINO` | The NINO is not recorded in Settings |

All error responses return:
```json
{
  "ok": false,
  "error": "Human-readable message",
  "code": "ERROR_CODE"
}
```

## Gating and mode rules

The preview route enforces the same gating as `api/hmrc/its-obligations.ts`:

1. **ITSA enabled:** `process.env.HMRC_ITSA_ENABLED === 'true'`. If false, returns `404 ITSA_DISABLED`.
2. **Mode check:** Both `process.env.HMRC_SANDBOX_MODE` and the user's opt-in in `users.hmrc_sandbox_mode` must match.
   - Both false (live) → preview uses live API endpoint
   - Both true (sandbox) → preview uses sandbox API endpoint
   - Mismatch → returns `403 LIVE_MODE_REFUSED`
3. **HMRC credentials:** OAuth token must be present and not expired.
4. **ITS scope:** The token must include both `read:self-assessment` and `write:self-assessment` scopes (checked by `lacksItsScope`, surfaced via `hmrcStore.status(userId).needsItsReconnect`).
5. **Business chosen:** `hmrcStore.status(userId).itsBusinessId` must not be null (user has selected a business in Settings).
6. **NINO stored:** `databaseTaxIdentifiersStore.get(userId).ninoEncrypted` must exist (user has entered their NINO in Settings).

No HMRC API call is made during these checks; they are local database reads and credential validation.

## Audit event

When a preview is generated, an audit event is written to the `auditEvents` table:

| Field | Value | Purpose |
|---|---|---|
| `userId` | From session | Who requested the preview |
| `action` | `its_update.previewed` | Preview was shown (not submitted) |
| `resourceType` | `its_cumulative_update` | This is an Income Tax quarterly update |
| `actorType` | `user` | The user themselves requested it |
| `metadata` | `{ taxYear, quarter, sandbox }` | Year, quarter and mode only |

The audit event is written by `api/_lib/itsCumulativePreview.ts::recordPreviewInDatabase()` before the response is returned, so even if the response is lost in transit, the event is recorded. The NINO, business ID, balances and headers are never logged (following DP-7 and DP-8: audit trails carry internal IDs, not personal data or tokens).

## Computation summary

1. Load the user's tax year summary from 6 April to the quarter end via `getTaxYearSummary(store, userId, { start, end })`.
2. Call `buildCumulativePeriodSummary(summary)` to map the summary to the HMRC cumulative period fields.
3. Return the endpoint details, the mapped body, and the headers (with the auth token masked).
4. Write an audit event recording the preview attempt, year, quarter and mode.
5. Return the response. No HMRC call is made.

The pure mapping function (`src/lib/itsCumulativeUpdate.ts::buildCumulativePeriodSummary`) is tested with:
- Every category mapped to its HMRC field
- Quarters with no activity (all zeros)
- Pence-to-pounds boundary cases (0, 5, 100, 123456 pence and negative values)
- The allowance method (sending a trading allowance in place of expenses)
- Disallowable and uncategorised amounts never appearing in the payload

## Submission flow

The submission workflow has two steps: confirm and submit. Both are gated by the same prerequisites as the preview (mode, credentials, business, NINO). The submission itself is irreversible on HMRC's side, so confirmation is a separate API call that computes and stores a snapshot before the user commits.

### Confirm request: `POST /api/hmrc/its-cumulative-confirm`

**Request body:**
```json
{
  "taxYear": "2026-27",
  "quarter": 1,
  "declaration": true
}
```

- `taxYear`, `quarter`: Same as preview (required, validated)
- `declaration`: Must be the literal boolean `true` — requires the user to tick a checkbox

**Response: `200 OK`**

Returns a confirmation snapshot:
```json
{
  "ok": true,
  "data": {
    "sandbox": true,
    "body": { "periodDates": { ... }, "periodIncome": { ... }, ... }
  }
}
```

The `body` is the computed cumulative period summary that will be sent to HMRC if the user submits.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| `400` | `BAD_REQUEST` | Invalid taxYear or quarter |
| `400` | `DECLARATION_REQUIRED` | declaration is not `true` |
| `401` | `UNAUTHORIZED` | No signed-in user |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No business chosen in Settings |
| `409` | `NO_NINO` | NINO not recorded in Settings |
| `409` | `ALREADY_SUBMITTED` | Period already confirmed or submitted in this session |

### Submit request: `POST /api/hmrc/its-cumulative-submit`

The period must be confirmed before submission. Submission sends the stored confirmation snapshot to HMRC and cannot be retried if HMRC's response is ambiguous.

**Request body:**
```json
{
  "taxYear": "2026-27",
  "quarter": 1,
  "confirm": true
}
```

- `taxYear`, `quarter`: Same as preview and confirm (required)
- `confirm`: Must be the literal boolean `true` — guards against accidental submission

**Validation:**
1. A confirmation must exist in status `confirmed` for this period and sandbox mode.
2. The stored confirmation body must match the current ledger (recomputed, compared).
3. The submission atomically moves the record to `pending` before touching HMRC (the claim).
4. If the claim fails (another request got there first), `409 ALREADY_SUBMITTED` is returned.

**Response: `200 OK`**

On success:
```json
{
  "ok": true,
  "data": { "sandbox": true }
}
```

**HMRC submission:**

The cumulative period summary is sent via PUT to HMRC's Self Employment Business API v5.0:

```
PUT https://[test-]api.service.hmrc.gov.uk/individuals/business/self-employment/{nino}/{businessId}/cumulative/{taxYear}
Accept: application/vnd.hmrc.5.0+json
Authorization: Bearer <access-token>
<fraud-prevention-headers>

{
  "periodDates": { "periodStartDate": "2026-04-06", "periodEndDate": "2026-07-05" },
  "periodIncome": { "turnover": "5000.00", "other": "50.00" },
  "periodExpenses": { ... }
}
```

HMRC returns no body on success (204 or 200 with empty response).

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| `400` | `BAD_REQUEST` | Invalid input |
| `400` | `DECLARATION_REQUIRED` | confirm is not `true` |
| `401` | `UNAUTHORIZED` | No signed-in user |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `405` | `METHOD_NOT_ALLOWED` | HTTP method is not POST |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No business chosen in Settings |
| `409` | `NO_NINO` | NINO not recorded in Settings |
| `409` | `NOT_CONFIRMED` | No confirmed submission exists |
| `409` | `STALE_CONFIRMATION` | Ledger changed since confirmation |
| `409` | `ALREADY_SUBMITTED` | Period already submitted (claim failed) |
| `502` | HMRC error code | HMRC rejected (4xx) or unknown outcome (5xx) |

### Status and lock lifecycle

The `its_submissions` table tracks each period's submission state per sandbox mode:

| Status | Meaning | Next steps |
|---|---|---|
| `confirmed` | Confirmation snapshot stored, awaiting submission | Submit, or confirm again to update |
| `pending` | Claimed for submission, HMRC call running | On success → `submitted`; on 4xx → `rejected`; on 5xx or network → stays `pending` |
| `submitted` | HMRC accepted the update, receipt recorded | Final state |
| `rejected` | HMRC rejected the submission (4xx error) | Confirm again to unlock and retry |

**Idempotency lock:**

Only one submission may proceed for a given `(user_id, tax_year, quarter, sandbox)` at a time. The unique constraint on these columns prevents duplicate confirmations. The claim operation (confirmed → pending) is atomic and returns false if another request claimed first.

### Rejection recovery

When HMRC returns a 4xx status (definite rejection), the record is moved to `rejected` status and the lock is released. The user must:

1. Review the HMRC error code and fix the submission (e.g., missing field, invalid value).
2. Confirm again via `/api/hmrc/its-cumulative-confirm` to recompute the payload and try a different submission.

This prevents infinite retry loops on definite validation failures.

### Unknown outcome recovery

If HMRC returns a 5xx status or the network times out, the record stays in `pending` status. The submission is not retried automatically; the user must:

1. Check HMRC's website or contact HMRC to verify whether the submission was accepted.
2. If accepted: the submission is recorded in `submitted` status (contact support or manually update the database).
3. If not accepted: the record remains `pending` and a new submission may be attempted; the unique constraint allows no duplicate filing for the same quarter.

The error `OUTCOME_UNKNOWN` is returned to the client with guidance: "Do not resubmit; check HMRC before trying again."

### Audit trail

Every status change is recorded as an audit event:

| Action | Condition |
|---|---|
| `its_update.confirmed` | User confirmed the submission |
| `its_update.submitted` | HMRC accepted and receipt recorded |
| `its_update.rejected` | HMRC rejected (4xx error) |

Each event includes:
- The user ID
- The submission ID
- A snapshot of the request and response (no tokens, no NINO)
- Fraud prevention headers
- The action timestamp

Submissions that hit unknown outcome (`5xx` or network) are not recorded as an action; the `pending` status marks the incomplete transition.

### Sandbox mode gating

Every submission is marked as `sandbox: true` or `sandbox: false` in the `its_submissions` table. Sandbox mode is determined at confirmation time by:

1. The server's `HMRC_SANDBOX_MODE` environment variable (default: sandbox)
2. The user's opt-in in `users.hmrc_sandbox_mode`

Both must agree; a mismatch returns `403 LIVE_MODE_REFUSED`. Live submissions (sandbox=false) require **both** the server environment flag AND the user's explicit opt-in in Settings. No automatic escalation to live is permitted.

## Integration test

The sandbox integration test in `src/lib/hmrc/sandbox.integration.test.ts` includes a live call to HMRC's sandbox API to verify the cumulative period submission endpoint. The test:

- Runs only when `HMRC_CLIENT_ID`, `HMRC_SANDBOX_NINO` and `HMRC_SANDBOX_REFRESH_TOKEN` are set (CI secrets).
- Verifies that the endpoint URL pattern, HTTP method (PUT), and API version (v5.0) match the HMRC Self Employment Business API.
- Submits a sample cumulative period and expects no error.
- Is skipped (not failed) when credentials are absent.
- Never reaches production: the test is always run in sandbox mode, regardless of `HMRC_SANDBOX_MODE`.

The test confirms that field names and structure match HMRC's live expectations before the first production filing.

## Test coverage

Tests are in:
- `src/lib/itsCumulativeUpdate.test.ts` — pure mapping, conversion, quarter end dates, allowance method
- `api/_lib/__tests__/itsCumulativePreview.test.ts` — preview logic, mode gating, prerequisites
- `api/_lib/__tests__/itsCumulativePreviewRoute.test.ts` — route handler, HTTP layer, authentication
- `api/_lib/__tests__/itsSubmit.test.ts` — confirm and submit logic, status transitions, idempotency lock, stale confirmation detection
- `src/lib/hmrc/sandbox.integration.test.ts` — live sandbox call to the cumulative PUT endpoint

---

# Income Tax annual allowances and adjustments submission

How a self-employed taxpayer's year-end allowances are sent to HMRC for the annual declaration. The builder lives in `src/lib/itsAnnualSubmission.ts` (`buildAnnualSubmission`) and is pure: the preview route loads the tax year summary, calls it, and never does tax arithmetic itself. **Submission follows the same confirm-and-submit pattern as STF-85 quarterly updates, reusing the idempotency lock and status lifecycle.**

## Endpoint and field mapping

The annual allowances are sent to HMRC's Self Employment Business API v5.0 at:
```
PUT /individuals/business/self-employment/{nino}/{businessId}/annual/{taxYear}
```

The same endpoint as quarterly updates, documented in:
```
https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/self-employment-business-api
```

**Not yet verified against HMRC's live documentation** for the annual endpoint. The builder was written from the published spec; before the first sandbox submission, verify that the endpoint and field names match the current HMRC API docs.

## Allowances vs adjustments

HMRC's annual submission carries two fields: `allowances` and `adjustments`. STF:
- **Never sends adjustments** — the user records neither inventory changes nor working-from-home adjustments; `adjustments` is always omitted
- **Sends an allowance only if claimed** — if the owner chose trading allowance, send `allowances.tradingIncomeAllowance`; otherwise omit the whole `allowances` field

Only one expense method is sent per tax year. If `summary.expenseMethod` is `'allowance'`, the payload is:
```json
{
  "allowances": {
    "tradingIncomeAllowance": "1000.00"
  }
}
```

If `summary.expenseMethod` is `'actual'`, the payload is:
```json
{}
```

The allowance value comes from the current tax year's HMRC-published trading allowance in `src/lib/taxBands.ts`. For 2026-27, it is £1,000 (100,000 pence).

## Currency and precision

Amounts are converted identically to quarterly updates: **integer pence** internally, **pounds with two decimals** in the HMRC payload, using string maths (never floating-point).

## Preview route: request and response

### Request: `POST /api/hmrc/its-annual-preview`

The route is defined in `api/hmrc/its-annual-preview.ts` and implemented in `api/_lib/itsAnnualSubmit.ts`.

The route requires a signed-in user. No NINO or business ID are accepted from the request; both come from the signed-in user's Settings and HMRC connection.

**Request body:**
```json
{
  "taxYear": "2026-27"
}
```

- `taxYear` (required): A four-digit tax year in the form `YYYY-YY`, e.g. `2026-27`. Must be a key in `src/lib/taxBands.ts`.

**Validation:**
- `taxYear` is required.
- `taxYear` must exist as a key in `TAX_BANDS`.
- Invalid input returns `400 BAD_REQUEST`.

### Response: `200 OK`

On success, returns a preview object with no HMRC call made and no state written (except the audit event):

```json
{
  "ok": true,
  "data": {
    "endpoint": {
      "method": "PUT",
      "url": "https://[test-]api.service.hmrc.gov.uk/individuals/business/self-employment/••••••56C/•••••••••••910/annual/2026-27",
      "sandbox": true
    },
    "body": {
      "allowances": {
        "tradingIncomeAllowance": "1000.00"
      }
    },
    "headers": {
      "Accept": "application/vnd.hmrc.5.0+json",
      "Content-Type": "application/json",
      "Authorization": "Bearer (hidden)"
    }
  }
}
```

The `endpoint.url` includes the NINO and business ID masked (bullets with only the last three characters shown). The full credentials are never returned. `Authorization` reads `Bearer (hidden)`.

The `body` is the exact allowances payload that would be sent to HMRC. Its structure and fields are identical to the submission payload. If the owner chose actual expenses, `body` is an empty object `{}`.

### Error responses

Same as quarterly preview gating (ITSA disabled, live mode mismatch, HMRC not connected, ITS scope missing, no business selected, no NINO):

| Status | Code | Condition |
|---|---|---|
| `400` | `BAD_REQUEST` | Invalid taxYear in the request |
| `401` | `UNAUTHORIZED` | No signed-in user (session missing) |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `405` | `METHOD_NOT_ALLOWED` | HTTP method is not POST |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No self-employment business chosen in Settings |
| `409` | `NO_NINO` | The NINO is not recorded in Settings |

## Gating and mode rules

Identical to quarterly preview (ITSA enabled, mode check, credentials, ITS scope, business, NINO). No HMRC API call is made during these checks.

## Audit event

When a preview is generated, an audit event is written to the `auditEvents` table:

| Field | Value | Purpose |
|---|---|---|
| `userId` | From session | Who requested the preview |
| `action` | `its_annual.previewed` | Preview was shown (not submitted) |
| `resourceType` | `its_annual_submission` | This is an Income Tax annual submission |
| `actorType` | `user` | The user themselves requested it |
| `metadata` | `{ taxYear, sandbox }` | Year and mode only |

## Confirmation flow

### Confirm request: `POST /api/hmrc/its-annual-confirm`

**Request body:**
```json
{
  "taxYear": "2026-27",
  "declaration": true
}
```

- `taxYear` (required): Same as preview, validated
- `declaration`: Must be the literal boolean `true` — requires the user to tick a checkbox

**Response: `200 OK`**

Returns a confirmation snapshot:
```json
{
  "ok": true,
  "data": {
    "sandbox": true,
    "body": { "allowances": { "tradingIncomeAllowance": "1000.00" } }
  }
}
```

The `body` is the computed allowances payload that will be sent to HMRC if the user submits.

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| `400` | `BAD_REQUEST` | Invalid taxYear |
| `400` | `DECLARATION_REQUIRED` | declaration is not `true` |
| `401` | `UNAUTHORIZED` | No signed-in user |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No business chosen in Settings |
| `409` | `NO_NINO` | NINO not recorded in Settings |
| `409` | `ALREADY_SUBMITTED` | Period already confirmed or submitted in this session |

## Submission flow

Identical to quarterly submit: the period must be confirmed before submission, the stored confirmation snapshot is sent, and the stored confirmation is recomputed and verified to match the current ledger.

### Submit request: `POST /api/hmrc/its-annual-submit`

**Request body:**
```json
{
  "taxYear": "2026-27",
  "confirm": true
}
```

- `taxYear` (required): Same as confirm
- `confirm`: Must the literal boolean `true` — guards against accidental submission

**Validation:**
1. A confirmation must exist in status `confirmed` for this tax year and sandbox mode.
2. The stored confirmation body must match the current ledger (recomputed, compared).
3. The submission atomically moves the record to `pending` before touching HMRC (the idempotency lock).
4. If the claim fails (another request got there first), `409 ALREADY_SUBMITTED` is returned.

**Response: `200 OK`**

On success:
```json
{
  "ok": true,
  "data": { "sandbox": true }
}
```

**HMRC submission:**

The allowances payload is sent via PUT to HMRC's Self Employment Business API v5.0:

```
PUT https://[test-]api.service.hmrc.gov.uk/individuals/business/self-employment/{nino}/{businessId}/annual/{taxYear}
Accept: application/vnd.hmrc.5.0+json
Authorization: Bearer <access-token>
<fraud-prevention-headers>

{
  "allowances": {
    "tradingIncomeAllowance": "1000.00"
  }
}
```

HMRC returns no body on success (204 or 200 with empty response).

**Error responses:**

| Status | Code | Condition |
|---|---|---|
| `400` | `BAD_REQUEST` | Invalid input |
| `400` | `DECLARATION_REQUIRED` | confirm is not `true` |
| `401` | `UNAUTHORIZED` | No signed-in user |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No business chosen in Settings |
| `409` | `NO_NINO` | NINO not recorded in Settings |
| `409` | `NOT_CONFIRMED` | No confirmed submission exists |
| `409` | `STALE_CONFIRMATION` | Ledger changed since confirmation |
| `409` | `ALREADY_SUBMITTED` | Period already submitted (claim failed) |
| `502` | HMRC error code | HMRC rejected (4xx) or unknown outcome (5xx) |

## Status and lock lifecycle

The `its_annual_submissions` table tracks each tax year's submission state per sandbox mode:

| Status | Meaning | Next steps |
|---|---|---|
| `confirmed` | Confirmation snapshot stored, awaiting submission | Submit, or confirm again to update |
| `pending` | Claimed for submission, HMRC call running | On success → `submitted`; on 4xx → `rejected`; on 5xx or network → stays `pending` |
| `submitted` | HMRC accepted the submission, receipt recorded | Final state |
| `rejected` | HMRC rejected the submission (4xx error) | Confirm again to unlock and retry |

**Idempotency lock:**

Only one submission may proceed for a given `(user_id, tax_year, sandbox)` at a time. The unique constraint on these columns prevents duplicate confirmations. The claim operation (confirmed → pending) is atomic and returns false if another request claimed first.

## Rejection recovery

Identical to quarterly updates. When HMRC returns a 4xx status, the record is moved to `rejected` and the lock is released. The user must confirm again to recompute and retry.

## Unknown outcome recovery

Identical to quarterly updates. If HMRC returns a 5xx status or the network times out, the record stays in `pending`. The user must check HMRC before attempting a new submission.

## Audit trail

Every status change is recorded as an audit event:

| Action | Condition |
|---|---|
| `its_annual.confirmed` | User confirmed the submission |
| `its_annual.submitted` | HMRC accepted and receipt recorded |
| `its_annual.rejected` | HMRC rejected (4xx error) |

Each event includes the user ID, submission ID, a snapshot of the request and response (no tokens, no NINO), fraud prevention headers, and the timestamp. Submissions that hit unknown outcome are not recorded as an action; the `pending` status marks the incomplete transition.

## Sandbox mode gating

Identical to quarterly updates: both `process.env.HMRC_SANDBOX_MODE` and the user's opt-in in `users.hmrc_sandbox_mode` must match. Live submissions require **both** the server environment flag AND the user's explicit opt-in. No automatic escalation to live is permitted.

## Trading allowance rule

The trading allowance is determined by the owner's expense method choice (STF-31, set in Settings):

- **If `expenseMethod` is `'allowance'`:** The annual submission sends the current tax year's HMRC trading allowance amount (e.g. £1,000 for 2026-27, from `TAX_BANDS[taxYear].tradingAllowancePence`).
- **If `expenseMethod` is `'actual'`:** No allowance is sent; the `allowances` field is omitted from the payload.

The allowance amount never comes from user input or quarterly records — it is always the tax-year-specific HMRC-published value. This ensures HMRC's expectations match STF's submission regardless of what the owner has recorded in quarterly updates.

## Guided year-end flow

The annual submission is part of the Income Tax year-end guided flow, accessible from:

- **Tax page link** (current): A link on `src/pages/TaxPage.tsx` takes the user to the year-end flow
- **Home to-do item** (future): Once the home to-do list is built, a to-do item will launch the flow

The flow (`src/pages/YearEndFlow.tsx`) is a multi-step guided process:
1. Display the tax year summary (income, expenses, net profit, or loss)
2. Display allowances and the trading allowance choice
3. Show the annual submission payload in plain language
4. Ask for confirmation (the declaration tick)
5. Send to HMRC and show the result

The flow reuses the same preview, confirm, and submit routes as the programmatic API. All gating, locking, and audit rules are identical.

## Computation summary

1. Load the user's tax year summary via `getTaxYearSummary()`.
2. Call `buildAnnualSubmission(summary)` to map the summary to the allowances field.
3. Return the endpoint details, the mapped body, and the headers (with the auth token masked).
4. Write an audit event recording the preview attempt, year and mode.
5. On confirmation, recompute the body and store it atomically with the status change.
6. On submission, verify the stored confirmation still matches the ledger, claim the lock, and send to HMRC.
7. Record the outcome (submitted, rejected, or unknown) as an audit event and a status change.

The pure builder function is tested with:
- Trading allowance method (sends allowance from `TAX_BANDS`)
- Actual expenses method (sends empty object)
- Pence-to-pounds boundary cases

## Test coverage

Tests are in:
- `src/lib/itsAnnualSubmission.test.ts` — pure builder, allowance method, expense method
- `api/_lib/__tests__/itsAnnualSubmit.test.ts` — confirm and submit logic, status transitions, idempotency lock, stale confirmation detection
- `api/_lib/__tests__/itsAnnualSubmitRoute.test.ts` — route handler, HTTP layer, authentication
