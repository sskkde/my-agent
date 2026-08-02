import { test, expect } from '@playwright/test'

test.describe('Comprehensive Chat Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    await page.waitForLoadState('networkidle')
  })

  test('should render chat shell with all panels', async ({ page }) => {
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('chat-sidebar-toggle')).toBeVisible()
    await expect(page.getByTestId('chat-right-toggle')).toBeVisible()
    await expect(page.getByTestId('floating-settings-trigger')).toBeVisible()
  })

  test('should toggle left sidebar', async ({ page }) => {
    await expect(page.getByTestId('chat-sidebar-toggle')).toBeVisible()
    await page.getByTestId('chat-sidebar-toggle').click()
  })

  test('should toggle right panel', async ({ page }) => {
    await expect(page.getByTestId('chat-right-toggle')).toBeVisible()
    await page.getByTestId('chat-right-toggle').click()
  })

  test('should open and close floating settings', async ({ page }) => {
    await page.getByTestId('floating-settings-trigger').click()
    await expect(page.getByTestId('floating-settings-panel')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()
  })

  test('should navigate between sections via floating panel', async ({ page }) => {
    const initialUrl = page.url()
    await page.getByTestId('floating-settings-trigger').click()
    await page.getByTestId('settings-tab-nav-monitor').click()
    const dashboardTab = page.getByTestId('tab-dashboard')
    await dashboardTab.click()
    await expect(dashboardTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('floating-settings-panel')).toBeVisible()
    await expect(page).toHaveURL(initialUrl)
    await expect(page.getByTestId('chat-shell')).toBeVisible()
  })

  test('should switch to operations and close back to chat', async ({ page }) => {
    const initialUrl = page.url()
    await page.getByTestId('floating-settings-trigger').click()
    await page.getByTestId('settings-tab-nav-monitor').click()
    const monitorTab = page.getByTestId('tab-agent-monitor')
    await monitorTab.click()
    await expect(monitorTab).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('floating-settings-panel')).toBeVisible()
    await expect(page).toHaveURL(initialUrl)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('floating-settings-panel')).toBeHidden()
    await expect(page).toHaveURL(initialUrl)
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
  })

  test('should preserve chat shell across section switches', async ({ page }) => {
    for (const route of ['/workspace/dashboard', '/operations/agent-monitor', '/admin/settings', '/chat']) {
      await page.goto(route)
      await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
      await expect(page.getByTestId('floating-settings-trigger')).toBeVisible()
      if (route !== '/chat') {
        await expect(page).toHaveURL(/\/chat\/?$/)
        await expect(page.getByTestId('floating-settings-panel')).toBeVisible()
      }
    }
  })

  test('should have no console errors during navigation', async ({ page }) => {
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

    for (const route of ['/chat', '/workspace/dashboard', '/operations/agent-monitor', '/admin/settings']) {
      await page.goto(route)
      await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
      if (route !== '/chat') {
        await expect(page).toHaveURL(/\/chat\/?$/)
        await expect(page.getByTestId('floating-settings-panel')).toBeVisible()
      }
    }

    expect(consoleErrors).toHaveLength(0)
  })
})
