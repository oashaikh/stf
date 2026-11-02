# UK property annual allowances and adjustments submission

How a rental property owner's year-end allowances are sent to HMRC for the annual declaration. The builder lives in `src/lib/itsAnnualSubmission.ts` (`buildPropertyAnnualSubmission`) and is pure: the preview route loads the property summary, calls it, and never does tax arithmetic itself. **Submission follows the same confirm-and-submit pattern as quarterly updates, reusing the idempotency lock and status lifecycle.**

## Endpoint and field mapping

The annual property allowances are sent to HMRC's Property Business API v6 at:
```
PUT /individuals/business/property/uk/{nino}/{businessId}/annual/{taxYear}
```

The endpoint is documented in:
```
https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/property-business-api
```

**Not yet verified against HMRC's live documentation** for the annual endpoint. The builder was written from the published spec; before the first sandbox submission, verify that the endpoint and field names match the current HMRC API docs.

## Allowance choice and amounts

A UK property owner may either:
- **Property allowance:** Claim a flat-rate £1,000 annual allowance (the current HMRC published amount) instead of itemised expenses
- **Actual expenses:** Claim the itemised costs they have recorded (repairs, maintenance, premises running costs, finance costs, professional fees, travel costs, cost of services, and other)

Only one method is sent per tax year. If the owner chose the property allowance and it does not exceed their rental income:
```json
{
  "ukProperty": {
    "allowances": {
      "propertyIncomeAllowance": 1000.0
    }
  }
}
```

If the owner chose actual expenses, the payload is:
```json
{
  "ukProperty": {}
}
```

The allowance amount is always the tax-year-specific HMRC-published value from `src/lib/taxBands.ts` (e.g. £1,000 for 2026-27). It never comes from user input or quarterly records. If the owner has zero rental income, no allowance is sent.

## Currency and precision

Amounts are converted identically to quarterly updates: **integer pence** internally, **pounds with two decimals** in the HMRC payload, using string maths (never floating-point).

## Preview route: request and response

### Request: `POST /api/hmrc/its-annual-preview`

The route is defined in `api/hmrc/its-annual-preview.ts` and implemented in `api/_lib/itsAnnualSubmit.ts`.

The route requires a signed-in user. No NINO or business ID are accepted from the request; both come from the signed-in user's Settings and HMRC connection.

**Request body:**
```json
{
  "taxYear": "2026-27",
  "business": "uk-property",
  "choice": "allowance"
}
```

- `taxYear` (required): A four-digit tax year in the form `YYYY-YY`, e.g. `2026-27`. Must be a key in `src/lib/taxBands.ts`.
- `business` (optional): `"uk-property"` for property annual submission. Defaults to `"self-employment"` if omitted.
- `choice` (required for property): `"allowance"` or `"actual"`. For property businesses, the choice must be explicitly provided and validated.

**Validation:**
- `taxYear` is required and must exist as a key in `TAX_BANDS`.
- For property, `choice` must be `"allowance"` or `"actual"`.
- Invalid input returns `400 BAD_REQUEST`.

### Response: `200 OK`

On success, returns a preview object with no HMRC call made and no state written (except the audit event):

```json
{
  "ok": true,
  "data": {
    "endpoint": {
      "method": "PUT",
      "url": "https://[test-]api.service.hmrc.gov.uk/individuals/business/property/uk/••••••56C/•••••••••••910/annual/2026-27",
      "sandbox": true
    },
    "body": {
      "ukProperty": {
        "allowances": {
          "propertyIncomeAllowance": 1000.0
        }
      }
    },
    "headers": {
      "Accept": "application/vnd.hmrc.6.0+json",
      "Content-Type": "application/json",
      "Authorization": "Bearer (hidden)"
    }
  }
}
```

The `endpoint.url` includes the NINO and business ID masked (bullets with only the last three characters shown). The full credentials are never returned. `Authorization` reads `Bearer (hidden)`.

The `body` is the exact allowances payload that would be sent to HMRC. If the owner chose actual expenses, `body.ukProperty` is an empty object `{}`.

### Error responses

Same as quarterly preview gating (ITSA disabled, live mode mismatch, HMRC not connected, ITS scope missing, no business selected, no NINO):

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `BAD_REQUEST` | Invalid taxYear, business or choice in the request |
| `401` | `UNAUTHORIZED` | No signed-in user (session missing) |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `405` | `METHOD_NOT_ALLOWED` | HTTP method is not POST |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No UK property business chosen in Settings |
| `409` | `NO_NINO` | The NINO is not recorded in Settings |

## Gating and mode rules

Identical to quarterly preview (ITSA enabled, mode check, credentials, ITS scope, business, NINO). No HMRC API call is made during these checks. For property, the business must be of type `uk-property`.

## Audit event

When a preview is generated, an audit event is written to the `auditEvents` table:

| Field | Value | Purpose |
|-------|-------|---------|
| `userId` | From session | Who requested the preview |
| `action` | `its_annual.previewed` | Preview was shown (not submitted) |
| `resourceType` | `its_annual_submission` | This is an Income Tax annual submission |
| `actorType` | `user` | The user themselves requested it |
| `metadata` | `{ taxYear, sandbox, business: "uk-property" }` | Year, mode and business kind |

## Confirmation flow

### Confirm request: `POST /api/hmrc/its-annual-confirm`

**Request body:**
```json
{
  "taxYear": "2026-27",
  "business": "uk-property",
  "choice": "allowance",
  "declaration": true
}
```

- `taxYear` (required): Same as preview, validated
- `business` (optional): `"uk-property"`. Defaults to `"self-employment"`.
- `choice` (required for property): `"allowance"` or `"actual"`
- `declaration`: Must be the literal boolean `true` — requires the user to tick a checkbox

**Response: `200 OK`**

Returns a confirmation snapshot:
```json
{
  "ok": true,
  "data": {
    "sandbox": true,
    "body": { "ukProperty": { "allowances": { "propertyIncomeAllowance": 1000.0 } } }
  }
}
```

The `body` is the computed allowances payload that will be sent to HMRC if the user submits.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `BAD_REQUEST` | Invalid taxYear, business, or choice |
| `400` | `DECLARATION_REQUIRED` | declaration is not `true` |
| `401` | `UNAUTHORIZED` | No signed-in user |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No property business chosen in Settings |
| `409` | `NO_NINO` | NINO not recorded in Settings |
| `409` | `ALREADY_SUBMITTED` | Period already confirmed or submitted in this session |

## Submission flow

Identical to quarterly submit: the period must be confirmed before submission, the stored confirmation snapshot is sent, and the stored confirmation is recomputed and verified to match the current ledger.

### Submit request: `POST /api/hmrc/its-annual-submit`

**Request body:**
```json
{
  "taxYear": "2026-27",
  "business": "uk-property",
  "confirm": true
}
```

- `taxYear` (required): Same as confirm
- `business` (optional): Same as confirm
- `confirm`: Must the literal boolean `true` — guards against accidental submission

**Validation:**
1. A confirmation must exist in status `confirmed` for this tax year, business kind, and sandbox mode.
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

The allowances payload is sent via PUT to HMRC's Property Business API v6:

```
PUT https://[test-]api.service.hmrc.gov.uk/individuals/business/property/uk/{nino}/{businessId}/annual/{taxYear}
Accept: application/vnd.hmrc.6.0+json
Authorization: Bearer <access-token>
<fraud-prevention-headers>

{
  "ukProperty": {
    "allowances": {
      "propertyIncomeAllowance": 1000.0
    }
  }
}
```

HMRC returns no body on success (204 or 200 with empty response).

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `BAD_REQUEST` | Invalid input |
| `400` | `DECLARATION_REQUIRED` | confirm is not `true` |
| `401` | `UNAUTHORIZED` | No signed-in user |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | HMRC Income Tax not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC credentials missing |
| `409` | `ITS_SCOPE_MISSING` | OAuth token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No property business chosen |
| `409` | `NO_NINO` | NINO not recorded |
| `409` | `NOT_CONFIRMED` | No confirmed submission exists |
| `409` | `STALE_CONFIRMATION` | Ledger changed since confirmation |
| `409` | `ALREADY_SUBMITTED` | Period already submitted (claim failed) |
| `502` | HMRC error code | HMRC rejected (4xx) or unknown outcome (5xx) |

## Status and lock lifecycle

The `its_annual_submissions` table tracks each tax year's submission state per business kind and sandbox mode. The unique key is `(user_id, tax_year, sandbox, business_kind)`:

| Status | Meaning | Next steps |
|--------|---------|-----------|
| `confirmed` | Confirmation snapshot stored, awaiting submission | Submit, or confirm again to update |
| `pending` | Claimed for submission, HMRC call running | On success → `submitted`; on 4xx → `rejected`; on 5xx or network → stays `pending` |
| `submitted` | HMRC accepted the submission, receipt recorded | Final state |
| `rejected` | HMRC rejected the submission (4xx error) | Confirm again to unlock and retry |

**Idempotency lock:**

Only one submission may proceed for a given `(user_id, tax_year, sandbox, business_kind)` at a time. The unique constraint on these columns prevents duplicate confirmations. The claim operation (confirmed → pending) is atomic and returns false if another request claimed first.

## Rejection recovery

Identical to quarterly updates. When HMRC returns a 4xx status, the record is moved to `rejected` and the lock is released. The user must confirm again to recompute and retry.

## Unknown outcome recovery

Identical to quarterly updates. If HMRC returns a 5xx status or the network times out, the record stays in `pending`. The user must check HMRC before attempting a new submission.

## Audit trail

Every status change is recorded as an audit event:

| Action | Condition |
|--------|-----------|
| `its_annual.confirmed` | User confirmed the submission |
| `its_annual.submitted` | HMRC accepted and receipt recorded |
| `its_annual.rejected` | HMRC rejected (4xx error) |

Each event includes the user ID, submission ID, a snapshot of the request and response (no tokens, no NINO), fraud prevention headers, and the timestamp. Submissions that hit unknown outcome are not recorded as an action; the `pending` status marks the incomplete transition.

## Sandbox mode gating

Identical to quarterly updates: both `process.env.HMRC_SANDBOX_MODE` and the user's opt-in in `users.hmrc_sandbox_mode` must match. Live submissions require **both** the server environment flag AND the user's explicit opt-in. No automatic escalation to live is permitted.

## Guided year-end flow

The annual property submission is part of the Income Tax year-end guided flow, accessible from:

- **Tax page link** (current): A link on `src/pages/TaxPage.tsx` takes the user to the year-end flow
- **Home to-do item** (future): Once the home to-do list is built, a to-do item will launch the flow

The flow (`src/pages/YearEndFlow.tsx`) shows one thing per screen, with "Step N of M", Back and Save and leave:
1. A summary of rental income and costs for the year
2. A choice between the property allowance (flat £1,000) and claiming actual costs
3. Check and send: one sentence on what will be sent, the declaration tick (which confirms the figures), and the Send to HMRC button

The step number is kept in the browser per tax year, so Save and leave and coming back resumes at the same step. The figures are rebuilt from the books on return, and the declaration has to be ticked again.

The flow reuses the same preview, confirm, and submit routes as the programmatic API. All gating, locking, and audit rules are identical.

## Computation summary

1. Load the user's property summary via `getPropertySummary()`.
2. Call `buildPropertyAnnualSubmission(summary, choice, taxYear)` to map the summary and the owner's choice to the allowances field.
3. Return the endpoint details, the mapped body, and the headers (with the auth token masked).
4. On confirmation, recompute the body and store it atomically with the status change.
5. On submission, verify the stored confirmation still matches the ledger, claim the lock, and send to HMRC.
6. Record the outcome (submitted, rejected, or unknown) as an audit event and a status change.

The pure builder function is tested with:
- Allowance choice with rental income above and below £1,000
- Actual expenses choice (sends empty object)
- Zero rental income (sends no allowance)
- Pence-to-pounds boundary cases

## Test coverage

Tests are in:
- `src/lib/itsAnnualSubmission.test.ts` — pure builder, property choice, allowance method
- `api/_lib/__tests__/itsAnnualSubmit.test.ts` — confirm and submit logic, status transitions, idempotency lock, stale confirmation detection, business kind filtering
- `api/_lib/__tests__/itsAnnualSubmitRoute.test.ts` — route handler, HTTP layer, authentication
- `src/lib/hmrc/sandbox.integration.test.ts` — live sandbox call to the annual PUT endpoint
