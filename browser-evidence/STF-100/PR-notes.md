# STF-100: Retrospective UI check with design skills

Fixed dashboard, invoices, expenses, reports, settings and sign-in screens against the design tokens and accessibility standards. These screens were built without access to the design skills (fixed by AIP-791) and have now been reviewed and corrected using `ui-ux-pro-max`, `ui-styling`, `taste-skill`, and `humanize`.

## Changes by screen

### Login and sign-in (task 2)

**accessibility improvement via `taste-skill`**: Added ARIA attributes to error handling on the login form to properly link error messages to their fields (`aria-invalid`, `aria-describedby`). Error text is now explicitly marked as an alert and shares the same focus ring styling as form fields for visual consistency (UI-13: visible focus state).

**Changes**: LoginPage.tsx
- Added `aria-invalid` to password and code fields when login fails
- Added `aria-describedby` to link fields to error message by id
- Applied consistent focus ring style (`focusRing` class) to both fields
- Marked error message with id `login-error` for association

### Dashboard and Reports (task 3)

**date formatting via `taste-skill` and `humanize`**: Dashboard period labels now use UK date format (DD Mon YYYY) instead of ISO format (YYYY-MM-DD), which matches the locale expectation for GBP currency. Reports category names that exceed available space now truncate with an ellipsis and show full text on hover.

**Changes**: DashboardPage.tsx, ReportsPage.tsx
- Dashboard: applied `formatDate()` utility to all period labels (tax year, month, quarter)
- Reports: added `truncate` and tooltip to long category names
- Improves readability and consistency with GBP locale (UI-8: money right-aligned in one currency format; UI-7: long text truncates with ellipsis)

### Expenses list (task 4)

**mobile labeling via `ui-styling`**: Entries on phone screens now show an "Amount:" label before the figure, and the empty "Category:" label has been removed. This follows the mobile design pattern where implicit structure (column alignment on desktop) must become explicit text labels (UI-15: tables collapse to labelled rows on phone).

**Changes**: EntriesList.tsx
- Added conditional `Amount:` label on mobile screens only
- Removed the empty `Category:` label when category is not set
- Labels appear in the same row as the value for clarity

### Invoices (task 5)

**mobile labeling and alignment via `ui-styling`**: Invoice rows on phones now show labels (`Description`, `Quantity`, `Unit price`, `Amount`) and line totals are right-aligned. New invoice dialog fits properly on narrow screens.

**Changes**: InvoicesPage.tsx, InvoiceEditor.tsx
- Added labels to invoice line items on mobile
- Right-aligned money inputs to match currency alignment rule (UI-8)
- Dialog body scrolls independently on small screens
- Ensured tap targets remain 44px minimum (UI-5)

### Settings sections (task 6)

**empty state labels and disabled button styling via `ui-ux-pro-max`**: Settings sections (Business profile, Chart of accounts, Authenticator) now show a "Saving..." label while changes persist. Empty sections display an empty state component instead of unlabeled form fields. Disabled buttons (e.g., disabled authenticator delete when no authenticator exists) now have reduced opacity to indicate unavailability.

**Changes**: BusinessProfileSection.tsx, ChartOfAccountsSection.tsx, AuthenticatorSection.tsx
- Added "Saving..." label on persistence pending
- Empty state components for sections with no data
- Reduced opacity on disabled buttons for visual feedback (UI-4: tokens from the colour scale)
- Ensures loading and empty states are clear (UI-11: empty states from shared components)

### Mileage and recurring entries (task 7)

**mobile labeling and dialog fit via `ui-styling`**: Mileage trip rows on phones now label the distance ("X miles") and claim amount. Void dialog fits properly on narrow screens without horizontal scroll.

**Changes**: MileageSection.tsx
- Added "X miles" label to trip distance on mobile
- Added claim amount label on mobile rows
- Dialog respects 390px viewport without overflow (UI-2: no vertical scroll inside another scroll region; UI-6: table never scrolls horizontally at 1440px)

## Design skills applied

Each change was driven by one of the four design skills:

- **`ui-ux-pro-max`**: Empty states, disabled states, loading states, component behavior
- **`ui-styling`**: Spacing rhythm, alignment, mobile labeling, overflow handling
- **`taste-skill`**: Accessibility (ARIA, focus states), keyboard paths, semantic structure
- **`humanize`**: Date formatting, button labels, error messages, copy consistency

## Verification

- 1440px and 390px screenshots captured for every changed screen in light theme
- All changes are cosmetic or accessibility improvements; no data or behaviour changed
- npm run lint, typecheck, test, and build pass
- Tests added for new date formatting and label logic

## Proposed, not done

The following improvements were identified but not implemented as they require feature or navigation changes outside the scope of this retrospective check:

**Before screenshots for reference:**

- [login-1440-light.png](before/login-1440-light.png)
- [dashboard-1440-light.png](before/dashboard-1440-light.png)
- [reports-1440-light.png](before/reports-1440-light.png)
- [expenses-list-1440-light.png](before/expenses-list-1440-light.png)
- [expenses-list-390-light.png](before/expenses-list-390-light.png)
- [invoices-1440-light.png](before/invoices-1440-light.png)
- [invoice-editor-open-1440-light.png](before/invoice-editor-open-1440-light.png)
- [settings-1440-light.png](before/settings-1440-light.png)
- [tax-mileage-1440-light.png](before/tax-mileage-1440-light.png)

**After screenshots:**

All "after" screenshots at 1440px and 390px light theme are committed under `browser-evidence/STF-100/after/` directory, matching the naming convention of the "before" set.
