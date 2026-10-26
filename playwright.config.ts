import { defineConfig } from '@playwright/test';

const mocked = process.env.JOURNEY_MOCK === '1';
const baseURL = process.env.JOURNEY_BASE_URL ?? 'http://localhost:4173';

export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  // A retry would sign in again and hide which step really failed.
  retries: 0,
  use: {
    baseURL,
    viewport: { width: 390, height: 844 },
    launchOptions: { executablePath: process.env.JOURNEY_CHROMIUM_PATH },
  },
  // The mocked run serves the bundle from npm run build; the deployed run needs no local server.
  webServer: mocked
    ? { command: 'npm run preview -- --port 4173 --strictPort', url: baseURL, reuseExistingServer: true }
    : undefined,
});
