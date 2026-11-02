# HMRC sandbox evidence run

The script `npm run hmrc:evidence` (in `scripts/hmrcSandboxEvidence.ts`) creates test users in the HMRC sandbox and calls every API endpoint STF uses. HMRC checks their logs for these API calls in the **2 weeks following your approval email** to `SDSTeam@hmrc.gov.uk`. Run this script no more than **2 weeks before** sending that email. See `docs/hmrc/mtd-itsa-minimum-functionality.md` for why HMRC requires this evidence.

**Status:** The script was built during development. The evidence run has not yet been executed with real sandbox credentials, so no evidence note yet exists. After all code merges, the owner will run this script and produce the actual evidence that HMRC will review.

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

The script will create test users and save their sign-in details in `.hmrc-sandbox-users.json` (not committed, local only). Then it stops and asks for a refresh token for each user (next section).

## Getting a refresh token for each test user

HMRC never displays a refresh token. You get one by signing in as the test user through the OAuth authorisation-code flow for your sandbox application, then exchanging the code. Do this once for the organisation and once for the individual.

1. Add `https://localhost/callback` as a redirect URI on the sandbox application in the Developer Hub (any URI you control works; it only has to match in steps 2 and 3).
2. Open `https://test-www.tax.service.gov.uk/oauth/authorize?response_type=code&client_id=<HMRC_CLIENT_ID>&scope=read:vat%20write:vat%20read:self-assessment%20write:self-assessment&redirect_uri=https%3A%2F%2Flocalhost%2Fcallback`, sign in as the test user (password in `.hmrc-sandbox-users.json`) and grant access.
3. The browser lands on a page that fails to load. Copy the `code` value from its address bar. It is single use and short lived.
4. Exchange it: `curl -s https://test-api.service.hmrc.gov.uk/oauth/token -d grant_type=authorization_code -d client_id=$HMRC_CLIENT_ID -d client_secret=$HMRC_CLIENT_SECRET -d code=<code> -d redirect_uri=https://localhost/callback`
5. Export `refresh_token` from the reply: `HMRC_SANDBOX_VAT_REFRESH_TOKEN` for the organisation, `HMRC_SANDBOX_REFRESH_TOKEN` for the individual. Then run `npm run hmrc:evidence` again.

## Reading the evidence note

The script writes to `docs/hmrc/evidence/hmrc-sandbox-run-YYYY-MM-DD.md`. Open the file. It has:

- The date of the run.
- The test user IDs and their business IDs (VRN for VAT, NINO masked for Income Tax).
- A table with one row per API call: the endpoint, the result (PASS or FAIL), and the detail.

All rows should show PASS. If any shows FAIL, the detail column gives the HMRC error code. If a later step depends on data from an earlier step and that step failed, later steps will show "needs X from an earlier step".

## Reruns

To run the evidence again later:

1. Set the client credentials and refresh tokens again (a refresh token that HMRC has invalidated needs the steps above again).
2. Run `npm run hmrc:evidence`.

The script reuses the test users from `.hmrc-sandbox-users.json` rather than creating new ones. If the file is lost or a refresh token becomes invalid, delete the file and start from "Getting a refresh token" above; the script will create new test users.

## Template: what the owner quotes to HMRC

Send the evidence note to HMRC in the approval email to `SDSTeam@hmrc.gov.uk`. Quote the run date, the test user IDs, the endpoints and the result count. Example:

> We completed a sandbox test run on 5 November 2026 with two test users:
> - Organisation (VAT): user 12345, VRN 345678901234567
> - Individual (Income Tax): user 67890, NINO (masked)
>
> All <N> steps in the attached note passed (<N> is the step count the script printed), covering fraud prevention headers, VAT obligations and returns, Income Tax quarterly and annual submissions, adjustable summary, tax calculation and final declaration. See the attached evidence run.

Keep the NINO masked (do not quote it in full). Keep the attachment as a markdown file, not a screenshot or PDF.
