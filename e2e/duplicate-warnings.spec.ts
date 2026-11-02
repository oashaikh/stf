import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mockApi, repeatReceipt } from './mockApi';

const mocked = process.env.JOURNEY_MOCK === '1';
const ownerPassword = 'mock-owner-password';
const evidenceDir = path.join('browser-evidence', 'STF-50');

const expense = (id: string, date: string) => ({
  id, date, description: 'Example Cafe', reference: null, status: 'confirmed', kind: 'expense', grossPence: 1200,
  categoryAccountId: 'acc-expense-1', categoryName: 'Office costs', netPence: 1000, vatPence: 200, hasReceipt: false,
});

async function shoot(page: Page, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The fixed menu would be drawn mid-page in a full-page capture.
    const hideFixedBars = await page.addStyleTag({ content: '.sticky, .fixed { display: none !important; }' });
    await page.screenshot({ path: path.join(evidenceDir, `${name}-${width}-light.png`), fullPage: true });
    await hideFixedBars.evaluate((node) => node.remove());
  }
}

// Mock mode only: each screen that carries a possible-duplicate notice, as review evidence for STF-50.
test('owner sees possible-duplicate notices on four screens', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked API (JOURNEY_MOCK=1)');
  mkdirSync(evidenceDir, { recursive: true });
  await mockApi(page, ownerPassword);
  // Registered last, so these entries win over the mock's empty list.
  await page.route(/\/api\/entries(\?|$)/, (route) => route.fulfill({ json: { entries: [expense('entry-a', '2026-10-27'), expense('entry-b', '2026-10-28')], nextCursor: null } }));
  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  await page.goto('/money-out');
  await page.getByRole('button', { name: 'Add entry' }).click();
  await page.getByLabel('Date').fill('2026-10-29');
  await page.getByLabel('Description').fill('Example Cafe');
  await page.getByLabel('Amount in pounds').fill('12.00');
  await expect(page.getByText(/which you already added/).first()).toBeVisible();
  await shoot(page, 'entry-form');

  await page.goto('/money-out');
  await expect(page.getByText(/This looks like/).first()).toBeVisible();
  await shoot(page, 'expenses-list');

  await page.goto('/money-out/receipts');
  await expect(page.getByText(/same file as a receipt you already added/)).toBeVisible();
  await shoot(page, 'receipts-list');

  await page.goto(`/money-out/receipts/${repeatReceipt.id}`);
  await expect(page.getByText(/same file as a receipt you already added/)).toBeVisible();
  await shoot(page, 'receipt-review');

  const title = {
    'entry-form': ['Typing an expense that matches one already added shows a notice, and you can still save it', 'on a phone, the same notice sits above the Save button'],
    'expenses-list': ['The Expenses list marks repeats of the same amount and supplier a few days apart', 'on a phone, the same notice sits above the list'],
    'receipts-list': ['A receipt uploaded twice shows a notice you can dismiss', 'on a phone, the notice sits under the receipt'],
    'receipt-review': ['Checking a receipt warns when it is the same file as one you already added', 'on a phone, the notice sits above the fields to check'],
  } as const;
  const captions = Object.fromEntries(Object.entries(title).flatMap(([name, [wide, narrow]]) => [
    [`${name}-1440-light.png`, { title: wide }],
    [`${name}-390-light.png`, { title: narrow }],
  ]));
  writeFileSync(path.join(evidenceDir, 'captions.json'), `${JSON.stringify(captions, null, 2)}\n`);
});
