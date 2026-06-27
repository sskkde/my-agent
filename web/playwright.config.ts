import { defineConfig, devices } from '@playwright/test';

const webPort = 3102;
const apiPort = 3103;

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
      name: 'setup',
      testMatch: '**/*.setup.ts',
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'login-mobile',
      testMatch: '**/login-mobile.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // No storageState - tests run in unauthenticated state
      },
      // No setup dependency - tests handle their own auth state
    },
    {
      name: 'amap-e2e',
      testMatch: '**/amap-shared-map.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        // No storageState — test harness page is standalone, no auth required
      },
      // No setup dependency — harness page doesn't need authentication
    },
  ],
  webServer: [
    {
      command: 'npm --prefix .. run reset:e2e-db && npm --prefix .. run start:api:e2e',
      url: `http://localhost:${apiPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: `VITE_PORT=${webPort} VITE_API_TARGET=http://localhost:${apiPort} npm run dev`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
});
