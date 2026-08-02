import { test, expect } from '@playwright/test'

test.describe('Floating Settings Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
  })

  test('should open floating settings and show all nav tabs', async ({ page }) => {
    await page.getByTestId('floating-settings-trigger').click()
    await expect(page.getByTestId('floating-settings-panel')).toBeVisible()

    await expect(page.getByTestId('settings-tab-nav-monitor')).toBeVisible()
    await expect(page.getByTestId('settings-tab-nav-resource')).toBeVisible()
    await expect(page.getByTestId('settings-tab-nav-automation')).toBeVisible()
    await expect(page.getByTestId('settings-tab-nav-extension')).toBeVisible()
  })

  test('should switch between nav groups in floating panel', async ({ page }) => {
    await page.getByTestId('floating-settings-trigger').click()

    await page.getByTestId('settings-tab-nav-monitor').click()
    await expect(page.getByTestId('nav-content-monitor')).toBeVisible()

    await page.getByTestId('settings-tab-nav-resource').click()
    await expect(page.getByTestId('nav-content-resource')).toBeVisible()

    await page.getByTestId('settings-tab-nav-automation').click()
    await expect(page.getByTestId('nav-content-automation')).toBeVisible()

    await page.getByTestId('settings-tab-nav-extension').click()
    await expect(page.getByTestId('nav-content-extension')).toBeVisible()
  })

  test('should switch to settings tabs', async ({ page }) => {
    await page.getByTestId('floating-settings-trigger').click()

    await page.getByTestId('settings-tab-settings-general').click()
    await expect(page.getByTestId('settings-general-tab')).toBeVisible()

    await page.getByTestId('settings-tab-settings-appearance').click()
    await expect(page.getByTestId('settings-appearance-tab')).toBeVisible()

    await page.getByTestId('settings-tab-settings-provider').click()
    await expect(page.getByTestId('settings-provider-tab')).toBeVisible()

    await page.getByTestId('settings-tab-settings-agent').click()
    await expect(page.getByTestId('settings-agent-tab')).toBeVisible()
  })

  test('should navigate to workspace dashboard via floating panel', async ({ page }) => {
    await page.getByTestId('floating-settings-trigger').click()
    await page.getByTestId('settings-tab-nav-monitor').click()
    await page.getByTestId('tab-dashboard').click()
    await expect(page).toHaveURL(/\/workspace\/dashboard/)
  })

  test('should navigate to operations via floating panel', async ({ page }) => {
    await page.getByTestId('floating-settings-trigger').click()
    await page.getByTestId('settings-tab-nav-monitor').click()
    await page.getByTestId('tab-agent-monitor').click()
    await expect(page).toHaveURL(/\/operations\/agent-monitor/)
  })

  test('floating panel closes after navigation', async ({ page }) => {
    await page.getByTestId('floating-settings-trigger').click()
    await expect(page.getByTestId('floating-settings-panel')).toBeVisible()

    await page.getByTestId('settings-tab-nav-monitor').click()
    await page.getByTestId('tab-dashboard').click()

    await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()
  })

  test('should have no console errors during tab navigation', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        const isNetworkError =
          text.includes('Failed to load resource') ||
          text.includes('Failed to fetch') ||
          text.includes('404')
        if (!isNetworkError) consoleErrors.push(text)
      }
    })

    await page.getByTestId('floating-settings-trigger').click()
    const navTabs = ['settings-tab-nav-monitor', 'settings-tab-nav-resource', 'settings-tab-nav-automation', 'settings-tab-nav-extension']
    for (const tabId of navTabs) {
      await page.getByTestId(tabId).click()
      await page.waitForTimeout(200)
    }

    const settingsTabs = ['settings-tab-settings-general', 'settings-tab-settings-appearance', 'settings-tab-settings-provider', 'settings-tab-settings-agent']
    for (const tabId of settingsTabs) {
      await page.getByTestId(tabId).click()
      await page.waitForTimeout(200)
    }

    expect(consoleErrors).toHaveLength(0)
  })
})
