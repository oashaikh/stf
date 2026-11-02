/**
 * Repeatable HMRC sandbox evidence run: `npm run hmrc:evidence`.
 * Sandbox only. Writes docs/hmrc/evidence/hmrc-sandbox-run-<date>.md and exits non-zero if any step fails.
 * See docs/hmrc/mtd-itsa-minimum-functionality.md for why HMRC wants this run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildFraudHeaders } from '../src/lib/hmrc/fraudHeaders.js';
import { hmrcApiBase, refreshAccessToken } from '../src/lib/hmrc/client.js';
import {
  createTestUsers,
  renderEvidenceNote,
  runEvidenceSteps,
  type CreatedTestUsers,
} from '../src/lib/hmrc/evidenceRun.js';

// HMRC shows a test user's password once, and refresh tokens belong to one user, so reruns reuse these users.
const USERS_FILE = '.hmrc-sandbox-users.json';
const TAX_YEAR = '2026-27';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.env.HMRC_SANDBOX_MODE === 'false' || !hmrcApiBase().includes('test-api')) {
  fail('Refusing to run: the evidence run only talks to the HMRC test API. Unset HMRC_SANDBOX_MODE or set it to true.');
}
if (!process.env.HMRC_CLIENT_ID || !process.env.HMRC_CLIENT_SECRET) {
  fail('Set HMRC_CLIENT_ID and HMRC_CLIENT_SECRET (the sandbox application) first.');
}

let users: CreatedTestUsers;
if (existsSync(USERS_FILE)) {
  users = JSON.parse(readFileSync(USERS_FILE, 'utf8')) as CreatedTestUsers;
} else {
  users = await createTestUsers(fetch);
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
}

const individualRefreshToken = process.env.HMRC_SANDBOX_REFRESH_TOKEN;
const organisationRefreshToken = process.env.HMRC_SANDBOX_VAT_REFRESH_TOKEN;
if (!individualRefreshToken || !organisationRefreshToken) {
  fail(
    [
      'Test users are ready, but each needs an OAuth sign-in to get a refresh token before the calls can run.',
      `  Organisation user id ${users.organisationUserId}, individual user id ${users.individualUserId}; passwords are in ${USERS_FILE} (local, not committed).`,
      '  Follow "Getting a refresh token for each test user" in docs/runbooks/hmrc-evidence-run.md.',
      '  Then set HMRC_SANDBOX_VAT_REFRESH_TOKEN (organisation) and HMRC_SANDBOX_REFRESH_TOKEN (individual) and run npm run hmrc:evidence again.',
    ].join('\n'),
  );
}

const [organisationTokens, individualTokens] = await Promise.all([
  refreshAccessToken(organisationRefreshToken),
  refreshAccessToken(individualRefreshToken),
]);

const now = new Date();
const fraudHeaders = buildFraudHeaders({
  request: new Request('https://stf.invalid/api/hmrc/evidence'),
  userId: 'sandbox-evidence-run',
  appVersion: 'evidence-run',
  now,
});

const results = await runEvidenceSteps({
  fetchFn: fetch,
  fraudHeaders,
  vat: { vrn: users.vrn, accessToken: organisationTokens.accessToken },
  its: { nino: users.nino, accessToken: individualTokens.accessToken },
  taxYear: TAX_YEAR,
});

const date = now.toISOString().slice(0, 10);
mkdirSync('docs/hmrc/evidence', { recursive: true });
const notePath = `docs/hmrc/evidence/hmrc-sandbox-run-${date}.md`;
writeFileSync(notePath, renderEvidenceNote({ date, users, results }));

for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}`);
console.log(`Note written to ${notePath}`);
process.exit(results.some((result) => !result.ok) ? 1 : 0);
