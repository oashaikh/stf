# UK property quarterly update

Sends the cumulative rental income and costs for the tax year to date to HMRC's Property Business API
(v6.0). It follows the self-employment update (`its-quarterly-update.md`) and uses the same
preview, confirm, submit gate. VAT code is not touched.

## Data

- `users.hmrc_its_property_business_id`: the UK property business id, found from HMRC's business list
  (`listItsPropertyBusinesses`, type `uk-property`; HMRC allows one).
- `its_submissions.business_kind`: `self-employment` (default) or `uk-property`. The unique key is
  `(user_id, tax_year, quarter, sandbox, business_kind)`, so both kinds can be sent for the same quarter.
- Property entries use categories starting `property-` (`PROPERTY_CATEGORY_PREFIX`), kept out of
  self-employment figures.

## Mapping (`src/lib/itsPropertyUpdate.ts`)

| Category | HMRC field |
| --- | --- |
| property-rent-received | `ukProperty.income.periodAmount` |
| property-premises-running-costs | `ukProperty.expenses.premisesRunningCosts` |
| property-repairs-maintenance | `ukProperty.expenses.repairsAndMaintenance` |
| property-finance-costs | `ukProperty.expenses.financialCosts` |
| property-professional-fees | `ukProperty.expenses.professionalFees` |
| property-cost-of-services | `ukProperty.expenses.costOfServices` |
| property-travel-costs | `ukProperty.expenses.travelCosts` |
| property-other-costs | `ukProperty.expenses.other` |

Premiums, reverse premiums and tax deducted have no category, so they are never sent. `income` and
`expenses` are left out when empty. The request also carries `fromDate` and `toDate` (tax year start to
the quarter end).

## Pence to pounds

Amounts are integer pence in STF. `penceToPounds` makes a two-decimal string, then `Number()` turns it
into the JSON number HMRC expects here (self-employment sends strings). `250050` pence becomes `2500.5`.

## Request

`PUT /individuals/business/property/uk/{nino}/{businessId}/cumulative/{taxYear}` with
`Accept: application/vnd.hmrc.6.0+json` and the fraud prevention headers. Obligations come from
`GET /obligations/details/{nino}/income-and-expenditure?typeOfBusiness=uk-property&businessId=...`.

## Gate

1. `POST /api/hmrc/its-property-preview` builds the request from the ledger and returns it unsent.
2. `POST /api/hmrc/its-property-confirm` needs `declaration: true`; it recomputes and stores the payload (`confirmed`).
3. `POST /api/hmrc/its-property-submit` needs `confirm: true`; it sends the stored payload, never one from the body.

Body for 1 to 3: `taxYear` and `quarter` (1 to 4), extra keys refused.

## Failure states

- Not confirmed: submit returns 409 `NOT_CONFIRMED`.
- Already sent: a second submit is refused.
- HMRC 4xx: status becomes `rejected`, the code and status are audited, the owner sees a 502 and can confirm again.
- Network failure or HMRC 5xx: the row stays `pending` so a resend cannot double-submit; check the sandbox or HMRC before retrying.
- No property business id or HMRC not connected: stopped before any call, with the fix named.

## Sandbox tests

`src/lib/hmrc/sandbox.integration.test.ts` covers the business list, property obligations and the
cumulative PUT. See `docs/runbooks/hmrc-sandbox-integration.md`.
