# First-time setup

A new user is walked through four steps one at a time: business type, VAT registered or not, connect HMRC, connect the bank. Each step can be skipped, and a skipped step comes back as a to-do on Home.

## How it works

- After sign-in, Home sends anyone with unfinished setup to `/setup`, once per page load. Skipping or finishing lands on Home without bouncing back.
- Progress is stored per user by `api/settings/setup.ts` (answers, skipped steps, finished time). Whether HMRC, the bank and a VAT number are already in place is read from the existing connection and settings calls, so known steps show as done and only ask for confirmation.
- Step order, wording and the to-do list are in `src/lib/setupFlow.ts`. `setupTodos` returns the unfinished steps as title, plain sentence and link, for Home to list.
- Connecting HMRC or the bank leaves the app. `ReturnToSetup` brings the user back to `/setup` afterwards.
- HMRC runs in sandbox mode. The setup step says so and has no live switch.

## Checking it

`JOURNEY_MOCK=1 npx playwright test -g "new user"` walks the flow against the mocked API, finished and skipped, and writes screenshots to `browser-evidence/STF-123/`.
