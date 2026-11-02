# Income Tax final declaration workflow

How a self-employed taxpayer declares their final tax position to HMRC at the end of the tax year. HMRC calculates the total tax and National Insurance due; the owner reviews it, ticks a confirmation, and submits. The calculation request, response handling, and comparison logic all live in `src/lib/finalDeclaration.ts` (pure) and `api/_lib/itsFinalDeclaration.ts` (route logic). Submission through the Self Assessment API is irreversible in most cases.

## The calculation and submission flow

The final declaration is triggered on a chosen tax year:

1. **Trigger:** `POST /api/hmrc/its-final-preview` with `{ taxYear: "2026-27" }` asks HMRC to calculate the full-year tax and National Insurance for the owner's self-employment and all other income.
2. **HMRC calculation:** HMRC runs the Individual Calculations API, takes the owner's recorded earnings and allowances (quarterly cumulative updates + annual allowances, plus any other income they have entered elsewhere), and returns:
   - `calculationId` — a unique identifier for this calculation
   - `incomeTaxPence` — total income tax due
   - `class2NicPence` — Class 2 National Insurance (fixed amount if self-employed)
   - `class4NicPence` — Class 4 National Insurance (profits-based)
   - `totalPence` — the sum
3. **STF estimate shown alongside:** The owner sees STF's own estimate (built from the transactions and allowances recorded in STF) next to HMRC's figures. Any difference is flagged. This matters because STF only knows about self-employment income and allowances recorded in STF; if the owner has employment, property, pension contributions, or other income sources, HMRC's figure includes those and will differ from STF's estimate.
4. **Confirmation:** The owner ticks a declaration stating "I declare that the information I have given on this return is correct and complete to the best of my knowledge." (exact HMRC wording). `POST /api/hmrc/its-final-confirm` stores the calculation ID and the tick timestamp.
5. **Submission:** Once confirmed, `POST /api/hmrc/its-final-submit` sends the final declaration to HMRC using the stored calculation ID. HMRC acknowledges receipt. The submission is irreversible on HMRC's side for most years.

## Non-self-employment income: open question

**This workflow does not cover non-self-employment income.** STF records only self-employment transactions and certain allowances (trading allowance, capital allowance). The owner may have:
- Employment income (salary, wages)
- Savings interest
- Dividend income
- Property rental income
- Pension contributions (which reduce taxable income)
- Personal savings allowance adjustments
- Adjusted Net Income thresholds

All of these affect the final tax figure HMRC calculates. When HMRC's figure differs significantly from STF's estimate, it is usually because the owner has other income sources STF does not know about.

**STF 1.0 does not provide a way to enter these.** Future work (blocked on the open question in the ticket) should consider whether to:
1. Add input fields for other income in Settings or a dedicated screen
2. Provide guidance showing the owner how to verify their submission on HMRC's own site (MyAccount)
3. Link to the HMRC Self Assessment manual return as a fallback

For now, the final declaration shows STF's own estimate clearly marked as such, flagging any difference from HMRC, so the owner can investigate.

## Database

The `its_final_declarations` table is the source of truth for each final declaration. One row per (user_id, tax_year, sandbox) combination, with a unique constraint enforcing idempotency.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `user_id` | UUID | Owner |
| `tax_year` | text | e.g. '2026-27' |
| `sandbox` | boolean | Sandbox or live |
| `status` | enum | 'confirmed', 'pending', 'submitted', 'rejected' |
| `hmrc_calculation_id` | text | Unique ID returned by HMRC for this calculation |
| `income_tax_pence` | integer | HMRC's calculated income tax |
| `class2_nic_pence` | integer | HMRC's Class 2 NI (fixed; usually 150 pence per week × weeks self-employed) |
| `class4_nic_pence` | integer | HMRC's Class 4 NI (profits-based, 8–9% of profits) |
| `total_pence` | integer | Sum of above three |
| `declaration_confirmed_at` | timestamp | When the owner ticked the declaration |
| `hmrc_correlation_id` | text | HMRC's request id on successful filing |
| `submitted_at` | timestamp | When the submission was acknowledged |
| `created_at`, `updated_at` | timestamp | Record lifecycle |

## Status lifecycle

| Status | Meaning | Next steps |
|--------|---------|-----------|
| `confirmed` | Owner ticked the declaration; awaiting submission | Submit, or confirm again to re-check HMRC's latest figures |
| `pending` | Submission claimed and sent to HMRC; outcome unknown | On success → `submitted`; on 4xx → `rejected`; on 5xx or network → stays `pending` |
| `submitted` | HMRC accepted the declaration; receipt recorded | Final state; no further action |
| `rejected` | HMRC rejected the submission (4xx error, e.g. invalid data) | Confirm again to re-trigger the calculation and resubmit |

## Annual figures gate

Before the calculation is requested, every business the owner has (self-employment and UK property) must have its annual figures submitted for that tax year and sandbox mode. This ensures HMRC has the complete year-end allowances before calculating the final tax.

The preview, confirm, and submit routes each check that every business with a stored ID has a submitted annual submission record (confirmed, pending or rejected rows do not count). The check is a single query on the unique key `(user_id, tax_year, sandbox, business_kind)`. If any business is missing:
- Return `409 ANNUAL_FIGURES_MISSING`
- Name the missing business in plain words (e.g. "self-employment" or "UK property")
- Point to the year-end flow: "You need to complete the annual figures for [business] first. Go back to your tax year-end."
- Make no further call to HMRC

A property-only user sees only the property check. A self-employment-only user sees only the self-employment check. A user with both sees both checks.

## Routes and gating

All three routes are gated by the same prerequisites as the quarterly update and annual submission (ITSA enabled, mode check, HMRC credentials, ITS scope, business chosen, NINO stored), plus the annual figures gate. No HMRC API call is made during these checks — all are local database reads and credential validation.

### Preview route: `POST /api/hmrc/its-final-preview`

Asks HMRC to calculate the year; nothing is stored or filed.

**Request:**
```json
{
  "taxYear": "2026-27"
}
```

- `taxYear` (required): Four-digit format, must exist in `src/lib/taxBands.ts`

**Response: `200 OK`**

```json
{
  "ok": true,
  "data": {
    "sandbox": true,
    "calculationId": "12345678-1234-1234-1234-123456789012",
    "hmrc": {
      "incomeTaxPence": 250000,
      "class2NicPence": 16500,
      "class4NicPence": 80000,
      "totalPence": 346500
    },
    "stfEstimate": {
      "incomeTaxPence": 240000,
      "class2NicPence": 16500,
      "class4NicPence": 75000,
      "totalPence": 331500
    },
    "comparison": {
      "incomeTaxDifferencePence": 10000,
      "nicDifferencePence": 5000,
      "totalDifferencePence": 15000,
      "differs": true
    },
    "declarationWording": "I declare that the information I have given on this return is correct and complete to the best of my knowledge."
  }
}
```

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `BAD_REQUEST` | Invalid taxYear |
| `401` | `UNAUTHORIZED` | Not signed in |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | Income Tax API not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC OAuth token missing |
| `409` | `ITS_SCOPE_MISSING` | Token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No business chosen in Settings |
| `409` | `NO_NINO` | NINO not recorded in Settings |
| `502` | `HMRC_UNAVAILABLE` | HMRC calculation failed |

The `comparison` object shows HMRC's figures minus STF's estimate. A positive difference means HMRC says the owner owes more. The `differs` flag is true if any of the three differences is nonzero.

### Confirm route: `POST /api/hmrc/its-final-confirm`

Stores the calculation and the owner's tick of the declaration. The figures are re-read from HMRC by calculation ID, not taken from the client.

**Request:**
```json
{
  "taxYear": "2026-27",
  "calculationId": "12345678-1234-1234-1234-123456789012",
  "declaration": true
}
```

- `taxYear`: Same as preview, validated
- `calculationId`: The ID returned by the preview, validated as alphanumeric + hyphens (1–64 chars)
- `declaration`: Must be the literal boolean `true` — requires the user to tick the checkbox

**Response: `200 OK`**

```json
{
  "ok": true,
  "data": {
    "sandbox": true,
    "hmrc": {
      "incomeTaxPence": 250000,
      "class2NicPence": 16500,
      "class4NicPence": 80000,
      "totalPence": 346500
    }
  }
}
```

Returns the HMRC figures that were re-read and stored.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `BAD_REQUEST` | Invalid taxYear or calculationId format, or declaration is not `true` |
| `401` | `UNAUTHORIZED` | Not signed in |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | Income Tax API not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC OAuth token missing |
| `409` | `ITS_SCOPE_MISSING` | Token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No business chosen in Settings |
| `409` | `NO_NINO` | NINO not recorded in Settings |
| `409` | `ALREADY_SUBMITTED` | Already confirmed or submitted for this year |
| `502` | `HMRC_UNAVAILABLE` | HMRC lookup failed (calculation ID not found, or HMRC error) |

**Idempotency:** Re-confirming with the same tax year and sandbox mode replaces any earlier confirmation or rejection. Only one confirmation can be pending or submitted at a time per (user_id, tax_year, sandbox).

### Submit route: `POST /api/hmrc/its-final-submit`

Sends the final declaration to HMRC using the stored calculation ID. The declaration must be confirmed first.

**Request:**
```json
{
  "taxYear": "2026-27",
  "confirm": true
}
```

- `taxYear`: Same as preview and confirm
- `confirm`: Must be the literal boolean `true` — guards against accidental submission

**Response: `200 OK`**

```json
{
  "ok": true,
  "data": {
    "sandbox": true
  }
}
```

The submission is accepted by HMRC and cannot be reversed.

**Error responses:**

| Status | Code | Condition |
|--------|------|-----------|
| `400` | `BAD_REQUEST` | Invalid taxYear, or confirm is not `true` |
| `401` | `UNAUTHORIZED` | Not signed in |
| `403` | `LIVE_MODE_REFUSED` | Sandbox mode mismatch |
| `404` | `ITSA_DISABLED` | Income Tax API not enabled |
| `409` | `HMRC_NOT_CONNECTED` | HMRC OAuth token missing |
| `409` | `ITS_SCOPE_MISSING` | Token lacks Income Tax scope |
| `409` | `NO_BUSINESS_SELECTED` | No business chosen |
| `409` | `NO_NINO` | NINO not recorded |
| `409` | `NOT_CONFIRMED` | No confirmed declaration exists (must confirm before submit) |
| `409` | `ALREADY_SUBMITTED` | Already submitted (claim failed) |
| `502` | HMRC's own code | HMRC rejected the declaration (4xx). The owner has to tick again |
| `502` | `HMRC_UNAVAILABLE` | The token refresh failed before anything was sent. The lock is released and the owner can retry |
| `502` | `OUTCOME_UNKNOWN` | HMRC returned 5xx or network failure; outcome is ambiguous |

**Outcome unknown recovery:** If the response is `OUTCOME_UNKNOWN`, HMRC may have processed the submission despite the failed response. The record stays in `pending` status to prevent double-submission. The owner must:
1. Check their HMRC account (MyAccount) for evidence of the filing
2. If the submission appears, no action is needed (it will sync on the next data sync)
3. If it does not appear, contact HMRC support before attempting a new submission

## Audit events

Every state change is recorded as an audit event:

| Action | Condition | Snapshot |
|--------|-----------|----------|
| `its_final.confirmed` | Owner confirmed the declaration | calculationId, HMRC response (income tax, NIC, total), fraud headers (no auth header), taxYear, sandbox |
| `its_final.submitted` | HMRC accepted the declaration | Same as confirmed, plus HMRC correlation ID |
| `its_final.rejected` | HMRC rejected (4xx error) | HMRC error code, statusCode, fraud headers, taxYear, sandbox |

All events include: user ID, timestamp, resource ID, actor type (user), and metadata. Tokens, NINO, and request bodies are never logged (following DP-7 and DP-8).

## Sandbox and live dual switch

Filing goes to the sandbox by default and requires both of:
1. Server config: `HMRC_SANDBOX_MODE=false` in the environment
2. User opt-in: Settings → HMRC → "Allow live filing with HMRC" and confirming in the Settings dialog (stored as `users.hmrc_sandbox_mode = false`)

If only one switch is set, the request fails with `LIVE_MODE_REFUSED`. Both must match exactly.

## Pure comparison function

`src/lib/finalDeclaration.ts::compareWithHmrc()` takes STF's own estimate and HMRC's calculated figures, returns the signed differences and a `differs` flag:

```typescript
compareWithHmrc(
  stfEstimate: { incomeTaxPence, class2NicPence, class4NicPence },
  hmrc: { incomeTaxPence, class2NicPence, class4NicPence, totalPence }
): DeclarationComparison
```

The difference is HMRC minus STF. A positive income tax difference means HMRC calculated a higher tax (common if the owner has other income). The function is pure and fully tested with boundary cases.

## Guided final declaration flow

`src/pages/FinalDeclarationFlow.tsx` has two steps and a done screen, with Back and Leave buttons:

1. **Your tax for the year:** HMRC's income tax, National Insurance and total, each beside STF's own estimate in plain words with the official name in small text. When the totals differ, an amber call-out says by how much and that other income (a job, rental income, savings interest, pension payments) is the usual reason.
2. **Check and send:** one line on what will be sent, HMRC's declaration wording as a checkbox, and the "Send to HMRC" button. Ticking the box calls the confirm route; the button stays disabled until that succeeds. If the send is refused, the tick is cleared and the owner ticks again.
3. **Done:** "Your tax return for the year is sent", with an "HMRC test mode" badge in sandbox.

The preview runs once per visit. It is not refetched on window focus, because every fetch asks HMRC for a new calculation and the id under the figures must not change. The step is not saved between visits: leaving and returning starts again at step 1 with a fresh calculation.

## Guided flow entry point

The Tax page (`src/pages/TaxPage.tsx`) has a "Check and send your final tax bill" button next to "Do your Income Tax year end". It goes to `/tax/final-declaration/{taxYear}`, where `src/pages/FinalDeclarationPage.tsx` starts the flow. HMRC's figures are shown in the flow, not on the Tax page itself.

## Units and precision

Everything is integer pence internally. The HMRC payload uses whole pounds (no decimal places). The conversion to pounds is done at the API boundary only, using string maths (never floating-point) to preserve exactness.

## Testing

Tests are in:
- `src/lib/finalDeclaration.test.ts` — pure comparison function, difference calculation
- `api/_lib/__tests__/itsFinalDeclaration.test.ts` — preview, confirm, submit logic; idempotency lock; status transitions
- `api/_lib/__tests__/itsFinalDeclarationRoute.test.ts` — route handlers, HTTP layer, authentication
- `src/pages/FinalDeclarationFlow.test.tsx` — UI flow, step navigation, the tick gate

The integration test `src/lib/hmrc/sandbox.integration.test.ts` includes a live call to HMRC's sandbox Individual Calculations API to verify the trigger and fetch endpoints.

## Future work

1. **Non-self-employment income input** — Add a screen in Settings to record employment, property, savings income and pension contributions, so STF's estimate can include them
2. **Adjustment and allowance collection** — Collect adjustments (inventory changes, working-from-home) and additional allowances (capital allowances, loss relief) in a dedicated flow
3. **Other income sources guidance** — When HMRC's figure differs significantly, surface a guided checklist of possible reasons and links to HMRC's guidance
4. **Annual adjustment submission** — Allow the owner to submit adjustments and allowances separately from the final declaration (currently the final declaration is submission-only)
