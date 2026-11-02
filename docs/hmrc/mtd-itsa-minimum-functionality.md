# MTD Income Tax minimum functionality: audit

Status: **not completed. The HMRC page could not be read.**

## What happened

- Date attempted: 2026-11-02.
- Page attempted: the minimum functionality standards in the Income Tax MTD end-to-end service guide on the HMRC Developer Hub (developer.service.hmrc.gov.uk, guides section).
- Result: the fetch was refused ("proxy refused the connection"). This environment cannot reach HMRC's sites.
- The standards are not reconstructed from memory. A row written without the source text could claim a standard HMRC does not set, or miss one it does. There is no standards table below for that reason.

## Next step for the owner

Paste the text of the current standards page into the ticket conversation (or commit it as `docs/hmrc/source/minimum-functionality.md`). The audit table (requirement, where STF meets it, or gap with a size) is then written against that text, with the page URL and the date it was read.

## Scope for the audit

Sole trader with self-employment and UK property income. Out of scope: limited companies.

## VAT is frozen

The VAT filing code (`api/vat/*`, `src/lib/hmrc/vatApi.ts`, the VAT screens) is frozen. No standard is met by changing how VAT returns are built, previewed or submitted. Any gap that appears to need a VAT change is recorded as a gap and left for the owner.

## Income Tax code that exists today (inventory, not a verdict)

This lists what a later audit will map standards onto. It does not say any standard is met.

| Area | Where |
| --- | --- |
| HMRC client | `src/lib/hmrc/client.ts` |
| Fraud prevention headers | `src/lib/hmrc/fraudHeaders.ts`, `docs/fraud-prevention-headers.md`, `api/vat/fraud-headers-check.ts` |
| Business details | `api/hmrc/its-businesses.ts` |
| Obligations | `api/hmrc/its-obligations.ts`, `src/lib/hmrc/itsObligationsApi.ts`, `docs/workflows/its-obligations.md` |
| Quarterly (cumulative) updates | `api/hmrc/its-cumulative-*.ts`, `src/lib/hmrc/itsUpdateApi.ts`, `docs/workflows/its-quarterly-update.md` |
| UK property updates | `api/hmrc/its-property-*.ts`, `docs/workflows/its-property-update.md` |
| Annual submission | `api/hmrc/its-annual-*.ts` |
| Final declaration | `api/hmrc/its-final-*.ts`, `docs/workflows/its-final-declaration.md` |
| Sandbox runbook | `docs/runbooks/hmrc-sandbox-integration.md` |

## Gaps for tasks 2 and 3, and for the owner

Not yet known, because the standards text is missing. Tasks 2 to 5 depend on this audit; they should wait for the pasted text.
