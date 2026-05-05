# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web/e2e/tabs.spec.ts >> Full Tab Flow >> should switch to dashboard tab and show health status
- Location: web/e2e/tabs.spec.ts:15:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | test.describe('Full Tab Flow', () => {
  4   |   test.beforeEach(async ({ page }) => {
> 5   |     await page.goto('/');
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  6   |   });
  7   | 
  8   |   test('should display all four original tabs', async ({ page }) => {
  9   |     await expect(page.getByTestId('tab-dashboard')).toBeVisible();
  10  |     await expect(page.getByTestId('tab-session-console')).toBeVisible();
  11  |     await expect(page.getByTestId('tab-agent-monitor')).toBeVisible();
  12  |     await expect(page.getByTestId('tab-status')).toBeVisible();
  13  |   });
  14  | 
  15  |   test('should switch to dashboard tab and show health status', async ({ page }) => {
  16  |     await page.getByTestId('tab-dashboard').click();
  17  |     await page.waitForSelector('[data-testid="dashboard-health-status"]');
  18  |     await expect(page.getByTestId('dashboard-health-status')).toBeVisible();
  19  |   });
  20  | 
  21  |   test('should switch to session console tab', async ({ page }) => {
  22  |     await page.getByTestId('tab-session-console').click();
  23  |     await expect(page.getByTestId('session-new-button')).toBeVisible();
  24  |     await expect(page.getByTestId('session-empty-state')).toBeVisible();
  25  |   });
  26  | 
  27  |   test('should switch to agent monitor tab', async ({ page }) => {
  28  |     await page.getByTestId('tab-agent-monitor').click();
  29  |     await expect(page.getByTestId('agent-monitor-stream')).toBeVisible();
  30  |     await expect(page.getByTestId('runs-list')).toBeVisible();
  31  |   });
  32  | 
  33  |   test('should switch to status tab and show platform info', async ({ page }) => {
  34  |     await page.getByTestId('tab-status').click();
  35  |     await expect(page.getByTestId('status-panel')).toBeVisible();
  36  |     await expect(page.getByTestId('status-health-summary')).toBeVisible();
  37  |   });
  38  | 
  39  |   test('should send message in session console and verify input clears', async ({ page }) => {
  40  |     await page.getByTestId('tab-session-console').click();
  41  |     await expect(page.getByTestId('session-new-button')).toBeVisible();
  42  | 
  43  |     await page.getByTestId('session-new-button').click();
  44  | 
  45  |     try {
  46  |       await page.waitForSelector('[data-testid="session-message-input"]', { timeout: 5000 });
  47  |       const input = page.getByTestId('session-message-input');
  48  |       await input.fill('Hello test message');
  49  |       await expect(input).toHaveValue('Hello test message');
  50  | 
  51  |       const sendButton = page.getByTestId('session-send-button');
  52  |       await expect(sendButton).toBeEnabled();
  53  |       await sendButton.click();
  54  | 
  55  |       await expect(input).toHaveValue('', { timeout: 3000 });
  56  |     } catch {
  57  |       const newButton = page.getByTestId('session-new-button');
  58  |       await expect(newButton).toBeDefined();
  59  |     }
  60  |   });
  61  | 
  62  |   test('should show grouped navigation sections', async ({ page }) => {
  63  |     await page.setViewportSize({ width: 1440, height: 900 });
  64  |     await page.goto('/');
  65  | 
  66  |     await expect(page.getByTestId('nav-group-chat')).toBeVisible();
  67  |     await expect(page.getByTestId('nav-group-control')).toBeVisible();
  68  |     await expect(page.getByTestId('nav-group-agent')).toBeVisible();
  69  |     await expect(page.getByTestId('nav-group-settings')).toBeVisible();
  70  |   });
  71  | 
  72  |   test('should show topbar with breadcrumb', async ({ page }) => {
  73  |     await page.setViewportSize({ width: 1440, height: 900 });
  74  |     await page.goto('/');
  75  | 
  76  |     const topbar = page.getByTestId('topbar');
  77  |     await expect(topbar).toBeVisible();
  78  | 
  79  |     const breadcrumb = topbar.locator('.topbar__breadcrumb');
  80  |     await expect(breadcrumb).toContainText('Agent Platform');
  81  |   });
  82  | 
  83  |   test('should collapse and expand sidebar', async ({ page }) => {
  84  |     await page.setViewportSize({ width: 1440, height: 900 });
  85  |     await page.goto('/');
  86  | 
  87  |     const sidebar = page.getByTestId('sidebar');
  88  |     await expect(sidebar).toBeVisible();
  89  | 
  90  |     const collapseToggle = page.getByTestId('sidebar-collapse-toggle');
  91  |     await expect(collapseToggle).toBeVisible();
  92  |     await expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
  93  | 
  94  |     await collapseToggle.click();
  95  |     await expect(collapseToggle).toHaveAttribute('aria-expanded', 'false');
  96  |     await expect(sidebar).toBeVisible();
  97  | 
  98  |     await collapseToggle.click();
  99  |     await expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
  100 |     await expect(sidebar).toBeVisible();
  101 |   });
  102 | 
  103 |   test('should open mobile drawer at narrow viewport', async ({ page }) => {
  104 |     await page.setViewportSize({ width: 1000, height: 800 });
  105 |     await page.goto('/');
```