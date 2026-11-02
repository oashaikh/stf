# STF-119 review notes

Six-item menu (Home, Money in, Money out, Bank, Tax, Settings) at 1440 and 390 px. Captures are light theme, taken from the mocked app with invented figures, one per tab.

## Dark theme

STF ships no dark theme (no dark mode in the Tailwind config), so there are no dark captures. The earlier dark files were copies of the light ones and have been removed.

## Where the screens differ from docs/design/ease-of-use.md

- Home is the old Dashboard with its heading renamed to Home. The to-do list is its own ticket. Home has no link to Reports; Reports sits only under Tax.
- Bank shows the connected accounts only. The sorting-payments flow does not exist yet.
- Other income reuses the entries list filtered to income, not a new design.
- Receipts is still a "Coming soon" page.
- The VAT tab still uses HMRC wording (Box, Period key, VAT obligations) in places. The spec asks for plain words with official names in small text; that rewrite is not in this ticket.
- A tab name and the heading under it repeat each other (for example Expenses / Expenses).
- A bare /tax now opens the Income Tax tab, as the old /tax page did. The other old addresses redirect as the ticket lists.
- In the 390 px full-page captures the fixed bottom menu appears part-way down the page, a screenshot effect of stitching a full page.
