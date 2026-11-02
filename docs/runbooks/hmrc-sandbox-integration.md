# HMRC sandbox integration tests

The suite in `src/lib/hmrc/sandbox.integration.test.ts` calls the HMRC test API
(`test-api.service.hmrc.gov.uk`) through `src/lib/hmrc/client.ts`. It covers
token refresh, VAT obligations, an expired-token refresh via `withHmrcToken`,
a VAT return submission, rejection of a duplicate submission
(`Gov-Test-Scenario: DUPLICATE_SUBMISSION`), and listing self-employment
businesses for Income Tax (ITSA).

## When it runs

It runs as part of `npm test`, but every test is skipped unless all of these
are set: `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`, `HMRC_SANDBOX_REFRESH_TOKEN`,
`HMRC_SANDBOX_VRN`, `HMRC_SANDBOX_NINO`. It is also skipped if `HMRC_SANDBOX_MODE=false`, so it can
never reach the live API. With no secrets, CI stays green with the suite skipped.

## Setting up the credentials

1. In the HMRC Developer Hub, create a sandbox application subscribed to VAT (MTD) and Income Tax (ITSA).
2. Create a sandbox test user with the VAT (MTD) and Income Tax (ITSA) services, and note its VRN and NINO.
3. Run the OAuth connect flow once against the sandbox as that test user (Settings, Connect HMRC, or `/api/hmrc/connect`) and copy the refresh token from the stored token set.
4. Add `HMRC_CLIENT_ID`, `HMRC_CLIENT_SECRET`, `HMRC_SANDBOX_REFRESH_TOKEN`, `HMRC_SANDBOX_VRN`, and `HMRC_SANDBOX_NINO` as CI secrets exposed to the test step. Never commit them.

## Running locally

```bash
HMRC_CLIENT_ID=... HMRC_CLIENT_SECRET=... HMRC_SANDBOX_REFRESH_TOKEN=... \
HMRC_SANDBOX_VRN=... HMRC_SANDBOX_NINO=... npx vitest run src/lib/hmrc/sandbox.integration.test.ts
```

## UK property integration

Three more tests cover the Property Business and Obligations endpoints the app uses for rental income:
listing businesses filtered to `uk-property` (`listItsPropertyBusinesses`), property quarterly obligations
(`getItsIncomeAndExpenditureObligations` with `typeOfBusiness=uk-property`) and the cumulative property
`PUT` (`submitPropertyCumulativeSummary`, Property Business API 6.0). The app does not call a retrieve
endpoint, so none is tested. They need a sandbox test user that has a UK property business; without
one the obligations and submit tests fail on purpose rather than skip. Each sends the fraud prevention
headers. Same credentials and same sandbox-only guard as the rest of the suite. See
`docs/workflows/its-property-update.md`.

## Income Tax integration

The suite includes tests for:

1. Listing self-employment and UK property businesses from the HMRC Income Tax API
2. Submitting cumulative quarterly updates for self-employment and UK property
3. Submitting annual allowances for self-employment and UK property

This requires:

1. The sandbox application to be subscribed to Income Tax (ITSA) in the Developer Hub.
2. A test user enrolled for both VAT (MTD) and Income Tax (ITSA).
3. The test user's NINO captured in `HMRC_SANDBOX_NINO`.
4. For property tests: the test user must have a UK property business. If not present, property tests will fail rather than skip.

When the owner has connected HMRC and sees the "Income Tax needs a one-time reconnect" notice in Settings, they reconnect and choose a self-employment and/or UK property business from the list returned by the API.

Income Tax obligations on the Tax page also need `HMRC_ITSA_ENABLED=true`; see `docs/workflows/its-obligations.md`.

## Troubleshooting

- `invalid_grant` on refresh: the sandbox refresh token expired or was revoked. Repeat step 3 in Setting up the credentials and update the secret.
- Submission test fails with a period or obligation error: the sandbox test user's stub data changed; adjust `periodKey` in the test.
- Income Tax business listing test fails or appears skipped: confirm `HMRC_SANDBOX_NINO` is set as a CI secret and that the sandbox test user is enrolled for Income Tax (ITSA).
- The suite has not yet been run against the live sandbox from this repository; confirm the first CI run with real secrets.
