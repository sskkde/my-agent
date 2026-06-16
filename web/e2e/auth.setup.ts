import { test as setup, expect } from '@playwright/test';

const authFile = 'playwright/.auth/user.json';

const TEST_USERNAME = 'testuser';
const TEST_PASSWORD = 'testpassword123';

setup('authenticate', async ({ page, request }) => {
  const setupStatusResponse = await request.get('/api/v1/setup/status');
  const setupStatus = await setupStatusResponse.json();

  await page.goto('/');

  if (setupStatus.data.needsSetup) {
    // Step 1: Create admin user
    await expect(page.getByTestId('admin-username-input')).toBeVisible();
    await page.getByTestId('admin-username-input').fill(TEST_USERNAME);
    await page.getByTestId('admin-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('admin-confirm-password-input').fill(TEST_PASSWORD);
    await page.getByTestId('admin-create-submit').click();

    // Wait for step 2 (API Key) to appear
    await page.waitForTimeout(500);

    // Step 2: Skip API Key creation (optional step)
    const skipApiKeyButton = page.getByTestId('skip-api-key-btn');
    if (await skipApiKeyButton.isVisible().catch(() => false)) {
      await skipApiKeyButton.click();
      await page.waitForTimeout(500);
    }

    // Step 3: Complete setup
    const completeSetupButton = page.getByTestId('complete-setup-btn');
    if (await completeSetupButton.isVisible().catch(() => false)) {
      await completeSetupButton.click();
      await page.waitForTimeout(500);
    }
  } else {
    await expect(page.getByTestId('login-username')).toBeVisible();
    await page.getByTestId('login-username').fill(TEST_USERNAME);
    await page.getByTestId('login-password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
  }

  await page.waitForSelector('[data-testid="sidebar"], [data-testid="product-nav"]', { timeout: 10000 });
  await page.context().storageState({ path: authFile });
});
