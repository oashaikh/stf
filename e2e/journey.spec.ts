import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { mockApi } from './mockApi';

const mocked = process.env.JOURNEY_MOCK === '1';
const ownerPassword = mocked ? 'mock-owner-password' : process.env.JOURNEY_OWNER_PASSWORD;
const runName = process.env.JOURNEY_RUN_NAME ?? new Date().toISOString().replace(/[:.]/g, '-');
const screenshotDir = path.join('e2e', 'artifacts', runName);

// The login and the one entry added through the form are the only writes the journey may make; the preview is a POST that computes and stores nothing.
const ALLOWED_WRITES = new Set(['POST /api/auth/login', 'POST /api/entries', 'PATCH /api/entries', 'POST /api/vat/preview']);
// Set to commit the VAT screens as review evidence: <width>-light-<step>.png.
const evidenceDir = process.env.JOURNEY_EVIDENCE_DIR;
const evidenceWidths = [1440, 390];

test('owner signs in and walks Dashboard, Expenses, VAT preview and Settings', async ({ page }) => {
  test.skip(!ownerPassword, 'Set JOURNEY_OWNER_PASSWORD and JOURNEY_BASE_URL to run against a deployed URL');
  mkdirSync(screenshotDir, { recursive: true });

  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  // Playwright tries the newest route first, so this guard sees every request and falls back to the mock for the ones it allows.
  const blockedWrites: string[] = [];
  if (mocked) await mockApi(page, ownerPassword!);
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
  await step('vat-review', async () => {
    await openVatReview(page);
    if (!mocked) return;
    await expect(boxRow(page, 1)).toContainText('£100.00');
    await expect(boxRow(page, 6)).toContainText('£500.00');
    await captureEvidence(page, 'vat-boxes');
  });
  if (mocked) {
    await step('vat-drill-down', async () => {
      await page.getByRole('button', { name: /^Box 1\b|VAT due on sales/ }).first().click();
      const line = page.getByRole('link', { name: /Invoice 1001 website build/ });
      await expect(line).toContainText('£500.00 + £100.00 VAT');
      await expect(line).toHaveAttribute('href', /^\/expenses\?.*#entry-entry-1$/);
      await captureEvidence(page, 'vat-drill-down');
    });
  }
  await step('vat-preview', async () => {
    // The button only exists once the return is confirmed. Confirming is a write, so a draft return fails here rather than being confirmed.
    const preview = page.getByRole('button', { name: 'Preview what will be sent' });
    await expect(preview, 'the first open VAT return is not confirmed; the journey never confirms or submits').toBeVisible();
    await preview.click();
    const sent = page.getByRole('table', { name: 'Boxes exactly as they will be sent' });
    await expect(sent).toBeVisible();
    if (!mocked) return;
    // The body fields only appear by name in the raw JSON, so open it and read the two figures the entry must reach.
    await page.getByText('Raw JSON').click();
    const rawBody = page.locator('pre');
    await expect(rawBody).toContainText('"vatDueSales": 100,');
    await expect(rawBody).toContainText('"totalValueSalesExVAT": 500,');
    await captureEvidence(page, 'vat-preview');
  });
  await step('settings', openPage('/settings', 'Settings'));
});

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
  await expect(status.or(choices.first())).toBeVisible();
  if (await choices.count()) await choices.first().check();
  await expect(status).toBeVisible();
}
