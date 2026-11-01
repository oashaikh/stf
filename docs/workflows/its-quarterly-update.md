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

**Confirmed at build time: Self Employment Business API v5.0 (Accept header `application/vnd.hmrc.5.0+json`).**

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
- `−5 pence` → `"−0.05"`

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
- `taxYear` must exist in `TAX_BANDS` (lines 1–5).
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
      "url": "https://[test-]api.service.hmrc.gov.uk/individuals/business/self-employment/*AA*A/XAIS12345678910/cumulative/2026-27",
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

The `endpoint.url` includes the NINO and business ID masked (showing only the last character of each, e.g. `*AA*A` for NINO `AA123456A` and similar for the business ID, via `maskNino()`). The full credentials are never returned. `Authorization` reads `Bearer (hidden)` so callers can see the header was present but never access the token.

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
4. **ITS scope:** The token must include `read:self-assessment` scope (confirmed via `hmrcStore.status(userId).needsItsReconnect`).
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

## Submission

**Submission to HMRC is handled in STF-85.** This ticket builds and previews only. The submission flow (claiming the period, sending the payload to HMRC, recording the receipt and handling errors) is a separate ticket and is not done here. Both the preview and submission share the same mapping function, so this ticket is a complete and testable building block for submission.

## Test coverage

Tests are in:
- `src/lib/itsCumulativeUpdate.test.ts` — pure mapping, conversion, quarter end dates, allowance method
- `api/_lib/__tests__/itsCumulativePreview.test.ts` — preview logic, mode gating, prerequisites
- `api/_lib/__tests__/itsCumulativePreviewRoute.test.ts` — route handler, HTTP layer, authentication
