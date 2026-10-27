# Recurring entries

Templates for regular income and costs — rent, subscriptions, salaries — that create draft transactions on a schedule. The owner confirms entries from the Expenses list, never auto-confirmed.

## Template fields

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | UUID | No | Primary key |
| `userId` | UUID FK | No | Owner; every query scoped to the session user |
| `kind` | `income` \| `expense` | No | Fixed once created |
| `categoryAccountId` | UUID FK (accounts) | No | Fixed once created; must belong to the owner |
| `amountPence` | integer | No | Gross or net per `amountIs`; positive; no floats |
| `amountIs` | `gross` \| `net` | No | How `amountPence` is interpreted when posting |
| `vatRatePercent` | integer | Yes | 0, 5, or 20; null defaults to 0 |
| `description` | text | No | Up to 200 characters; shown on drafts |
| `schedule` | `monthly` \| `yearly` | No | Recurring period |
| `anchorDay` | integer | No | Day of month (1–31) stored at creation; used for month-end clamping |
| `nextDate` | date (ISO 8601) | No | When the next cron run will create a draft |
| `paused` | boolean | No | When true, cron skips the template |
| `createdAt` / `updatedAt` | timestamp | No | |
| `deletedAt` | timestamp | Yes | Soft delete marker; archived templates do not generate entries |

### Fixed fields

Once a template is created, `kind`, `categoryAccountId`, and `schedule` cannot be changed. To alter them, delete and recreate the template.

### Amount and VAT

The `amountIs` field controls how VAT is calculated when posting:
- **`gross`:** `amountPence` is the gross total; VAT is computed and deducted to calculate the net.
- **`net`:** `amountPence` is the net amount; VAT is added to compute the gross.

`vatRatePercent` is ignored if the owner has no VAT number; all lines post with 0% VAT.

## Schedule and month-end rule

Monthly and yearly templates advance on the calendar, with month-end clamping to prevent drift.

### Monthly schedule

Each month, on the stored day. If the day does not exist in the target month (e.g., 31st in February), the date clamps to the last day of the month.

Example: A template with `anchorDay: 31` set on 31 January will:
- Generate 31 Jan, 28 Feb (29 in a leap year), 31 Mar, 30 Apr, 31 May, …

The clamping stays fixed to the anchor day, so the next occurrence after 28 Feb is always 31 Mar, not 28 Mar or 30 Mar — the 31st re-appears.

### Yearly schedule

Every 12 months on the same day. Month-end clamping still applies.

Example: A template with `anchorDay: 29` set on 29 February (a leap year) will:
- Generate 29 Feb (in leap years) and 28 Feb (in non-leap years).

## Idempotency via the run ledger

A `recurringEntryRuns` table records every (template, date) already created, with a unique key to prevent the same date being generated twice even if cron runs overlap or retry.

**Flow:**
1. Cron scan fetches due templates.
2. For each due date, before creating a draft, check if `(templateId, runDate)` exists in the runs table.
3. If it already ran, skip.
4. If not, create the draft with `createEntry`, which commits in its own transaction.
5. Then claim the date: one transaction inserts the run record and moves `nextDate`. If the insert hits the unique key (another process claimed the date), or the claim fails for any other reason, the draft is voided so the date exists once.

A process crash between steps 4 and 5 can still leave one draft with no run record; the owner can void it from the Expenses list.

The run record holds the date, the generated transaction id, and creation time. It is never deleted — it is the audit trail of when each template ran.

## Drafts only and confirmation

Generated entries are always `status: draft`. They post to the ledger as debit/credit lines with the appropriate VAT amount, but they do not count towards VAT returns, invoices, or tax estimates until confirmed.

The owner sees generated drafts in the Expenses list, marked with their template description. The existing confirm action on the Expenses page moves the status to `confirmed` — no separate workflow or UI for template entries.

A draft can be edited (amount, date, account, VAT) or voided like any other entry, using the standard Expenses page controls. The template remains independent: editing a draft does not change the template, and the next cron run will generate the next date even if an earlier draft was edited or voided.

## Cron setup and CRON_SECRET

A daily cron job triggers the entry generator.

### Vercel configuration

**Schedule:** `0 5 * * *` (5 AM UTC daily)

**Endpoint:** `GET /api/cron/create-recurring-entries` (Vercel Cron issues GET)

**Timeout:** 60 seconds (sufficient for the catch-up cap below)

**Authorization:** The cron request carries `Authorization: Bearer $CRON_SECRET`. The handler verifies it using timing-safe comparison before running any code. If `CRON_SECRET` is not set in the environment, all requests are rejected with 401.

### Secret setup

`CRON_SECRET` is a shared secret between the Vercel deployment and the owner's environment. It must be configured in the Vercel project settings under Environment Variables. It is not user-supplied like `ANTHROPIC_API_KEY`; it is unique to the deployment.

**In `.env.example`:** Listed but empty, so local development and self-hosted instances can set their own value.

**In production:** Set in Vercel project settings. Never commit a real secret to the repository.

### Logs

Successful runs log: `[create-recurring-entries] created=N skipped=M`

- **created:** Count of entries successfully generated.
- **skipped:** Count of entries that could not be generated (see "Error handling" below).

Error logs carry the template id only, never the description or entry amount. Authorization failures are logged by the framework.

### Error handling

If a template's date falls inside a locked VAT period, or the category account is archived, or the posting function rejects the entry, that template is skipped and the count incremented. The template's `nextDate` is left unchanged so the next cron run will retry it.

Other templates still run: a problem with one does not halt the whole job.

If every due date was skipped (none were created), the response status is 500 to alert monitoring systems that no progress was made — there is a degradation, though not necessarily an outage.

## Catch-up cap

A template left untouched for months or years could back up hundreds of due dates. To prevent the cron from generating hundreds of drafts in one run and overloading the UI:

- **Per template, per run:** At most 12 due dates are generated (per-template limit in `generateDueEntries`).
- **Per run, across templates:** At most 200 templates are scanned (global limit).

A larger backlog is picked up by the next cron run. The owner sees drafts trickle in and can confirm them as they go.

When a template is paused, neither cap is triggered: paused templates are skipped entirely.

## Retention

### Soft delete

Removing a template sets `deletedAt` and archives it from the Expenses list. It is never deleted from the database (`DELETE FROM` is forbidden for financial records).

Once deleted, no new entries are created, even if the `nextDate` advances. Existing drafts created by the template are independent and remain unaffected.

### Kept with the books

Deleted templates are kept in the database with their audit trail (creation, update, deletion timestamps) so that:
1. A future dispute ("Did we set up rent in 2024?") can be answered by inspecting the template history.
2. The run ledger permanently records which template generated each entry, linking back to the original terms.

A future enhancement could allow un-pausing or restoring a deleted template and resuming generation from a new date, but that is out of scope. For now, restore means recreate.

## Posting and amounts

Generated entries are posted by the same function as manual entries (`createEntry` in `api/_lib/entries.ts`), applying the same posting rules:

- Entries are split by VAT rate into ledger lines (one per rate).
- Income entries post as credits; expense entries as debits.
- The VAT amount is carried on each line with the appropriate rate.
- If the owner has no VAT number, all lines post with 0% VAT regardless of the template's rate.

The owner cannot change the posting rules for templates; they are the same as for manual entries.

## Audit trail

Each generated entry writes the same entry audit events as any other transaction, and posts with source `manual`; templates have no source of their own yet. Template changes (create, edit, pause, delete) are not audited; the run ledger records which template produced which entry.

## Interaction with VAT periods

A period lock (STF-66) prevents editing or creating entries inside a confirmed or filed VAT period. If a template's due date falls inside a locked period, that date is skipped and logged. The template's `nextDate` is not advanced, so the next cron run will retry it. This prevents transactions from "slipping" past the lock if they happen to be created late.

The period lock applies to all entry creation routes, including cron-generated templates, so templates cannot inadvertently bypass period integrity.
