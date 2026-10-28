# STF-100: retrospective UI check

Presentation-only fixes found while checking each listed screen at 1440 and 390 px (light; the app has no dark theme). No layout moves, routes, data or behaviour changed.

## What changed, by skill

- ui-ux-pro-max: login errors are linked to their fields; phone trip and entry rows carry "Miles", "Claim" and "Total" labels; the mileage void dialog fits 390 px; disabled buttons in settings are visibly dimmed; read-only invoice lines at 390 px have a column gap so Qty and Unit price no longer run together.
- ui-styling: long category names in Reports truncate inside their link so the amount stays visible; Chart of accounts shows a plain empty message.
- humanize: dashboard tax-year, month and quarter periods and the Reports period line use the UK date format ("6 Apr 2026 to 5 Apr 2027") already used elsewhere.
- taste-skill: no change; it targets public marketing pages, not app screens.

Also in the diff: `api/cron/__tests__/prepareVatDraft.test.ts` now uses a far-future token expiry. The old fixed date (27 Oct 2026) had passed, so four tests failed against the real clock. This is a test fix, not a UI change.

## Screenshots

`before/` is the base branch build, `after/` is this branch, both under `browser-evidence/STF-100/`. At 390 px the fixed bottom nav is hidden in full-page captures so it cannot cover content. The recurring-entries captures show that section on its own (it sits at the bottom of Expenses, empty in the mock data).

Screens with no visible difference between before and after: login, settings at 1440, invoices at 1440, expenses list and entry sheet at 1440, privacy and terms. Their code changes are focus, label or state changes that a still image does not show (for example Saving… and the disabled states).

## Proposed, not done

None. Every defect found was fixable in place.
