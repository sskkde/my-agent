import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

const TEST_USERNAME = 'testuser';
const TEST_PASSWORD = 'testpassword123';

setup('authenticate', async ({ page, request }) => {
  const setupStatusResponse = await request.get('/api/setup/status');
  const setupStatus = await setupStatusResponse.json();

  await page.goto('/');

  if (setupStatus.data.needsSetup) {
    await expect(page.getByTestId('setup-username')).toBeVisible();
    await page.getByTestId('setup-username').fill(TEST_USERNAME);
    await page.getByTestId('setup-password').fill(TEST_PASSWORD);
    await page.getByTestId('setup-submit').click();
  } else {
    await expect(page.getByTestId('login-username')).toBeVisible();
    await page.getByTestId('login-username').fill(TEST_USERNAME);
    await page.getByTestId('login-password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
  }

  await page.waitForSelector('[data-testid="tab-dashboard"]', { timeout: 10000 });
  await page.context().storageState({ path: authFile });
});
