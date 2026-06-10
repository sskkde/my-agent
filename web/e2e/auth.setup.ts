import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

const TEST_USERNAME = 'testuser';
const TEST_PASSWORD = 'testpassword123';

setup('authenticate', async ({ page, request }) => {
  const setupStatusResponse = await request.get('/api/v1/setup/status');
  const setupStatus = await setupStatusResponse.json();

  await page.goto('/');

  if (setupStatus.data.needsSetup) {
    await expect(page.getByTestId('admin-username-input')).toBeVisible();
    await page.getByTestId('admin-username-input').fill(TEST_USERNAME);
    await page.getByTestId('admin-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('admin-confirm-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('admin-create-submit').click();
  } else {
    await expect(page.getByTestId('login-username')).toBeVisible();
    await page.getByTestId('login-username').fill(TEST_USERNAME);
    await page.getByTestId('login-password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
  }

  await page.waitForSelector('[data-testid="sidebar"], [data-testid="product-nav"]', { timeout: 10000 });
  await page.context().storageState({ path: authFile });
});
