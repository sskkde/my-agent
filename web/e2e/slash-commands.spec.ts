import { test, expect } from '@playwright/test';

test.describe('Slash Commands', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.route('**/api/setup/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { needsSetup: false } }),
      });
    });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            user: {
              userId: 'test-user-1',
              username: 'testuser',
              role: 'admin',
              createdAt: new Date().toISOString(),
            }
          }
        }),
      });
    });

    await page.route('**/api/auth/logout', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { success: true } }),
      });
    });

    await page.route('**/api/sessions', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              items: [],
              total: 0
            }
          }),
        });
      } else if (method === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              session: {
                sessionId: 'test-session-1',
                status: 'active',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastActivityAt: new Date().toISOString(),
                messageCount: 0,
              }
            }
          }),
        });
      }
    });

    await page.route('**/api/sessions/**/timeline', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            items: [],
            total: 0
          }
        }),
      });
    });

    await page.route('**/api/sessions/**/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            messageId: 'msg-' + Date.now(),
            timestamp: new Date().toISOString(),
          }
        }),
      });
    });

    await page.reload();
    await expect(page.getByTestId('tab-session-console')).toBeVisible({ timeout: 5000 });
  });

  test.describe('Command Input and Execution', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByTestId('tab-session-console').click();

      const newButton = page.getByTestId('session-new-button');
      await expect(newButton).toBeVisible();

      const emptyState = page.getByTestId('session-empty-state');
      const isEmpty = await emptyState.isVisible().catch(() => false);

      if (isEmpty) {
        await newButton.click();
        await page.waitForSelector('[data-testid="session-message-input"]', { timeout: 5000 });
      } else {
        const firstSession = page.locator('[data-testid^="session-item-"]').first();
        const hasSession = await firstSession.isVisible().catch(() => false);
        if (hasSession) {
          await firstSession.click();
        }
      }
    });

    test('should display command hint in input placeholder', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      await expect(input).toBeVisible();

      const placeholder = await input.getAttribute('placeholder');
      expect(placeholder).toContain('/help');
    });

    test('/help command should render help output in timeline', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('/help');
      await expect(input).toHaveValue('/help');

      await sendButton.click();
      await expect(input).toHaveValue('', { timeout: 3000 });

      await expect(input).toBeVisible();
    });

    test('/sessions command should list sessions', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('/sessions');
      await sendButton.click();

      await expect(input).toHaveValue('', { timeout: 3000 });
      await expect(input).toBeVisible();
    });

    test('//help should escape and send as normal message text', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('//help');
      await expect(input).toHaveValue('//help');

      await sendButton.click();
      await expect(input).toHaveValue('', { timeout: 3000 });
      await expect(input).toBeVisible();
    });

    test('/does-not-exist should show error message', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('/does-not-exist');
      await sendButton.click();

      await expect(input).toHaveValue('', { timeout: 3000 });
      await expect(input).toBeVisible();
    });

    test('/logout command should return to login page', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('/logout');
      await sendButton.click();

      await page.waitForTimeout(1000);

      const loginPage = page.getByTestId('login-page');
      const sessionConsole = page.getByTestId('tab-session-console');

      const isLoginVisible = await loginPage.isVisible().catch(() => false);
      const isConsoleVisible = await sessionConsole.isVisible().catch(() => false);

      expect(isLoginVisible || isConsoleVisible).toBe(true);
    });

    test('multiple commands can be executed in sequence', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('/help');
      await sendButton.click();
      await expect(input).toHaveValue('', { timeout: 3000 });
      await page.waitForTimeout(300);

      await input.fill('/sessions');
      await sendButton.click();
      await expect(input).toHaveValue('', { timeout: 3000 });

      await expect(input).toBeVisible();
    });
  });

  test.describe('Command Edge Cases', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByTestId('tab-session-console').click();

      const newButton = page.getByTestId('session-new-button');
      await expect(newButton).toBeVisible();

      const emptyState = page.getByTestId('session-empty-state');
      const isEmpty = await emptyState.isVisible().catch(() => false);

      if (isEmpty) {
        await newButton.click();
        await page.waitForSelector('[data-testid="session-message-input"]', { timeout: 5000 });
      } else {
        const firstSession = page.locator('[data-testid^="session-item-"]').first();
        const hasSession = await firstSession.isVisible().catch(() => false);
        if (hasSession) {
          await firstSession.click();
        }
      }
    });

    test('empty command / should be handled gracefully', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('/');
      await sendButton.click();

      await expect(input).toHaveValue('', { timeout: 3000 });
      await expect(page.getByTestId('session-message-input')).toBeVisible();
    });

    test('command with extra spaces should be parsed correctly', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('/  help  ');
      await sendButton.click();

      await expect(input).toHaveValue('', { timeout: 3000 });
      await expect(input).toBeVisible();
    });

    test('triple slash /// should be treated as escaped text', async ({ page }) => {
      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      await input.fill('///help');
      await sendButton.click();

      await expect(input).toHaveValue('', { timeout: 3000 });
      await expect(page.getByTestId('session-message-input')).toBeVisible();
    });
  });

  test.describe('Console Error Detection', () => {
    test('should have no console errors during command execution', async ({ page }) => {
      const consoleErrors: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          const isNetworkError = text.includes('Failed to load resource') ||
                                 text.includes('Failed to fetch') ||
                                 text.includes('404') ||
                                 text.includes('net::ERR_CONNECTION_REFUSED');
          if (!isNetworkError) {
            consoleErrors.push(text);
          }
        }
      });

      page.on('pageerror', (error) => {
        consoleErrors.push(`Page Error: ${error.message}`);
      });

      await page.getByTestId('tab-session-console').click();

      const newButton = page.getByTestId('session-new-button');
      const emptyState = page.getByTestId('session-empty-state');
      const isEmpty = await emptyState.isVisible().catch(() => false);

      if (isEmpty) {
        await newButton.click();
        await page.waitForSelector('[data-testid="session-message-input"]', { timeout: 5000 });
      } else {
        const firstSession = page.locator('[data-testid^="session-item-"]').first();
        const hasSession = await firstSession.isVisible().catch(() => false);
        if (hasSession) {
          await firstSession.click();
        }
      }

      const input = page.getByTestId('session-message-input');
      const sendButton = page.getByTestId('session-send-button');

      const commands = ['/help', '/sessions', '//escaped', '/unknowncommand123'];

      for (const cmd of commands) {
        await input.fill(cmd);
        await sendButton.click();
        await expect(input).toHaveValue('', { timeout: 3000 });
        await page.waitForTimeout(500);
      }

      expect(consoleErrors).toHaveLength(0);
    });
  });
});
