import { test, expect } from '@playwright/test'

test.describe('Smoke Tests - Setup and Session Routing', () => {
  test.describe('Application Load', () => {
    test('should load the main application shell', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })

    test('should render without JavaScript console errors', async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const text = msg.text()
          const isNetworkError =
            text.includes('Failed to load resource') ||
            text.includes('Failed to fetch') ||
            text.includes('404') ||
            text.includes('net::ERR_')
          if (!isNetworkError) consoleErrors.push(text)
        }
      })
      await page.goto('/')
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 })
      await page.waitForTimeout(1000)
      expect(consoleErrors).toHaveLength(0)
    })
  })

  test.describe('Session Routing', () => {
    test('should render session workspace on /chat route', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })

    test('should handle root route redirect', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Workspace Routing', () => {
    test('should render workspace dashboard', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })

    test('should handle invalid workspace tab gracefully', async ({ page }) => {
      await page.goto('/workspace/invalid-tab')
      await expect(page.getByTestId('agent-shell')).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Operations Routing', () => {
    test('should render operations agent-monitor', async ({ page }) => {
      await page.goto('/operations/agent-monitor')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Admin Routing', () => {
    test('should render admin settings', async ({ page }) => {
      await page.goto('/admin/settings')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Error Handling', () => {
    test('should handle unknown routes gracefully', async ({ page }) => {
      await page.goto('/unknown-route')
      await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Theme Integration', () => {
    test('should apply theme from localStorage', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('agent-platform-theme', 'dark')
      })
      await page.goto('/')
      await page.waitForSelector('[data-testid="app-shell"]', { timeout: 10000 })
      const theme = await page.evaluate(() => document.documentElement.dataset.theme)
      expect(theme).toBe('dark')
    })
  })
})
