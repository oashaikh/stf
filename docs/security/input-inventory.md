# Input inventory

Every place something typed, uploaded or sent reaches the server, the rule it must pass, and the file that enforces it. A row marked **GAP** has no server-side rule, or a weaker one than its neighbours; the gaps are closed by later tasks on STF-108 and the marker is removed when they land.

## How to update this file

Change this file in the same pull request as any change to an input: a new route, a new body field or query parameter, a new header the server reads, a changed limit or format, or a new upload or webhook. Add or edit the row, name the file that enforces the rule, and mark it GAP if no server check exists. A reviewer should refuse a pull request that adds an input without a row here.

To re-check completeness, list the entry points and compare them with the Route index below:

```bash
git ls-files 'api/*.ts' 'api/*/*.ts' 'server/src' | grep -v -e __tests__ -e _lib -e '\.test\.' -e migrations
grep -rnE "searchParams|headers\.get|request\.json|formData" api src/lib/hmrc --include=*.ts | grep -v -e __tests__ -e '\.test\.'
```

Conventions that hold for every route: the owner comes from the signed session cookie (`api/_lib/auth.ts`, `withAuth`), never from a body field. Validation failures return 400 with a message and a `code`. Unknown body keys are dropped by zod or ignored by the hand validators. Every database call binds values as parameters through drizzle.

## Route index

| Route file | Methods | Section |
| --- | --- | --- |
| `api/auth/login.ts` | POST | Sign-in |
| `api/auth/mfa.ts` | POST | Sign-in |
| `api/auth/logout.ts` | POST | Sign-in |
| `api/me.ts` | any | Trusted headers (session cookie only, no other input) |
| `api/entries.ts` | GET, POST, PUT, PATCH, DELETE | Entries |
| `api/entries-export.ts` | GET | Reports and export |
| `api/invoices.ts` | GET, POST, PUT, DELETE | Invoices |
| `api/invoice-pdf.ts` | GET | Invoices |
| `api/accounts.ts` | GET, POST, PATCH | Accounts |
| `api/mileage.ts` | GET, POST, PATCH, DELETE | Mileage |
| `api/recurring-entries.ts` | GET, POST, PATCH, DELETE | Recurring entries |
| `api/dashboard.ts` | GET | Reports and export (no input) |
| `api/profit-and-loss.ts` | GET | Reports and export |
| `api/tax-estimate.ts` | GET | Reports and export |
| `api/tax-year-summary.ts` | GET | Reports and export |
| `api/settings/business-profile.ts` | GET, PUT | Settings |
| `api/settings/tax-identifiers.ts` | GET, PUT | Settings |
| `api/settings/vat-number.ts` | GET, PUT | Settings |
| `api/settings/trading-allowance.ts` | GET, PUT | Settings |
| `api/settings/authenticator.ts` | GET, POST | Sign-in |
| `api/hmrc/mode.ts` | GET, POST | HMRC |
| `api/hmrc/connect.ts` | GET | HMRC |
| `api/hmrc/callback.ts` | GET | HMRC |
| `api/hmrc/status.ts` | GET | HMRC (no input) |
| `api/hmrc/its-businesses.ts` | GET, POST | HMRC |
| `api/hmrc/its-obligations.ts` | GET | HMRC (no input beyond session and fraud headers) |
| `api/vat/preview.ts` | POST | VAT |
| `api/vat/return.ts` | GET, POST | VAT |
| `api/vat/return-confirm.ts` | POST | VAT |
| `api/vat/submit.ts` | POST | VAT |
| `api/vat/obligations.ts` | GET | VAT |
| `api/vat/filed.ts` | GET | VAT |
| `api/vat/history.ts` | GET | VAT (no input) |
| `api/vat/fraud-headers-check.ts` | GET | VAT (no input beyond fraud headers) |
| `api/cron/create-recurring-entries.ts` | any | Cron |
| `api/cron/prepare-vat-draft.ts` | any | Cron |
| `api/cron/refresh-hmrc-tokens.ts` | any | Cron |
| `server/src/index.ts` | none | Fastify control plane: listens on 127.0.0.1 by default and registers no routes, so it takes no input. `server/src/scheduled-jobs/index.ts` and `refreshHmrcTokens.ts` read the database and HMRC only. |

## Sign-in

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `password` | login body | string, 1 to 1024 chars; compared against the owner secret; failures counted and locked out with 429 | `api/auth/login.ts`, `api/_lib/loginThrottle.ts`, `api/_lib/ownerSession.ts` |
| `code` | mfa body | string, 1 to 64 chars; then six digits (TOTP) or a recovery code; shares the login lockout | `api/auth/mfa.ts`, `api/_lib/totp.ts` |
| `stf_mfa_challenge` cookie | mfa | signed, expiring token | `api/_lib/ownerSession.ts` |
| `action` | authenticator query | one of `start`, `confirm`, `disable`; anything else 400 | `api/settings/authenticator.ts` |
| `code` | authenticator body | same as mfa `code`, plus the same lockout | `api/settings/authenticator.ts` |
| logout | POST, no input | method only | `api/auth/logout.ts` |

Rate limits: login, MFA and authenticator confirm share the failed-attempt lockout. No per-client limit on any other route. **GAP** (SEC-14), task 3.

## Entries

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `id` | query (single entry, edit, void, confirm) | uuid regex, else 400 | `api/entries.ts` |
| `date` | POST/PUT body | `YYYY-MM-DD` regex and a real calendar date, not more than 7 days ahead | `newEntrySchema`, `api/_lib/entries.ts` |
| `description` | body | string, trimmed, 1 to 200 chars. Stored as text, shown as text. No character set limit: control characters are accepted. **GAP**, task 2 | `api/_lib/entries.ts` |
| `reference` | body | optional string, trimmed, 1 to 60 chars. Same control-character **GAP** | `api/_lib/entries.ts` |
| `kind` | body | `income` or `expense` | `api/_lib/entries.ts` |
| `categoryAccountId` | body | uuid; account must belong to the caller and not be archived | `api/_lib/entries.ts` |
| `amountPence` | body | positive integer up to `MAX_AMOUNT_PENCE` | `api/_lib/entries.ts` |
| `amountIs` | body | `gross` or `net` | `api/_lib/entries.ts` |
| `vatRatePercent` | body | 0, 5 or 20 | `api/_lib/entries.ts` |
| `status` | body (POST/PUT) | `draft` or `confirmed` | `api/_lib/entries.ts` |
| `status` | PATCH body | literal `confirmed` | `confirmBodySchema`, `api/entries.ts` |
| `from`, `to` | list query | `YYYY-MM-DD`; `from` not after `to` | `entryListQuerySchema` |
| `kind`, `status`, `categoryAccountId` | list query | enum, enum, uuid | `entryListQuerySchema` |
| `minAmountPence`, `maxAmountPence` | list query | integer, 0 to twice the maximum amount | `entryListQuerySchema` |
| `search` | list query | string, trimmed, at most 100 chars; bound as a parameter in the query | `entryListQuerySchema`, `databaseEntryStore` |
| `limit` | list query | integer at least 1, capped at 50 | `entryListQuerySchema` |
| `cursor` | list query | string at most 200 chars; base64url JSON re-parsed as `{date, id: uuid}`, else 400 | `decodeCursor`, `api/_lib/entries.ts` |

## Invoices

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `id` | query | uuid regex (also on `invoice-pdf`) | `api/invoices.ts`, `api/invoice-pdf.ts` |
| `action` | POST query | `issue` or `paid` | `api/invoices.ts` |
| `paymentDate` | paid body | `YYYY-MM-DD` | `markPaidSchema`, `api/_lib/invoices.ts` |
| `reason` | void body | string, trimmed, 1 to 200 chars | `voidInvoiceSchema` |
| `clientName` | draft body | string, trimmed, 1 to 200 chars | `draftInvoiceSchema` |
| `clientAddress` | draft body | optional, trimmed, at most 500 chars, blank becomes null | `draftInvoiceSchema` (`optionalText`) |
| `notes` | draft body | optional, trimmed, at most 2000 chars, blank becomes null | same |
| `issueDate`, `dueDate` | draft body | `YYYY-MM-DD`; due date not before issue date | same |
| `lines` | draft body | array, 1 to `INVOICE_MAX_LINES` | `draftInvoiceSchema` |
| `lines[].description` | draft body | string, trimmed, 1 to 300 chars | `lineSchema` |
| `lines[].quantity` | draft body | integer 1 to 100,000,000 | `lineSchema` |
| `lines[].unitPricePence` | draft body | integer 0 to 10,000,000 | `lineSchema` |
| `lines[].vatRatePercent` | draft body | 0, 5 or 20 | `lineSchema` |
| totals, `public_number`, `status` | draft body | not accepted: zod strips unknown keys, the server computes them | `draftInvoiceSchema` |
| `status` | list query | `draft`, `sent`, `paid`, `overdue`, `voided` | `invoiceListQuerySchema` |
| `limit`, `cursor` | list query | integer capped at the page maximum; cursor at most 200 chars, decoded to `{createdAt, id: uuid}` | `invoiceListQuerySchema`, `decodeInvoiceCursor` |

Text fields have a length cap but no control-character check. **GAP**, task 2. The PDF file name is built from the server-generated public number with every character outside `A-Za-z0-9_-` replaced (`api/invoice-pdf.ts`).

## Accounts

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `archived` | GET query | only the literal `true` turns it on | `api/accounts.ts` |
| `code` | POST body | `^[A-Za-z0-9-]{1,10}$` | `validateAccountCode`, `api/_lib/accounts.ts` |
| `name` | POST/PATCH body | string, trimmed, 1 to 100 chars; control characters accepted. **GAP**, task 2 | `validateAccountName` |
| `accountType` | POST body | one of income, expense, asset, liability, equity | `validateNewAccount` |
| `taxCategory` | POST body | optional, `^[a-z-]{1,40}$` | `validateNewAccount` |
| `id` | PATCH body | uuid regex | `api/accounts.ts` |
| `archived` | PATCH body | boolean | `api/accounts.ts` |
| `accountType` | PATCH body | only compared with the stored type (`assertNoRetype`); never written | `api/_lib/accounts.ts` |

## Mileage

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `taxYear` | GET query | key of `TAX_BANDS` and a real `YYYY-YY` period | `api/mileage.ts`, `parseTaxYearPeriod` |
| `date` | POST body | `YYYY-MM-DD` and a real calendar date | `validateNewTrip`, `api/_lib/mileage.ts` |
| `from`, `to`, `purpose` | POST body | string, trimmed, 1 to 200 chars; control characters accepted. **GAP**, task 2 | `cleanText` |
| `distanceTenths` | POST body | integer 1 to 50,000 | `validateNewTrip` |
| `vehicleType` | POST body | `car`, `motorcycle`, `bicycle` | `validateNewTrip` |
| `id` | PATCH/DELETE body | uuid regex | `validateTripId` |

## Recurring entries

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `id` | PATCH/DELETE query | uuid | `templateIdSchema`, `api/recurring-entries.ts` |
| `kind` | POST body | `income` or `expense` | `newTemplateSchema`, `api/_lib/recurringEntries.ts` |
| `categoryAccountId` | POST body | uuid | `newTemplateSchema` |
| `amountPence` | POST/PATCH body | positive integer up to `MAX_AMOUNT_PENCE` | `newTemplateSchema`, `templatePatchSchema` |
| `amountIs`, `vatRatePercent`, `schedule` | POST/PATCH body | enums (gross/net, 0/5/20, monthly/yearly) | same |
| `description` | POST/PATCH body | trimmed, 1 to 200 chars; control characters accepted. **GAP**, task 2 | same |
| `paused` | PATCH body | boolean | `templatePatchSchema` |
| `nextDate` | POST body | `YYYY-MM-DD` | `newTemplateSchema` |

## Settings

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `businessName` | business-profile PUT | blank becomes null; trimmed, at most 120 chars | `businessProfileSchema`, `api/_lib/businessProfile.ts` |
| `businessAddress` | same | at most 500 chars | same |
| `paymentBankName` | same | at most 80 chars | same |
| `paymentSortCode` | same | `^\d{6}$` or null | same |
| `paymentAccountNumber` | same | `^\d{8}$` or null; stored and returned masked | same |
| `invoicePrefix` | same | trimmed, 1 to 12 chars; no charset rule. **GAP**, task 2 | same |
| `nextInvoiceNumber` | same | integer 1 to 999,999,999 | same |
| `nino` | tax-identifiers PUT | HMRC NINO pattern, upper-cased; encrypted at rest | `taxIdentifiersSchema`, `api/_lib/taxIdentifiers.ts` |
| `utr` | same | `^\d{10}$` | same |
| `vatNumber` | vat-number PUT | string; spaces and a leading GB removed, then `^\d{9}$` | `normaliseVatNumber`, `api/_lib/vatNumber.ts` |
| `taxYear` | trading-allowance GET query, PUT body | key of `TAX_BANDS` and a real period | `taxYearField`, `api/_lib/tradingAllowance.ts` |
| `method` | trading-allowance PUT body | `actual` or `allowance` | `tradingAllowanceChoiceSchema` |

## HMRC

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `live` | mode POST body | boolean; going live also needs `HMRC_SANDBOX_MODE=false` | `api/hmrc/mode.ts`, `api/hmrc/connect.ts` |
| `state` | callback query | HMAC-signed value naming the user; invalid or missing gives 400. This is the credential for this public route | `verifiedStateUserId`, `src/lib/hmrc/client.ts` |
| `code` | callback query | any non-empty string, passed to the HMRC token endpoint; no length cap. **GAP**, task 2 | `api/hmrc/callback.ts` |
| `error` | callback query | presence only | `api/hmrc/callback.ts` |
| `businessId` | its-businesses POST body | string, 1 to 40 chars; no charset rule; also checked against the businesses HMRC returned. **GAP** (charset), task 2 | `chooseBusinessSchema`, `api/hmrc/its-businesses.ts` |

Public route: `api/hmrc/callback.ts` is the only route outside `withAuth` besides login, MFA and logout.

## VAT

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `periodKey` | body (preview, return, return-confirm, submit); query (return GET) | string 1 to 20 chars; no charset rule. **GAP**, task 2 | `periodSchema`, `api/_lib/vatReturns.ts` |
| `start`, `end` | same | `YYYY-MM-DD` regex; calendar validity and ordering not checked by the schema. **GAP**, task 2 | `periodSchema` |
| `reopen` | return POST body | optional boolean | `saveBodySchema` |
| `declaration` | return-confirm body | literal `true`, else 422 | `confirmBodySchema` |
| `confirm` | submit body | literal `true`; boxes are never read from the body | `api/vat/submit.ts` |
| `from`, `to`, `status` | obligations query | `YYYY-MM-DD`, real dates, `from` not after `to`, range capped; `status` is `O` or `F` | `parseQuery`, `api/vat/obligations.ts` |
| `periodKey` | filed query | non-empty, at most 20 chars; URL-encoded before it goes to HMRC. **GAP** (charset), task 2 | `api/vat/filed.ts` |

The VAT submit route has no per-client rate limit (comment in `api/vat/submit.ts`); a single claim per period stops double filing.

## Reports and export

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `from`, `to` | entries-export query | `YYYY-MM-DD`, range at most 366 days, row cap; spreadsheet formula characters (`= + - @`) are prefixed on output | `parseExportRange`, `api/_lib/entriesExport.ts` |
| export file name | response header | built from validated dates only | `api/entries-export.ts` |
| `preset` | profit-and-loss query | one of the preset names, else 400 | `parseProfitAndLossPeriod` |
| `start`, `end` | profit-and-loss query | real `YYYY-MM-DD` dates, `start` not after `end` | same |
| `taxYear` | tax-estimate, tax-year-summary query | key of `TAX_BANDS` and a real period | `parseEstimateTaxYear`, `parseTaxYearPeriod` |
| dashboard | GET, no input | method only | `api/dashboard.ts` |

## Cron

| Input | Where | Rule | Enforced in |
| --- | --- | --- | --- |
| `Authorization` header | all three cron routes | must equal `Bearer <CRON_SECRET>`, compared as SHA-256 digests with `timingSafeEqual`; no secret configured means 401 | `api/cron/*.ts` |

Cron routes read no body or query.

## Trusted headers

| Header | Used for | Rule | Enforced in |
| --- | --- | --- | --- |
| `Cookie` (`stf_session`, `stf_mfa_challenge`) | session and MFA challenge | signed, expiring tokens; cookies are HttpOnly, Secure, SameSite=Lax | `api/_lib/ownerSession.ts` |
| `x-vercel-forwarded-for`, `x-forwarded-for` | HMRC fraud header client IP and port | first entry only; must pass `isIP`; port digits 0 to 65535 | `src/lib/hmrc/fraudHeaders.ts` |
| `x-stf-device-id` | `Gov-Client-Device-ID` | uuid regex, else omitted | same |
| `x-stf-timezone` | `Gov-Client-Timezone` | `^UTC[+-]\d{2}:\d{2}$`, else omitted | same |
| `x-stf-screens` | `Gov-Client-Screens` | each entry matches the screen pattern, else omitted; no overall length cap. **GAP**, task 2 | same |
| `x-stf-window-size` | `Gov-Client-Window-Size` | `^width=\d+&height=\d+$` | same |
| `x-stf-do-not-track` | `Gov-Client-Browser-Do-Not-Track` | `true` or `false` | same |
| `x-stf-js-user-agent` | `Gov-Client-Browser-JS-User-Agent` | percent-encoded; no pattern and no length cap. **GAP**, task 2 | same |

These headers only describe the device to HMRC. A forged value cannot change what the owner sees or reach the database.

## Input classes that do not exist

Checked on 2026-10-31 against this branch.

| Class | Present? | Evidence |
| --- | --- | --- |
| File upload | No | `grep -rniE "multipart\|formData\|type=.file\|FileReader\|<input[^>]*file" src api server/src` finds no code; no storage client or upload route exists. Receipt upload is planned in `PLAN.md`, not built |
| Webhook | No | no route verifies a signature; `grep -rniE webhook src api server/src` finds nothing in code |
| Imported file (CSV, bank statement) | No | export exists (`api/entries-export.ts`), import does not; no CSV parser is used on request data |
| Rich text or markdown | No | no markdown library in `package.json`; `grep -rnE "dangerouslySetInnerHTML\|innerHTML" src` finds nothing, so all user text renders as React text |
| User-supplied links | No | no field stores a URL; the only `<img src>` is a server-generated QR data URL in `src/pages/AuthenticatorSection.tsx` |
| AI input | Prompt only | `src/lib/receiptPrompt.ts` builds a fixed system prompt and an optional `imageNote`, and `parseReceiptDraft` only checks the reply is a JSON object (**GAP**: no schema check, task 4). Nothing in `api/` or `src/` imports it yet, so no user text reaches a model today |

When one of these classes is added, move its row into the tables above in the same pull request.
