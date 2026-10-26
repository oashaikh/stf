# HMRC sandbox integration tests

The suite in `src/lib/hmrc/sandbox.integration.test.ts` calls the HMRC test API
(`test-api.service.hmrc.gov.uk`) through `src/lib/hmrc/client.ts`. It covers
token refresh, VAT obligations, an expired-token refresh via `withHmrcToken`,
a VAT return submission, and rejection of a duplicate submission
(`Gov-Test-Scenario: DUPLICATE_SUBMISSION`).

## When it runs

It runs as part of `npm test`, but every test is skipped unless all of these
are set: `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`, `HMRC_SANDBOX_REFRESH_TOKEN`,
`HMRC_SANDBOX_VRN`. It is also skipped if `HMRC_SANDBOX_MODE=false`, so it can
never reach the live API. With no secrets, CI stays green with the suite skipped.

## Setting up the credentials

1. In the HMRC Developer Hub, create a sandbox application subscribed to VAT (MTD).
2. Create a sandbox test user with the VAT (MTD) service and note its VRN.
3. Run the OAuth connect flow once against the sandbox as that test user (Settings, Connect HMRC, or `/api/hmrc/connect`) and copy the refresh token from the stored token set.
4. Add `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`, `HMRC_SANDBOX_REFRESH_TOKEN` and `HMRC_SANDBOX_VRN` as CI secrets exposed to the test step. Never commit them.

## Running locally

```bash
HMRC_CLIENT_ID=... HMRC_CLIENT_SECRET=... HMRC_SANDBOX_REFRESH_TOKEN=... \
HMRC_SANDBOX_VRN=... npx vitest run src/lib/hmrc/sandbox.integration.test.ts
```

## Troubleshooting

- `invalid_grant` on refresh: the sandbox refresh token expired or was revoked. Repeat step 3 and update the secret.
- Submission test fails with a period or obligation error: the sandbox test user's stub data changed; adjust `periodKey` in the test.
- The suite has not yet been run against the live sandbox from this repository; confirm the first CI run with real secrets.
