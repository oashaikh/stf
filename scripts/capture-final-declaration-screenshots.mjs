import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { join } from 'path';

const baseUrl = 'http://localhost:5173';
const outDir = './browser-evidence/STF-30';

async function captureScreenshots() {
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.createBrowserContext();

  // Mock the auth by setting session cookie
  await context.addCookies([
    {
      name: 'session',
      value: 'test-session-value',
      url: baseUrl,
    },
  ]);

  const page = await context.newPage();

  // Set viewport for 1440px width
  await page.setViewportSize({ width: 1440, height: 800 });

  try {
    // Navigate to Tax page
    console.log('Capturing Tax page...');
    await page.goto(`${baseUrl}/tax`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {
      console.log('Navigation timed out, proceeding with screenshot');
    });

    // Wait a bit for page to fully load
    await page.waitForTimeout(2000);

    // Take 1440px screenshot
    await page.screenshot({
      path: join(outDir, '1440-light-tax-page.png'),
      fullPage: true,
    });
    console.log('✓ Captured 1440-light-tax-page.png');

    // Set viewport for 390px width
    await page.setViewportSize({ width: 390, height: 800 });
    await page.screenshot({
      path: join(outDir, '390-light-tax-page.png'),
      fullPage: true,
    });
    console.log('✓ Captured 390-light-tax-page.png');

    // Navigate to final declaration flow (2026-27)
    console.log('Capturing Final Declaration flow...');
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(`${baseUrl}/tax/final-declaration/2026-27`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {
      console.log('Navigation timed out, proceeding with screenshot');
    });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: join(outDir, '1440-light-final-declaration-check.png'),
      fullPage: true,
    });
    console.log('✓ Captured 1440-light-final-declaration-check.png');

    await page.setViewportSize({ width: 390, height: 800 });
    await page.screenshot({
      path: join(outDir, '390-light-final-declaration-check.png'),
      fullPage: true,
    });
    console.log('✓ Captured 390-light-final-declaration-check.png');
  } finally {
    await browser.close();
  }
}

captureScreenshots().catch(console.error);
