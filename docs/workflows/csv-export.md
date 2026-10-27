# CSV Export

The CSV export feature allows the owner to download a complete record of their entries for a date range as a CSV file for backup or to share with an adviser.

## Route: GET /api/entries-export

The route requires the owner to be signed in. It accepts two query parameters:
- `from` — ISO date (YYYY-MM-DD), inclusive
- `to` — ISO date (YYYY-MM-DD), inclusive

The request must use `from <= to`. The date range must not exceed 366 days. If the range contains more than 20,000 entry lines, the export is refused with a plain message.

## Columns

The CSV contains the following columns:

- **date** — Entry date (YYYY-MM-DD)
- **description** — Entry description
- **reference** — Optional reference code
- **account code** — Account code
- **account name** — Account name
- **net** — Net amount in pounds with two decimals
- **VAT** — VAT amount in pounds with two decimals
- **gross** — Gross amount (net + VAT) in pounds with two decimals
- **status** — Entry status: `draft`, `confirmed`, `reconciled`, or `voided`
- **source** — Source of the entry (e.g., `form`, `receipt`, `import`)

## Included entries

The export includes:
- Confirmed entries
- Reconciled entries
- Draft entries with their status shown as `draft`
- Voided entries are **not included** in the export

Amounts are exported in pounds with two decimal places, rounded from integer pence. The export file is served with `Content-Type: text/csv` and `Content-Disposition: attachment` so the browser saves it immediately.

## Limits

- Maximum date range: 366 days
- Maximum rows: 20,000 entry lines

If either limit is exceeded, the export is refused with a plain error message.

## Data handling

The CSV file contains the owner's financial records and should be stored safely. The file is not encrypted during transmission; the owner should treat it as they would any financial document containing sensitive business information.
