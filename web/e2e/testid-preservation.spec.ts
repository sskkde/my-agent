import { test, expect } from '@playwright/test'

test.describe('Critical Test ID Preservation - Chat Desktop Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
  })

  test('should have agent-shell test ID', async ({ page }) => {
    await expect(page.getByTestId('agent-shell')).toBeVisible({ timeout: 10000 })
  })

  test('should have app-shell test ID', async ({ page }) => {
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
  })

  test('should have chat-shell test ID', async ({ page }) => {
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
  })

  test('should have floating-settings-trigger test ID', async ({ page }) => {
    await expect(page.getByTestId('floating-settings-trigger')).toBeVisible({ timeout: 10000 })
  })

  test('should have chat-sidebar-toggle test ID', async ({ page }) => {
    await expect(page.getByTestId('chat-sidebar-toggle')).toBeVisible({ timeout: 10000 })
  })

  test('should have chat-right-toggle test ID', async ({ page }) => {
    await expect(page.getByTestId('chat-right-toggle')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('Non-Chat Section Test IDs', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('workspace section has agent-shell and chat-shell', async ({ page }) => {
    await page.goto('/workspace/dashboard')
    await expect(page.getByTestId('agent-shell')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
  })

  test('operations section has agent-shell and chat-shell', async ({ page }) => {
    await page.goto('/operations/agent-monitor')
    await expect(page.getByTestId('agent-shell')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
  })

  test('admin section has agent-shell and chat-shell', async ({ page }) => {
    await page.goto('/admin/settings')
    await expect(page.getByTestId('agent-shell')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
  })
})
