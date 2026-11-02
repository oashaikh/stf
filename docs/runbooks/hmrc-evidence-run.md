# HMRC sandbox evidence run

The script `npm run hmrc:evidence` creates test users in the HMRC sandbox, signs in as each of them, and calls every API endpoint STF uses. HMRC watches the logs for these calls in the 2 weeks after you email your approval request. See `docs/hmrc/mtd-itsa-minimum-functionality.md` for why HMRC requires this evidence.

**Note:** This runbook was written during development. The evidence run has not yet been executed, so no real evidence note exists yet. The owner will run this script after merging all code and produce the actual evidence that HMRC will review.

## Prerequisites

1. Create a sandbox application in the HMRC Developer Hub, subscribed to both VAT (MTD) and Income Tax (ITSA).
2. Get the application's `client_id` and `client_secret` and set them as environment variables:
   ```bash
   export HMRC_CLIENT_ID=...
   export HMRC_CLIENT_SECRET=...
   ```
3. Have Node.js and npm available locally (the same as for `npm run dev` and `npm test`).

## Running the evidence

The script makes a HTTP request to HMRC each time. Run it only in a fresh terminal, in the same directory as `package.json`:

1. Set the client credentials (above) if not already exported.
2. Run `npm ci` to install dependencies.
3. Run `npm run hmrc:evidence`.

The script will create test users and save their sign-in details in `.hmrc-sandbox-users.json` (not committed, local only). Then it tells you what to do next.

## Signing in via browser

The script needs a refresh token from each test user. HMRC only issues refresh tokens after the user signs in through their own browser. The script prints step-by-step instructions when it is ready; follow them exactly.

1. Open the message the script printed. It shows two user IDs and their passwords.
2. In your browser, go to `https://sandbox.tax.service.gov.uk/` and sign in as the organisation user first, then approve the OAuth flow.
3. When redirected back, copy the organisation refresh token that HMRC shows in the browser (shown once).
4. Set the token and sign in again as the individual:
   ```bash
   export HMRC_SANDBOX_VAT_REFRESH_TOKEN=...
   export HMRC_SANDBOX_REFRESH_TOKEN=...
   ```
5. Back in the terminal, run `npm run hmrc:evidence` again. The script now runs all 21 API calls and writes the results.

## Reading the evidence note

The script writes to `docs/hmrc/evidence/hmrc-sandbox-run-YYYY-MM-DD.md`. Open the file. It has:

- The date of the run.
- The test user IDs and their business IDs (VRN for VAT, NINO masked for Income Tax).
- A table with one row per API call: the endpoint, the result (PASS or FAIL), and the detail.

All rows should show PASS. If any shows FAIL, the detail column gives the HMRC error code. If a later step depends on data from an earlier step and that step failed, later steps will show "needs X from an earlier step".

## Reruns

To run the evidence again later:

1. Set the client credentials and refresh tokens again (they do not expire during a single calendar day, but rotate monthly).
2. Run `npm run hmrc:evidence`.

The script reuses the test users from `.hmrc-sandbox-users.json` rather than creating new ones. If the file is lost or a refresh token becomes invalid, delete the file and start from "Signing in via browser" above; the script will create new test users.

## Template: what the owner quotes to HMRC

Send the evidence note to HMRC in the approval email to `SDSTeam@hmrc.gov.uk`. Quote the run date, the test user IDs, the endpoints and the result count. Example:

> We completed a sandbox test run on 5 November 2026 with two test users:
> - Organisation (VAT): user 12345, VRN 345678901234567
> - Individual (Income Tax): user 67890, NINO (masked)
>
> All 21 calls to your APIs passed, covering fraud prevention headers, VAT obligations and returns, Income Tax quarterly and annual submissions, adjustable summary, tax calculation and final declaration. See the attached evidence run.

Keep the NINO masked (do not quote it in full). Keep the attachment as a markdown file, not a screenshot or PDF.
