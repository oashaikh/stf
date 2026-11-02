import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { journeyTotpCode, writeIsAllowed } from './writeGuard';
import { mockApi, mockItsObligations, mockMfaCode, mockVatStates, type MockVatState } from './mockApi';

const mocked = process.env.JOURNEY_MOCK === '1';
const ownerPassword = mocked ? 'mock-owner-password' : process.env.JOURNEY_OWNER_PASSWORD;
const runName = process.env.JOURNEY_RUN_NAME ?? new Date().toISOString().replace(/[:.]/g, '-');
// The platform journey runner sets AIP_EVIDENCE_DIR; a local run keeps its screenshots under e2e/artifacts.
const evidenceRoot = process.env.AIP_EVIDENCE_DIR ?? path.join('e2e', 'artifacts', runName);

// A live run may only read and sign in (see writeGuard.ts); the mock run may write, so the entry form and the preview are walked there.
const journeyTotpSecret = process.env.JOURNEY_TOTP_SECRET;
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
    if (writeIsAllowed(key, mocked)) return route.fallback();
    blockedWrites.push(key);
    return route.abort();
  });

  let stepNumber = 0;
  async function step(name: string, action: () => Promise<void>) {
    stepNumber += 1;
    const shot = path.join(screenshotDir, `${String(stepNumber).padStart(2, '0')}-${name.replace(/\W+/g, '-')}.png`);
    try {
      await action();
      expect(blockedWrites, 'a write other than the login was attempted against a live URL').toEqual([]);
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

  let missingTotpSecret = false;
  await step('sign-in', async () => {
    await page.goto('/');
    await expect(page.getByLabel('Password')).toBeVisible();
    // The signed-out probe of /api/me answers 401 by design and the browser logs it as an error.
    consoleErrors.length = 0;
    await page.getByLabel('Password').fill(ownerPassword!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const codeField = page.getByLabel('Authenticator code');
    const dashboard = page.getByRole('heading', { level: 1, name: 'Home' });
    await expect(dashboard.or(codeField)).toBeVisible();
    if (await codeField.isVisible()) {
      missingTotpSecret = !journeyTotpSecret;
      if (missingTotpSecret) return;
      await codeField.fill(journeyTotpCode(journeyTotpSecret!));
      await page.getByRole('button', { name: 'Verify' }).click();
    }
    await expect(dashboard).toBeVisible();
  });
  // Not a failure: the owner's account is protected and this run was given no way past it. It sits outside the step because a skip thrown inside one is reported as a failure.
  if (missingTotpSecret) console.log('JOURNEY_SKIPPED: 2FA on, no journey secret (set JOURNEY_TOTP_SECRET to the authenticator secret)');
  test.skip(missingTotpSecret, '2FA on, no journey secret');
  await step('dashboard', openPage('/home', 'Home'));
  await step('expenses', openPage('/money-out', 'Money out'));
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
    await step('recurring-entries', async () => {
      // Reload so the add-entry form above is closed; its Money in toggle and fields share names with this form's.
      await page.goto('/expenses');
      await page.getByRole('button', { name: 'Add recurring entry' }).click();
      await page.getByRole('button', { name: 'Money in' }).click();
      await page.getByLabel('Description').fill('Retainer from Acme');
      await page.getByLabel('First date').fill('2026-11-30');
      await page.getByLabel('Amount in pounds').fill('250.00');
      await page.getByLabel('Category').selectOption({ label: 'Sales' });
      await page.getByRole('button', { name: 'Save recurring entry' }).click();
      const row = page.getByRole('row', { name: /Retainer from Acme/ });
      await expect(row).toContainText('£250.00');
      await captureEvidence(page, 'expenses-recurring');
      await page.getByRole('button', { name: 'Pause Retainer from Acme' }).click();
      await expect(row).toContainText('Paused');
      await page.getByRole('button', { name: 'Resume Retainer from Acme' }).click();
      await expect(row).toContainText('Active');
      await page.getByRole('button', { name: 'Delete Retainer from Acme' }).click();
      await expect(page.getByRole('dialog')).toContainText('Delete Retainer from Acme?');
      await page.getByRole('button', { name: 'Delete template' }).click();
      await expect(page.getByText('No recurring entries yet.')).toBeVisible();
    });
  }
  // Mocked only: the mock's open obligation is past due, so the reminder card shows; a deployed run depends on the owner's real obligations.
  if (mocked && mockVatState !== 'none') {
    await step('dashboard-vat-reminder', async () => {
      await page.goto('/home');
      const card = page.getByRole('heading', { name: 'Upcoming VAT return' }).locator('xpath=ancestor::section[1]');
      await expect(card.getByText('7 Aug 2026')).toBeVisible();
      await expect(card.getByText('VAT you owe HMRC')).toBeVisible();
      await captureEvidence(page, 'dashboard-vat-reminder');
      await card.getByRole('link', { name: 'Review VAT return' }).click();
      await expect(page).toHaveURL(/\/tax\/vat$/);
    });
  }
  await step('vat-obligations', openPage('/tax/vat', 'VAT Returns'));
  // The entry's figures are only checked where the mocked return is confirmed and still open, so the preview is reachable.
  const checkFigures = mockVatState === 'confirmed';
  await step('vat-review', async () => {
    await openVatReview(page);
    if (!checkFigures) return;
    await expect(boxGroup(page, 'VAT you charged on sales')).toContainText('£100.00');
    await expect(boxGroup(page, 'Your sales, before VAT')).toContainText('£500.00');
    await captureEvidence(page, 'vat-boxes');
  });
  if (checkFigures) {
    await step('vat-drill-down', async () => {
      await boxGroup(page, 'VAT you charged on sales').getByRole('button', { name: 'Why is this amount?' }).click();
      const line = page.getByRole('link', { name: /Invoice 1001 website build/ });
      await expect(line).toContainText('£500.00 + £100.00 VAT');
      await expect(line).toHaveAttribute('href', /^\/money-out\?.*#entry-entry-1$/);
      await captureEvidence(page, 'vat-drill-down');
    });
  }
  await step('vat-state', async () => {
    if (await page.getByText('You have no VAT return to file right now.').isVisible()) {
      console.log('JOURNEY_VAT_BRANCH: nothing-due');
      return;
    }
    // The last step of the guided flow: one sentence, the declaration and the send button.
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/^You're telling HMRC you/)).toBeVisible();
    const branch = await vatBranch(page);
    console.log(`JOURNEY_VAT_BRANCH: ${branch}`);
    if (branch === 'unconfirmed') {
      // Confirming is a write, so an unconfirmed return is only checked for what it shows.
      await expect(page.getByRole('group', { name: 'Declaration' })).toBeVisible();
    } else if (branch === 'filed') {
      await expect(page.getByText(/^Form bundle number:/)).toBeVisible();
    } else {
      const send = page.getByRole('button', { name: /^Send to HMRC/ });
      // The send dialog fetches a preview (a POST), so a live run only checks the button is there.
      if (!mocked) return await expect(send).toBeVisible();
      await send.click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Show all nine boxes' }).click();
      await expect(dialog.getByRole('table', { name: 'Boxes exactly as they will be sent' })).toBeVisible();
      if (checkFigures) {
        // The body fields only appear by name in the raw JSON, so open it and read the two figures the entry must reach.
        await dialog.getByText('Raw JSON').click();
        await expect(dialog.locator('pre')).toContainText('"vatDueSales": 100,');
        await expect(dialog.locator('pre')).toContainText('"totalValueSalesExVAT": 500,');
        await captureEvidence(page, 'vat-send');
      }
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    }
  });
  await step('reports', async () => {
    await openPage('/tax/reports', 'Tax')();
    if (evidenceDir) {
      await captureEvidence(page, 'reports');
      // Test error state: set a date range that exceeds the limit (400 days)
      await page.getByLabel('Period').selectOption('custom');
      const fromInput = page.getByLabel('From', { exact: true });
      const toInput = page.getByLabel('To', { exact: true });
      const originalFrom = await fromInput.inputValue();
      const originalTo = await toInput.inputValue();
      // Set a range that will exceed EXPORT_MAX_RANGE_DAYS (366)
      await fromInput.fill('2025-01-01');
      await toInput.fill('2026-02-01');
      await page.getByRole('button', { name: 'Download entries CSV' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'too much to export' })).toBeVisible();
      await captureEvidence(page, 'reports-error');
      // Restore original values
      await fromInput.fill(originalFrom);
      await toInput.fill(originalTo);
    }
  });
  await step('settings', openPage('/settings', 'Settings'));

  // The menu has six items at both widths, and each one opens its page.
  await step('six-menu-items', async () => {
    const menuItems: Array<[string, string]> = [
      ['Home', 'Home'], ['Money in', 'Money in'], ['Money out', 'Money out'],
      ['Bank', 'Bank'], ['Tax', 'Tax'], ['Settings', 'Settings'],
    ];
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/home');
      const links = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
      await expect(links).toHaveCount(6);
      for (const [label, heading] of menuItems) {
        await links.filter({ hasText: label }).first().click();
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      }
    }
  });

  await step('old-addresses-redirect', async () => {
    const oldAddresses = [
      ['/dashboard', /\/home$/], ['/invoices', /\/money-in$/], ['/expenses', /\/money-out$/],
      ['/receipts', /\/money-out\/receipts$/], ['/vat', /\/tax\/vat$/], ['/reports', /\/tax\/reports$/], ['/tax', /\/tax\/income-tax$/],
    ] as const;
    for (const [from, to] of oldAddresses) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });
});
}

// Mock mode only: the invoice view with its Download PDF button, as review evidence for STF-79.
test('owner opens an invoice and sees the Download PDF button', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked invoice API (JOURNEY_MOCK=1)');
  const evidenceDir = path.join('browser-evidence', 'STF-79');
  mkdirSync(evidenceDir, { recursive: true });
  await mockApi(page, ownerPassword!);
  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  await page.goto('/money-in');
  await page.getByRole('button', { name: /INV-0042/ }).click();
  const download = page.getByRole('button', { name: 'Download PDF' });
  await expect(download).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const hideFixedBars = await page.addStyleTag({ content: '.sticky, .fixed { display: none !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `invoice-view-${width}-light.png`), fullPage: true });
    await hideFixedBars.evaluate((node) => node.remove());
  }
});

// Mock mode only: the Income Tax obligations section on the Tax page, fresh and then HMRC-down, as review evidence for STF-84.
test('owner sees Income Tax obligations with the next due one marked, and last known dates when HMRC is down', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked obligations API (JOURNEY_MOCK=1)');
  const evidenceDir = path.join('browser-evidence', 'STF-84');
  mkdirSync(evidenceDir, { recursive: true });
  await mockApi(page, ownerPassword!);
  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  await page.goto('/tax/income-tax');
  await expect(page.getByRole('heading', { name: 'Income Tax updates due' })).toBeVisible();
  await expect(page.getByText('Next due')).toHaveCount(1);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const hideFixedBars = await page.addStyleTag({ content: '.sticky, .fixed { display: none !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(evidenceDir, `tax-obligations-${width}-light.png`), fullPage: true });
    await hideFixedBars.evaluate((node) => node.remove());
  }

  // A later route wins, so this swaps in HMRC's failure answer for the same URL.
  await page.route('**/api/hmrc/its-obligations', (route) =>
    route.fulfill({
      json: { ok: true, stale: true, fetchedAt: '2026-10-20T09:00:00.000Z', error: 'HMRC could not be reached just now.', obligations: mockItsObligations },
    }),
  );
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Showing last known dates' })).toBeVisible();
});

// Mock mode only: the guided quarterly update on its own screen, walked from the Tax page, as review evidence for STF-86.
test('owner walks the guided quarterly update from the Tax page to the confirmation', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked Income Tax update API (JOURNEY_MOCK=1)');
  const evidenceDir = path.join('browser-evidence', 'STF-86');
  mkdirSync(evidenceDir, { recursive: true });
  await mockApi(page, ownerPassword!);
  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  const capture = async (name: string) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const hideFixedBars = await page.addStyleTag({ content: '.sticky, .fixed { display: none !important; }' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: path.join(evidenceDir, `${name}-${width}-light.png`), fullPage: true });
      await hideFixedBars.evaluate((node) => node.remove());
    }
  };

  await page.goto('/tax/income-tax');
  await expect(page.getByText('Loading mileage')).toHaveCount(0);
  await capture('1-obligations');
  await page.getByRole('link', { name: 'Send your update' }).click();
  await expect(page).toHaveURL(/\/tax\/update\/2026-27\/2$/);
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await capture('2-step1-income');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await capture('3-step2-costs');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('checkbox').check();
  await capture('4-step3-send');
  await page.getByRole('button', { name: 'Send to HMRC' }).click();
  await expect(page.getByText('HMRC has your update')).toBeVisible();
  await capture('5-sent');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page).toHaveURL(/\/tax\/income-tax$/);
});

const boxGroup = (page: Page, label: string) => page.getByRole('group', { name: label, exact: true });

async function captureEvidence(page: Page, name: string) {
  if (!evidenceDir) return;
  mkdirSync(evidenceDir, { recursive: true });
  const original = page.viewportSize()!;
  for (const width of evidenceWidths) {
    await page.setViewportSize({ width, height: 900 });
    // Fixed chrome would be drawn mid-page in a full-page capture and hide content. Static alone would put the phone
    // bottom bar inside the header row and widen the page past the viewport, so the header wraps and the bar takes its own row.
    const hideChrome = await page.addStyleTag({
      content: 'header, nav { position: static !important; } header { flex-wrap: wrap; } nav[aria-label="Main"] { width: 100%; }',
    });
    await page.screenshot({ path: path.join(evidenceDir, `${width}-light-${name}.png`), fullPage: true });
    await hideChrome.evaluate((node) => node.remove());
  }
  await page.setViewportSize(original);
}

async function openVatReview(page: Page) {
  // With several open obligations the page waits for a choice; the first listed is taken.
  const choices = page.getByRole('radio');
  const status = page.getByText(/^Status:/);
  const nothingDue = page.getByText('You have no VAT return to file right now.');
  await expect(status.or(choices.first()).or(nothingDue)).toBeVisible();
  if (await choices.count()) {
    await choices.first().check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  await expect(status.or(nothingDue)).toBeVisible();
}

type VatBranch = 'unconfirmed' | 'confirmed' | 'filed';

async function vatBranch(page: Page): Promise<VatBranch> {
  if (await page.getByRole('group', { name: 'Declaration' }).isVisible()) return 'unconfirmed';
  // Confirmed but no send button means HMRC already holds a receipt for the period.
  if (await page.getByText(/^Form bundle number:/).isVisible()) return 'filed';
  return 'confirmed';
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
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

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
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await capture('dashboard-after-code');
});

// Mock mode only: first-time setup walked as a brand-new user, once finished and once skipped, as review evidence for STF-123.
// The app ships no dark theme, so the captures are light only (see review-notes.md).
const setupEvidenceDir = path.join('browser-evidence', 'STF-123');

async function signInAsNewUser(page: Page) {
  await mockApi(page, ownerPassword!, 'confirmed', true);
  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/setup$/);
}

// Viewport captures, not full-page, so the menu and header show around the setup screen.
async function captureSetupScreen(page: Page, name: string) {
  for (const width of evidenceWidths) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(setupEvidenceDir, `${name}-${width}-light.png`) });
  }
}

test('new user is walked through setup, answers every step and lands on Home with no to-dos', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked setup API (JOURNEY_MOCK=1)');
  mkdirSync(setupEvidenceDir, { recursive: true });
  await signInAsNewUser(page);

  await expect(page.getByRole('heading', { level: 1, name: 'What kind of business do you run?' })).toBeVisible();
  await captureSetupScreen(page, 'finished-1-business-type');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Are you registered for VAT?' })).toBeVisible();
  await page.getByLabel('Yes').check();
  await page.getByLabel('Your VAT number').fill('123456789');
  await captureSetupScreen(page, 'finished-2-vat');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Connect to HMRC' })).toBeVisible();
  await captureSetupScreen(page, 'finished-3-hmrc');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Connect your bank' })).toBeVisible();
  await captureSetupScreen(page, 'finished-4-bank');
  await page.getByRole('button', { name: 'Connect your bank' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'You are all set' })).toBeVisible();
  await captureSetupScreen(page, 'finished-5-all-set');
  await page.getByRole('button', { name: 'Go to Home' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finish setting up' })).toHaveCount(0);
  await captureSetupScreen(page, 'finished-6-home');
});

test('new user skips every setup step and finds them as to-dos on Home', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked setup API (JOURNEY_MOCK=1)');
  mkdirSync(setupEvidenceDir, { recursive: true });
  await signInAsNewUser(page);

  for (const title of ['What kind of business do you run?', 'Are you registered for VAT?', 'Connect to HMRC', 'Connect your bank']) {
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();
  }

  await expect(page.getByRole('heading', { level: 1, name: 'You are all set' })).toBeVisible();
  await captureSetupScreen(page, 'skipped-1-all-set');
  await page.getByRole('button', { name: 'Go to Home' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finish setting up' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Answer' })).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Connect HMRC' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Connect bank' })).toBeVisible();
  await captureSetupScreen(page, 'skipped-2-home-with-to-dos');
});
