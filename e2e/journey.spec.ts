import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { mockApi, mockMfaCode, mockVatStates, type MockVatState } from './mockApi';

const mocked = process.env.JOURNEY_MOCK === '1';
const ownerPassword = mocked ? 'mock-owner-password' : process.env.JOURNEY_OWNER_PASSWORD;
const runName = process.env.JOURNEY_RUN_NAME ?? new Date().toISOString().replace(/[:.]/g, '-');
// The platform journey runner sets AIP_EVIDENCE_DIR; a local run keeps its screenshots under e2e/artifacts.
const evidenceRoot = process.env.AIP_EVIDENCE_DIR ?? path.join('e2e', 'artifacts', runName);

// The login and the one entry added through the form are the only writes the journey may make; the preview is a POST that computes and stores nothing.
// Opening a return that has never been reviewed makes the app save a draft (PUT); that is neither a confirmation nor a filing.
const ALLOWED_WRITES = new Set(['POST /api/auth/login', 'POST /api/entries', 'PATCH /api/entries', 'POST /api/vat/preview', 'PUT /api/vat/return']);
// Set to commit the VAT screens as review evidence: <width>-light-<step>.png.
const evidenceDir = process.env.JOURNEY_EVIDENCE_DIR;
const evidenceWidths = [1440, 390];

// A deployed run takes whatever VAT state the live data is in; the mocked run walks each state in turn.
const vatStates: Array<MockVatState | null> = mocked ? mockVatStates : [null];

for (const mockVatState of vatStates) {
test(`owner signs in and walks Dashboard, Expenses, VAT and Settings${mockVatState ? ` (VAT: ${mockVatState})` : ''}`, async ({ page }) => {
  test.skip(!ownerPassword, 'Set JOURNEY_OWNER_PASSWORD and JOURNEY_BASE_URL to run against a deployed URL');
  const screenshotDir = mockVatState && process.env.AIP_EVIDENCE_DIR ? path.join(evidenceRoot, mockVatState) : evidenceRoot;
  mkdirSync(screenshotDir, { recursive: true });

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  // Playwright tries the newest route first, so this guard sees every request and falls back to the mock for the ones it allows.
  const blockedWrites: string[] = [];
  if (mocked) await mockApi(page, ownerPassword!, mockVatState ?? 'confirmed');
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    if (request.method() === 'GET' || ALLOWED_WRITES.has(key)) return route.fallback();
    blockedWrites.push(key);
    return route.abort();
  });

  let stepNumber = 0;
  async function step(name: string, action: () => Promise<void>) {
    stepNumber += 1;
    const shot = path.join(screenshotDir, `${String(stepNumber).padStart(2, '0')}-${name.replace(/\W+/g, '-')}.png`);
    try {
      await action();
      expect(blockedWrites, 'a write other than login or preview was attempted').toEqual([]);
      expect(consoleErrors, 'console errors on the page').toEqual([]);
      await page.screenshot({ path: shot, fullPage: true });
    } catch (error) {
      const failedShot = shot.replace(/\.png$/, '-FAILED.png');
      await page.screenshot({ path: failedShot, fullPage: true }).catch(() => undefined);
      // The platform reads this line to name the failing step.
      console.log(`JOURNEY_FAILED_STEP: ${name}`);
      throw new Error(`Journey step "${name}" failed at ${page.url()} (screenshot: ${failedShot})\n${(error as Error).message}`);
    }
  }

  const openPage = (route: string, heading: string) => async () => {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  };

  await step('sign-in', async () => {
    await page.goto('/');
    await expect(page.getByLabel('Password')).toBeVisible();
    // The signed-out probe of /api/me answers 401 by design and the browser logs it as an error.
    consoleErrors.length = 0;
    await page.getByLabel('Password').fill(ownerPassword!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });
  await step('dashboard', openPage('/dashboard', 'Dashboard'));
  await step('expenses', openPage('/expenses', 'Expenses'));
  // Mocked only: a deployed run must not write a test entry into the owner's books.
  if (mocked) {
    await step('add-income-entry', async () => {
      await page.getByRole('button', { name: 'Add entry' }).click();
      await page.getByRole('button', { name: 'Money in' }).click();
      await page.getByLabel('Date').fill('2026-05-15');
      await page.getByLabel('Description').fill('Invoice 1001 website build');
      await page.getByLabel('Amount in pounds').fill('500.00');
      await page.getByLabel('Net (before VAT)').check({ force: true });
      await page.getByLabel('VAT rate').selectOption('20');
      await page.getByLabel('Category').selectOption({ label: 'Sales' });
      await page.getByRole('button', { name: 'Save as draft' }).click();
      await expect(page.getByText('Invoice 1001 website build')).toBeVisible();
      // The form saves drafts and has no confirm control yet; a draft is not in the return, so confirm through the API as the ledger needs.
      await page.evaluate(() => fetch('/api/entries?id=entry-1', { method: 'PATCH', body: JSON.stringify({ status: 'confirmed' }) }));
    });
  }
  await step('vat-obligations', openPage('/vat', 'VAT Returns'));
  // The entry's figures are only checked where the mocked return is confirmed and still open, so the preview is reachable.
  const checkFigures = mockVatState === 'confirmed';
  await step('vat-review', async () => {
    await openVatReview(page);
    if (!checkFigures) return;
    await expect(boxRow(page, 1)).toContainText('£100.00');
    await expect(boxRow(page, 6)).toContainText('£500.00');
    await captureEvidence(page, 'vat-boxes');
  });
  if (checkFigures) {
    await step('vat-drill-down', async () => {
      await page.getByRole('button', { name: /^Box 1\b|VAT due on sales/ }).first().click();
      const line = page.getByRole('link', { name: /Invoice 1001 website build/ });
      await expect(line).toContainText('£500.00 + £100.00 VAT');
      await expect(line).toHaveAttribute('href', /^\/expenses\?.*#entry-entry-1$/);
      await captureEvidence(page, 'vat-drill-down');
    });
  }
  await step('vat-state', async () => {
    const preview = page.getByRole('button', { name: 'Preview what will be sent' });
    const branch = await vatBranch(page);
    console.log(`JOURNEY_VAT_BRANCH: ${branch}`);
    if (branch === 'nothing-due') {
      await expect(page.getByText('No open VAT obligations to file.')).toBeVisible();
    } else if (branch === 'unconfirmed') {
      // Confirming is a write, so an unconfirmed return is only checked for what it shows.
      await expect(page.getByRole('table', { name: 'VAT return boxes for the period' }).getByRole('row')).toHaveCount(10);
      await expect(page.getByRole('group', { name: 'Declaration' })).toBeVisible();
    } else if (branch === 'filed') {
      await expect(page.getByText(/^Form bundle number:/)).toBeVisible();
    } else {
      await preview.click();
      await expect(page.getByRole('table', { name: 'Boxes exactly as they will be sent' })).toBeVisible();
      if (!checkFigures) return;
      // The body fields only appear by name in the raw JSON, so open it and read the two figures the entry must reach.
      await page.getByText('Raw JSON').click();
      const rawBody = page.locator('pre');
      await expect(rawBody).toContainText('"vatDueSales": 100,');
      await expect(rawBody).toContainText('"totalValueSalesExVAT": 500,');
      await captureEvidence(page, 'vat-preview');
    }
  });
  await step('reports', openPage('/reports', 'Reports'));
  await step('settings', openPage('/settings', 'Settings'));
});
}

const boxRow = (page: Page, box: number) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: String(box), exact: true }) });

async function captureEvidence(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  const original = page.viewportSize()!;
  for (const width of evidenceWidths) {
    await page.setViewportSize({ width, height: 900 });
    // Fixed chrome would be drawn mid-page in a full-page capture and hide content.
    const hideChrome = await page.addStyleTag({ content: 'header, nav { position: static !important; }' });
    await page.screenshot({ path: path.join(evidenceDir, `${width}-light-${name}.png`), fullPage: true });
    await hideChrome.evaluate((node) => node.remove());
  }
  await page.setViewportSize(original);
}

async function openVatReview(page: Page) {
  // With several open obligations the page waits for a choice; the first listed is taken.
  const choices = page.getByRole('radio');
  const status = page.getByText(/^Status:/);
  const nothingDue = page.getByText('No open VAT obligations to file.');
  await expect(status.or(choices.first()).or(nothingDue)).toBeVisible();
  if (await choices.count()) await choices.first().check();
  await expect(status.or(nothingDue)).toBeVisible();
}

type VatBranch = 'nothing-due' | 'unconfirmed' | 'confirmed' | 'filed';

async function vatBranch(page: Page): Promise<VatBranch> {
  if (await page.getByText('No open VAT obligations to file.').isVisible()) return 'nothing-due';
  if (await page.getByRole('button', { name: 'Preview what will be sent' }).isVisible()) return 'confirmed';
  // Confirmed but no preview button means HMRC already holds a receipt for the period.
  if (await page.getByText(/^Form bundle number:/).isVisible()) return 'filed';
  return 'unconfirmed';
}

// Mock mode only: it turns the second factor on and signs out, which the read-only deployed journey must never do.
test('owner sets up the authenticator, signs out, and signs back in with password then code', async ({ page }) => {
  test.skip(!mocked, 'Writes settings and signs out, so it only runs against the mock (JOURNEY_MOCK=1)');
  const evidenceDir = path.join('browser-evidence', 'STF-90');
  mkdirSync(evidenceDir, { recursive: true });
  await mockApi(page, ownerPassword!);

  let stepNumber = 0;
  async function capture(name: string) {
    stepNumber += 1;
    const original = page.viewportSize();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      // A full-page capture paints the sticky header and fixed tab bar at the viewport offset, mid-page over the content being shown.
      // Hiding them keeps the page at the real viewport width; making it static puts both bars in one row and widens the page.
      const hideFixedBars = await page.addStyleTag({ content: '.sticky, .fixed { display: none !important; }' });
      await page.screenshot({ path: path.join(evidenceDir, `${String(stepNumber).padStart(2, '0')}-${name}-${width}-light.png`), fullPage: true });
      await hideFixedBars.evaluate((node) => node.remove());
    }
    if (original) await page.setViewportSize(original);
  }

  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByText('Authenticator is off')).toBeVisible();
  await capture('settings-authenticator-off');

  await page.getByRole('button', { name: 'Set up authenticator' }).click();
  await expect(page.getByAltText('QR code for setting up the authenticator app')).toBeVisible();
  await expect(page.getByTestId('authenticator-secret')).toBeVisible();
  await capture('scan-qr-code');

  await page.getByLabel('Code from the app').fill(mockMfaCode);
  await page.getByRole('button', { name: 'Turn on authenticator' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'aaaa-1111' })).toBeVisible();
  await capture('recovery-codes');

  await page.getByLabel('I have saved these recovery codes').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Authenticator is on')).toBeVisible();
  await capture('authenticator-on');

  await page.getByRole('button', { name: 'Sign out' }).click();
  // The gate does not swap to the login page by itself after sign-out in the built app (see report); opening the site again shows what a fresh visit sees.
  await page.goto('/');
  await expect(page.getByLabel('Password')).toBeVisible();
  await page.getByLabel('Password').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await capture('login-code-step');

  await page.getByLabel('Authenticator code').fill(mockMfaCode);
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await capture('dashboard-after-code');
});
