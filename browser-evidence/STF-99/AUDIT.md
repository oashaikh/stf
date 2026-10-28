# STF-99 audit: VAT and tax screens, before any fix

Skills loaded before any screenshot was opened: `ui-ux-pro-max:ui-ux-pro-max`, `ui-styling:ui-styling`, `taste-skill:taste-skill`. Copy is checked against `humanize:humanize` in the fix tasks.
Captured against the mock API (`e2e/mockApi.ts`, invented data only) on a built preview. 24 scenarios at 1440 and 390, 48 PNGs in `before/`, named `<scenario>-<width>-light.png`.
Dark: not applicable. `src/styles/index.css` defines no dark tokens and no `dark:` classes are used.

Capture notes:
- The bottom tab bar and the sticky header show mid-page in the 390 full-page shots. That is a full-page screenshot artefact of fixed positioning, not a defect.
- "Could not load mileage" (Tax page) and "Could not load your HMRC businesses" (Settings) come from routes the mock does not implement. They are not defects.
- Tap-target and overflow numbers below were measured in the browser at 390 (no horizontal overflow on any scenario).

Screens: VAT page `/vat`, VAT preview panel, VAT history, VAT obligations, Tax page `/tax`, Income Tax obligations (on `/tax`), Tax identifiers (`/settings`).

## Defects to fix in place

| # | Defect | File | Screen, viewport | Standard |
|---|--------|------|------------------|----------|
| 1 | Page gutters differ. VAT uses `p-8` (32px at 390), Tax uses `p-4 md:p-8` (16px). Dashboard, Expenses, Invoices and Reports use the Tax form; VAT, Settings and Receipts use `p-8`. Fix by giving VAT the `p-4 md:p-8` form (Settings and Receipts are outside this ticket's screens; see Proposed). | `src/pages/VatPage.tsx:68` | VAT, 390 (text starts at 32px, Tax at 16px) | UI-3 |
| 2 | Secondary text on the VAT screens is `text-gray-500` (period line, loading, empty, table headers, mobile row labels, drill-down notes). Tax screens use `text-gray-700` for the same roles. gray-500 on the gray-50 page is about 4.6:1, a pass with no margin and visibly lighter than the Tax page. Use `text-gray-700`. | `VatPage.tsx` (lines 71, 94, 199, 203, 216, 224, 358, 402, 424), `VatHistoryList.tsx` (78, 84, 90, 103), `VatObligationsList.tsx` (57-69), `VatPreviewPanel.tsx` (header row) | VAT, history, obligations, preview; 1440 and 390 | UI-12 |
| 3 | History row at 390: the "Return" label sits at the top while the period-key link sits at the bottom of its 44px box, so the pair is misaligned. The link is also 36px wide, under 44. Centre the row and give the link `min-w-11`. | `src/pages/VatHistoryList.tsx:102-109` | VAT history, 390 (`vat-history-390`) | UI-1, UI-5 |
| 4 | The preview URL line is `break-all`, so at 390 it breaks mid-word (`test-api.service.hmrc.g` / `ov.uk/...`). Break at slashes or use `break-words` on the URL only. | `src/pages/VatPreviewPanel.tsx` (endpoint paragraph) | VAT preview, 390 | UI-7 |
| 5 | Preview copy is developer-facing: "Sandbox POST https://...", "Finalised: yes", a bare "Headers" label. Rewrite plainly ("Sent to the HMRC test service", "Period 26A1, confirmed") without changing what is shown. | `VatPreviewPanel.tsx` | VAT preview, 1440 and 390 | humanize, UI-16 |
| 6 | Income Tax setup message: the link inside the sentence is `inline-flex min-h-11`, which opens a large gap between the lines and strands "dates." on its own line before the link. Put the link on its own line under the sentence, still 44px tall. | `src/pages/ItsObligationsSection.tsx` (gap paragraph) | Income Tax obligations, not-connected and no-NINO states, 390 (`its-obligations-not-connected-390`) | UI-5, spacing rhythm |
| 7 | Loading copy is inconsistent: "Loading your VAT return…" and similar on VAT, bare "Loading…" on Tax. Heading case drifts too: "Income Tax obligations" heading but "income tax dates" and "income tax obligations" in the body copy. Make the body copy "Income Tax" like the heading and the Tax page loading line say what is loading. | `TaxPage.tsx:54`, `ItsObligationsSection.tsx` (error and empty lines) | Tax page, Income Tax obligations | humanize |
| 8 | Stale-dates banner in the Income Tax section is `role="alert"` for a cached-data notice, and runs the server error straight after the date with no full stop when the server text has none. Make it `role="status"`, and end the sentence with a stop. | `ItsObligationsSection.tsx` (stale paragraph) | Income Tax obligations, stale state, 1440 and 390 (`its-obligations-overdue-stale-390`) | copy, a11y |

Items 1 to 8 are CSS-class or copy edits. None changes layout order, data, behaviour or routes.

## Checked and found fine

- Focus ring: global `*:focus-visible` ring in `index.css` covers every control on these screens.
- Hit targets at 390: every button and link on the seven screens is 44px tall or inside a 44px label. The only measured sub-44 items are native radio/checkbox inputs (20-24px) inside 44px labels, and the history link in item 3.
- Money: right-aligned via `formatPence` in VAT boxes, history and Tax; one currency format per page.
- Tables: VAT history, obligations and Income Tax obligations collapse to labelled rows at 390, no sideways scroll at either width; long periods truncate with a `title`.
- Tax identifiers: values masked, both buttons 44px, labelled, error uses `role="alert"`.

## Other tickets touching these files since 14 Oct

`git log --since=2026-10-14` on `src/pages`, `src/components`, `src/styles`: STF-48, 49, 51, 54 to 63, 67, 68, 70, 71, 73, plus STF-31, 32, 78 to 84, 90, 93 (Tax page, Settings, Invoices, Reports, Expenses). Of those, the ones on this ticket's seven screens: STF-54, 56, 57, 62, 20 (VAT, preview, history), STF-31, 32, 84 (Tax, Income Tax obligations), STF-82 (Tax identifiers). Invoices, Reports, Expenses, Dashboard and the rest of Settings are outside the listed screens and are not audited here.

## Proposed, not done

Each needs a layout, feature, data or route change.

1. **Shared loading, empty and error components (UI-11).** These screens use inline `<p role=...>` markup and there is no shared state component in `src/components`. Creating one touches every page. Screenshots: `vat-history-loading-390`, `tax-page-loading-390`, `vat-obligations-error-390`.
2. **VAT not-connected shows "No past VAT returns yet."** above an unconnected obligations block, which says nothing useful and repeats the connect prompt. Hiding history in that state is a behaviour change. Screenshot: `vat-obligations-not-connected-390`.
3. **Box 5 sign differs between review and preview.** The review table shows -£45.00 (refund) while the preview shows £45.00, the figure HMRC receives. Both are correct for their purpose; reconciling them is a data and wording decision. Screenshots: `vat-confirmed-390`, `vat-preview-panel-390`.
4. **Preview panel has no heading of its own and repeats the full box table** under the review table, which doubles the scroll at 390. Adding a heading or collapsing it moves sections. Screenshot: `vat-preview-panel-390`.
5. **Tax identifiers load error leaves no way to retry** and hides the Edit button; the page must be reloaded. Adding a retry is a feature. Screenshot: `tax-identifiers-error-1440`.
6. **Settings and Receipts also use `p-8` gutters** (same fix as item 1) but are not on this ticket's screens list. Screenshot: `tax-identifiers-empty-390`.
7. **VAT tables are capped at `max-w-3xl` and the Tax cards at `max-w-xl`** while the Income Tax table runs the full 1440 width, so the Tax page has two column widths. Unifying means a layout change. Screenshot: `tax-page-1440`.

## Fixes made, and the skill that drove each

After screenshots are in `after/`, same 24 scenarios, same names, at 1440 and 390 (light only). They use the mock API's invented records.

| # | Fix | Driving skill | Commit |
|---|-----|---------------|--------|
| 1 | VAT page gutters `p-8` to `p-4 md:p-8`, matching Tax | ui-styling | ed29914 |
| 2 | VAT secondary text `text-gray-500` to `text-gray-700` (labels, loading, empty, headers) | ui-ux-pro-max (contrast) | ed29914 |
| 3 | VAT history row centred, period-key link `min-w-[44px]` | ui-ux-pro-max (hit targets) | ed29914 |
| 4 | Preview URL breaks at word boundaries, not mid-word | ui-ux-pro-max (truncation, overflow) | ed29914 |
| 5 | Preview copy tidied | humanize | ed29914 |
| 6 | Income Tax setup link on its own line, still 44px tall | taste-skill (spacing rhythm) | b1f2393 |
| 7 | "Income Tax" capitalised in body copy; Tax loading line now says "Loading your tax estimate…" | humanize | b1f2393 |
| 8 | Stale-dates notice uses `role="status"` instead of `role="alert"` | ui-ux-pro-max (accessibility) | b1f2393 |

Re-measured at 390 on the after build: no horizontal overflow on any scenario, and the VAT history link no longer appears among sub-44px targets. The only items under 44px are still the native radio/checkbox inputs inside 44px labels.

Not in the screenshot set: no dark theme exists, so there are no dark captures.
