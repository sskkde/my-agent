import { test, expect } from '@playwright/test'

test.describe('Floating Settings Navigation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
  })

  test.describe('Floating Settings Panel', () => {
    test('opens settings panel via gear button', async ({ page }) => {
      await expect(page.getByTestId('floating-settings-trigger')).toBeVisible()
      await page.getByTestId('floating-settings-trigger').click()
      await expect(page.getByTestId('floating-settings-panel')).toBeVisible()
    })

    test('shows navigation and settings section titles', async ({ page }) => {
      await page.getByTestId('floating-settings-trigger').click()
      const panel = page.getByTestId('floating-settings-panel')
      await expect(panel).toContainText('导航')
      await expect(panel).toContainText('设置')
    })

    test('shows 4 navigation group tabs', async ({ page }) => {
      await page.getByTestId('floating-settings-trigger').click()
      await expect(page.getByTestId('settings-tab-nav-monitor')).toBeVisible()
      await expect(page.getByTestId('settings-tab-nav-resource')).toBeVisible()
      await expect(page.getByTestId('settings-tab-nav-automation')).toBeVisible()
      await expect(page.getByTestId('settings-tab-nav-extension')).toBeVisible()
    })

    test('shows 4 settings tabs', async ({ page }) => {
      await page.getByTestId('floating-settings-trigger').click()
      await expect(page.getByTestId('settings-tab-settings-general')).toBeVisible()
      await expect(page.getByTestId('settings-tab-settings-appearance')).toBeVisible()
      await expect(page.getByTestId('settings-tab-settings-provider')).toBeVisible()
      await expect(page.getByTestId('settings-tab-settings-agent')).toBeVisible()
    })

    test('closes on Escape', async ({ page }) => {
      await page.getByTestId('floating-settings-trigger').click()
      await expect(page.getByTestId('floating-settings-panel')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()
    })
  })

  test.describe('Navigation via Floating Panel', () => {
    test('clicking nav item navigates to correct URL', async ({ page }) => {
      await page.getByTestId('floating-settings-trigger').click()
      await page.getByTestId('settings-tab-nav-monitor').click()
      await page.getByTestId('tab-dashboard').click()
      await expect(page).toHaveURL(/\/workspace\/dashboard/)
    })

    test('clicking operations nav item navigates', async ({ page }) => {
      await page.getByTestId('floating-settings-trigger').click()
      await page.getByTestId('settings-tab-nav-monitor').click()
      await page.getByTestId('tab-agent-monitor').click()
      await expect(page).toHaveURL(/\/operations\/agent-monitor/)
    })
  })

  test.describe('Route Mapping', () => {
    test('/chat renders chat section', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('agent-shell')).toBeVisible()
      await expect(page.getByTestId('app-shell')).toBeVisible()
    })

    test('/workspace/dashboard renders workspace content', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('agent-shell')).toBeVisible()
      await expect(page.getByTestId('chat-shell')).toBeVisible()
    })

    test('/operations/agent-monitor renders operations content', async ({ page }) => {
      await page.goto('/operations/agent-monitor')
      await expect(page.getByTestId('agent-shell')).toBeVisible()
      await expect(page.getByTestId('chat-shell')).toBeVisible()
    })

    test('/admin/settings renders admin content', async ({ page }) => {
      await page.goto('/admin/settings')
      await expect(page.getByTestId('agent-shell')).toBeVisible()
      await expect(page.getByTestId('chat-shell')).toBeVisible()
    })

    test('invalid workspace tab falls back to dashboard', async ({ page }) => {
      await page.goto('/workspace/invalid-tab-name')
      await expect(page.getByTestId('agent-shell')).toBeVisible({ timeout: 10000 })
    })

    test('unknown route redirects to root', async ({ page }) => {
      await page.goto('/unknown-route')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })
  })
})
