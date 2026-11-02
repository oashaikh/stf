# MTD Income Tax minimum functionality: audit

Source: HMRC Developer Hub, Income Tax MTD end-to-end service guide, "How to integrate" page
(https://developer.service.hmrc.gov.uk/guides/income-tax-mtd-end-to-end-service-guide/documentation/how-to-integrate.html),
sections "Minimum functionality standards", "Production approvals checklist" and "Process for being granted Production access".

Date read: 2026-11-02, via a summary the operator pasted into the ticket (this environment cannot reach HMRC sites).
Operator check: on 2 Nov 2026 the operator compared this document with the live HMRC page and accepted it.
The rows below follow that summary, not HMRC's exact wording. Before the owner quotes any standard to HMRC, check it against the live page.

Scope: sole trader with self-employment and UK property income. Limited companies are out of scope.

## VAT is frozen

The VAT filing code (`api/vat/*`, `src/lib/hmrc/vatApi.ts`, the VAT screens) is frozen. No standard below is met by changing how VAT returns are built, previewed or submitted.

## Audit

Size: S under half a day, M about a day, L several days.

| # | Standard (summary) | Status | Where in STF, or the fix and size |
| --- | --- | --- | --- |
| 1 | Send fraud prevention header data on every call | Met, to be proven | Headers built in `src/lib/hmrc/fraudHeaders.ts`, assembled once in `api/_lib/hmrcCall.ts`; check route `api/vat/fraud-headers-check.ts`; spec in `docs/fraud-prevention-headers.md`. Gap: the HMRC test API has not been run for the Income Tax routes across varied devices and browsers. Fix: validate in the evidence run (task 4), S |
| 2 | Obtain a unique business ID for each of the customer's businesses | Met | `listItsSelfEmploymentBusinesses` and `listItsPropertyBusinesses` in `src/lib/hmrc/client.ts`, served by `api/hmrc/its-businesses.ts` |
| 3 | Create and keep legally required digital records; customer can own, access and export them | Met | Entries, invoices, receipts, mileage in the database; soft-delete only; CSV export in `api/entries-export.ts` and `src/lib/exportApi.ts`, `docs/workflows/csv-export.md` |
| 4a | Quarterly updates: self-employment (including several businesses) | Met | `submitCumulativePeriodSummary` in `src/lib/hmrc/client.ts`; `api/hmrc/its-cumulative-*.ts`; `src/pages/ItsUpdatePage.tsx`. Gap to confirm: the flow must let the customer pick between several self-employment businesses. Fix: check and test, S |
| 4b | Quarterly updates: UK property | Met | `submitPropertyCumulativeSummary` in `src/lib/hmrc/client.ts`; `api/hmrc/its-property-*.ts`; `src/lib/itsPropertyUpdate.ts` |
| 4c | Quarterly updates: foreign property | Gap, owner decision | Not built and not in scope for this customer. Point customers to other software, or build later (L) |
| 5 | Show an income tax estimate, or signpost to the HMRC online account | Met | `api/tax-estimate.ts`, `src/pages/TaxPage.tsx`; HMRC's own calculation next to STF's estimate in `src/pages/FinalDeclarationFlow.tsx`. Gap: confirm an accuracy disclaimer is shown beside the in-app estimate. Fix: add one line of plain-words copy, S |
| 6a | Make required adjustments for the year | Met (read-only) | Self-employment annual allowances and adjustments in `src/lib/itsAnnualSubmission.ts`, `api/hmrc/its-annual-*.ts`, `src/pages/YearEndFlow.tsx`. STF records no adjustments of its own, it only shows those already held by HMRC. `triggerAdjustableSummary`, `getAdjustableSummary` and `getTaxLiabilityAdjustments` in `src/lib/hmrc/client.ts`, served read-only by `api/hmrc/its-adjustments.ts`, with fake-fetch tests in `client.test.ts`. Remaining: guided step in the year-end flow (task 3) |
| 6b | Property annual submission | Met | `submitPropertyAnnualSubmission` in `src/lib/hmrc/client.ts`, merged from STF-110 (#94), tested in `client.test.ts` |
| 6c | Finalise business income for the year | Met | `src/pages/YearEndFlow.tsx`, `api/hmrc/its-annual-submit.ts` |
| 7 | Handle losses: carry forward, carry back, sideways, earlier losses against this year's profits | Gap, owner decision | No Individual Losses API calls anywhere in `src` or `api`. Fix: client for the Individual Losses API, routes, and a guided "you made a loss" flow, L. Alternative: signpost to other software |
| 8 | Submit non-mandated income sources, or point customers elsewhere | Gap, owner decision | Not built. Fix for now: a plain-words pointer to other software, S |
| 9 | Submit the tax return (final declaration), or point customers elsewhere | Met | `submitFinalDeclaration` in `src/lib/hmrc/client.ts`; `api/hmrc/its-final-*.ts`; `src/pages/FinalDeclarationFlow.tsx`; `docs/workflows/its-final-declaration.md` |
| 10 | Obligations API | Met | `getItsIncomeAndExpenditureObligations`, `getItsFinalDeclarationObligations`; `api/hmrc/its-obligations.ts`; `src/pages/ItsObligationsSection.tsx` |
| 11 | Business Details API | Met | `api/hmrc/its-businesses.ts` |
| 12 | Individual Calculations API | Met | `triggerTaxCalculation`, `getTaxCalculation` in `src/lib/hmrc/client.ts` |
| 13 | Individual Losses API | Gap | See row 7 |
| 14 | Individuals Tax Liability Adjustments API | Met | See row 6a |
| 15 | Business Source Adjustable Summary API | Met | See row 6a |
| 16 | Property Business API | Met | Cumulative and annual, see rows 4b and 6b |
| 17 | Self-Employment Business API | Met | Cumulative and annual submission in `src/lib/hmrc/client.ts` |

Approval-process requirements (not product standards):

| Requirement | Status | Where |
| --- | --- | --- |
| Test every documented endpoint of each minimum-standard API we use; tell SDSTeam which others we support | Gap | Existing sandbox tests are in `src/lib/hmrc/sandbox.integration.test.ts` and cover part of the list. Scripted run is task 4 |
| Proper error handling | Met | `HmrcError` in `src/lib/hmrc/client.ts` |
| Send SDSTeam the sandbox application ID and tell them when testing is done | Owner | `docs/runbooks/hmrc-evidence-run.md` (task 5) |
| Return the checklist HMRC issues on request to SDSTeam@hmrc.gov.uk | Owner | After the evidence run |

HMRC Assist prompts are encouraged, not required. Not built, not planned.

## Gaps and who builds them

Tasks 2 and 3 will build:

1. Business Source Adjustable Summary and Individuals Tax Liability Adjustments client functions and routes (M each, task 2), with a guided step in the year-end flow (M, task 3).
2. Property annual submission: now built (STF-110), no further backend work.
3. In-app estimate disclaimer, in plain words (S, task 3).
4. Check the quarterly update flow handles several self-employment businesses (S, task 3).
5. Fraud header validation for the Income Tax routes, in the evidence run (S, task 4).

Task 3 result (user-facing gaps), checked 2 Nov 2026. No screen was changed, so there are no new screenshots and the VAT screens are untouched.

1. In-app estimate disclaimer: already met. `src/pages/TaxPage.tsx` says the figure "is an estimate from your recorded profit so far, not a tax bill", and the trading allowance note says the figures are an estimate. No change needed.
2. Several self-employment businesses: not met. `src/pages/SettingsPage.tsx` stores one selected business, and `src/pages/ItsUpdatePage.tsx` finds the obligation by business type only, so a second self-employment business would never get its own quarterly update. Question for the ticket conversation: docs/design/ease-of-use.md does not say how a person with two trades picks between them. Does the owner want a "which business is this update for?" step at the start of the quarterly update, or one set of settings per business?
3. Guided step for Business Source Adjustable Summary and Individuals Tax Liability Adjustments: backend only (`api/hmrc/its-adjustments.ts`, client functions). `src/pages/YearEndFlow.tsx` shows adjustments already on the tax record but does not let the person trigger or correct one through these APIs. Question for the ticket conversation: the spec does not describe a screen for correcting figures after the final declaration. What should it say in plain words, and where in the six-item menu does it sit?

Items 2 and 3 are left unbuilt until the owner answers, per the rule not to guess where the spec is silent.

Left for the owner to decide, because each is large or sends customers elsewhere:

1. Losses (rows 7 and 13): build the Individual Losses flow (L), or signpost to other software for now.
2. Foreign property (row 4c): not built.
3. Non-mandated income (row 8): signpost for now.

Without the losses and adjustments APIs, the product may not count as full end-to-end under HMRC's minimum standards. The owner should confirm with SDSTeam which product type (full, in-year only or end-of-year only) to apply for.
