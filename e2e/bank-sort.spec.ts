import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { mockApi } from './mockApi';

const mocked = process.env.JOURNEY_MOCK === '1';
const ownerPassword = 'mock-owner-password';
const evidenceDir = path.join('browser-evidence', 'STF-38');

// Mock mode only: the Bank page's sort flow, from proposals to "All sorted", as review evidence for STF-38.
test('owner sorts bank payments until none are left', async ({ page }) => {
  test.skip(!mocked, 'Uses the mocked bank API (JOURNEY_MOCK=1)');
  mkdirSync(evidenceDir, { recursive: true });
  await mockApi(page, ownerPassword);
  await page.goto('/');
  await page.getByLabel('Password').fill(ownerPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();

  await page.goto('/bank');
  await expect(page.getByRole('heading', { name: 'Sort your bank payments' })).toBeVisible();
  await expect(page.getByText('Same amount, same day')).toBeVisible();

  const shoot = async (name: string) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      // The fixed menu would be drawn mid-page in a full-page capture.
      const hideFixedBars = await page.addStyleTag({ content: '.sticky, .fixed { display: none !important; }' });
      await page.screenshot({ path: path.join(evidenceDir, `${name}-${width}-light.png`), fullPage: true });
      await hideFixedBars.evaluate((node) => node.remove());
    }
  };
  await shoot('proposals');

  await page.getByRole('button', { name: 'Yes, match it' }).click();
  await expect(page.getByText('Example Client Ltd')).toHaveCount(0);
  for (const description of ['Example Stationery', 'Example Train Co']) {
    await page.getByRole('button', { name: 'Add as new payment' }).first().click();
    await expect(page.getByText(description)).toHaveCount(0);
  }
  await expect(page.getByText('All sorted. Every bank payment is matched or set aside.')).toBeVisible();
  await shoot('all-sorted');
});
