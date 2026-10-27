# Income Tax obligations (Tax page)

The Tax page lists which Income Tax quarterly updates and which final declaration HMRC says are due, for the current and previous tax year. The open item with the earliest due date is marked "Next due"; open items past their due date read "Overdue".

## Flag

`HMRC_ITSA_ENABLED` is off by default. With it off, `GET /api/hmrc/its-obligations` returns 404 before any HMRC call or database read, and the Tax page renders nothing for this section.

## Live double switch

Same rule as VAT. The route refuses with 403 `LIVE_MODE_REFUSED` unless the user's own sandbox setting matches the deployment's `HMRC_SANDBOX_MODE`. Sandbox is the default; live needs `HMRC_SANDBOX_MODE=false` and the user's opt-in in Settings.

## What the route asks HMRC

For each tax year it makes two calls through `src/lib/hmrc/client.ts`: income and expenditure (quarterly) obligations for the selected business, and final declaration obligations. Both send the fraud prevention headers (`docs/fraud-prevention-headers.md`). The route needs a connected HMRC account, the Income Tax scope, a chosen business and the owner's NINO. When one is missing the route answers 409 with a code, and the page shows the matching step in Settings.

## When HMRC fails

The last good answer is kept per user and tax year in `its_obligations_cache`. If HMRC fails and a stored copy exists, the route returns it with `stale: true`, the time it was fetched and a plain-words error, and the page shows "Showing last known dates from ...". With nothing stored the route returns 502 and the page shows the error alone.

## Stored copy

Dates and status only; no NINO, tokens or amounts. One row per user and tax year, replaced on every successful fetch and deleted with the user (cascade). It is not soft-deleted because it is a cache, not a financial record.

## Tests

Route and client tests use a fake HMRC client and recorded sandbox responses. `e2e/mockApi.ts` serves invented obligations for the journey; `npm run test:journey:mock` walks the Tax page fresh and stale.
