/**
 * Standalone Playwright config for AMap E2E tests.
 *
 * Only starts the Vite dev server — no API server or database required.
 * The amap-e2e harness page at /amap-e2e.html is fully self-contained
 * with mocked AMap JSAPI and mock timeline data.
 *
 * Usage:
 *   npx playwright test --config=playwright.amap.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const webPort = 3102;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'amap-e2e',
      testMatch: '**/amap-shared-map.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // No storageState — test harness page is standalone, no auth required
      },
    },
  ],
  webServer: {
    command: `VITE_PORT=${webPort} npm run dev`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
