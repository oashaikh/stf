import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { mockApi } from './mockApi';

const mocked = process.env.JOURNEY_MOCK === '1';
const ownerPassword = 'mock-owner-password';
const evidenceDir = path.join('browser-evidence', 'STF-37');

// Mock mode only: suggested categories appear on tap and nothing is added until the owner accepts.
test('owner asks for category suggestions and accepts one as a draft', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked bank API (JOURNEY_MOCK=1)');
  mkdirSync(evidenceDir, { recursive: true });
  await mockApi(page, ownerPassword);
  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  await page.goto('/bank');
  await page.getByRole('button', { name: 'Suggest categories' }).click();
  await expect(page.getByText('Looks like Office costs')).toBeVisible();

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The fixed menu would be drawn mid-page in a full-page capture.
    const hideFixedBars = await page.addStyleTag({ content: '.sticky, .fixed { display: none !important; }' });
    await page.screenshot({ path: path.join(evidenceDir, `suggestions-${width}-light.png`), fullPage: true });
    await hideFixedBars.evaluate((node) => node.remove());
  }

  await page.getByRole('button', { name: 'Yes, add it as a draft' }).click();
  await expect(page.getByText('Example Stationery')).toHaveCount(0);
});
