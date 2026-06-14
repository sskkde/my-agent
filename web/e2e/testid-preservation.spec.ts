/**
 * Test ID Preservation Tests
 *
 * These tests verify that critical test IDs remain present in the Chat desktop mode.
 * If a test ID is renamed, these tests will fail, alerting developers to update tests.
 */

import { test, expect } from '@playwright/test'

test.describe('Critical Test ID Preservation - Chat Desktop Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 })
    // Navigate to chat route
    await page.goto('/chat')
  })

  test.describe('Shell and Navigation Test IDs', () => {
    test('should have agent-shell test ID', async ({ page }) => {
      const agentShell = page.getByTestId('agent-shell')
      await expect(agentShell).toBeVisible({ timeout: 10000 })
    })

    test('should have product-nav test ID', async ({ page }) => {
      const productNav = page.getByTestId('product-nav')
      await expect(productNav).toBeVisible()
    })

    test('should have topbar test ID', async ({ page }) => {
      const topbar = page.getByTestId('topbar')
      await expect(topbar).toBeVisible()
    })

    test('should have context-desk-toggle test ID', async ({ page }) => {
      const contextDeskToggle = page.getByTestId('context-desk-toggle')
      await expect(contextDeskToggle).toBeVisible()
    })
  })

  test.describe('Session Input Test IDs', () => {
    test('should have session-message-input test ID', async ({ page }) => {
      // Wait for session workspace to load
      const sessionWorkspace = page.getByTestId('session-workspace')
      await expect(sessionWorkspace).toBeVisible({ timeout: 10000 })

      // Check for message input
      const messageInput = page.getByTestId('session-message-input')
      await expect(messageInput).toBeVisible()
    })

    test('should have session-send-button test ID', async ({ page }) => {
      // Wait for session workspace to load
      const sessionWorkspace = page.getByTestId('session-workspace')
      await expect(sessionWorkspace).toBeVisible({ timeout: 10000 })

      // Check for send button
      const sendButton = page.getByTestId('session-send-button')
      await expect(sendButton).toBeVisible()
    })

    test('should have session-new-button test ID', async ({ page }) => {
      // Wait for app to load
      await page.waitForSelector('[data-testid="agent-shell"]', { timeout: 10000 })

      // Check for new session button
      const newButton = page.getByTestId('session-new-button')
      await expect(newButton).toBeVisible()
    })
  })

  test.describe('All Critical Test IDs at Once', () => {
    test('should have all critical test IDs present in Chat desktop mode', async ({ page }) => {
      // Wait for app to load
      await page.waitForSelector('[data-testid="agent-shell"]', { timeout: 10000 })

      const criticalTestIds = [
        'agent-shell',
        'product-nav',
        'topbar',
        'context-desk-toggle',
        'session-message-input',
        'session-send-button',
        'session-new-button',
      ]

      for (const testId of criticalTestIds) {
        const element = page.getByTestId(testId)
        await expect(element).toBeVisible({ timeout: 5000 })
        console.log(`✓ ${testId} is visible`)
      }
    })
  })
})

test.describe('Product Section Reachability', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test.describe('Chat Section', () => {
    test('should reach Chat section via /chat route', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('session-workspace')).toBeVisible({ timeout: 10000 })
    })

    test('should reach Chat section via product-nav button', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('product-nav-chat').click()
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('session-workspace')).toBeVisible({ timeout: 10000 })
    })

    test('should reach Chat section via root route', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('session-workspace')).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Workspace Section', () => {
    test('should reach Workspace section via /workspace/dashboard route', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('container-page-workspace')).toBeVisible({ timeout: 10000 })
    })

    test('should reach Workspace section via product-nav button', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('product-nav-workspace').click()
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('container-page-workspace')).toBeVisible({ timeout: 10000 })
    })

    test('should have dashboard tab visible in Workspace section', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('tab-dashboard')).toBeVisible()
    })
  })

  test.describe('Operations Section', () => {
    test('should reach Operations section via /operations/agent-monitor route', async ({ page }) => {
      await page.goto('/operations/agent-monitor')
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('container-page-operations')).toBeVisible({ timeout: 10000 })
    })

    test('should reach Operations section via product-nav button', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('product-nav-operations').click()
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('container-page-operations')).toBeVisible({ timeout: 10000 })
    })

    test('should have agent-monitor tab visible in Operations section', async ({ page }) => {
      await page.goto('/operations/agent-monitor')
      await expect(page.getByTestId('tab-agent-monitor')).toBeVisible()
    })
  })

  test.describe('Admin Section', () => {
    test('should reach Admin section via /admin/settings route', async ({ page }) => {
      await page.goto('/admin/settings')
      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('container-page-admin')).toBeVisible({ timeout: 10000 })
    })

    test('should reach Admin section via product-nav button', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('product-nav-admin').click()
      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('container-page-admin')).toBeVisible({ timeout: 10000 })
    })

    test('should have settings tab visible in Admin section', async ({ page }) => {
      await page.goto('/admin/settings')
      await expect(page.getByTestId('tab-settings')).toBeVisible()
    })
  })

  test.describe('Navigation State Preservation', () => {
    test('should preserve active state when navigating between sections', async ({ page }) => {
      // Start at Chat
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)

      // Navigate to Workspace
      await page.getByTestId('product-nav-workspace').click()
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('product-nav-chat')).not.toHaveClass(/product-nav__item--active/)

      // Navigate to Operations
      await page.getByTestId('product-nav-operations').click()
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('product-nav-workspace')).not.toHaveClass(/product-nav__item--active/)

      // Navigate to Admin
      await page.getByTestId('product-nav-admin').click()
      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('product-nav-operations')).not.toHaveClass(/product-nav__item--active/)

      // Navigate back to Chat
      await page.getByTestId('product-nav-chat').click()
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('product-nav-admin')).not.toHaveClass(/product-nav__item--active/)
    })
  })
})

test.describe('Test ID Rename Detection', () => {
  test('should fail if agent-shell test ID is renamed or removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    
    // This test explicitly checks for agent-shell presence
    // If the test ID is renamed, this will fail
    const agentShell = page.getByTestId('agent-shell')
    await expect(agentShell).toBeVisible({ timeout: 10000 })
    
    // Verify it's the correct container element
    await expect(agentShell).toHaveClass(/agent-shell-container/)
  })

  test('should fail if product-nav test ID is renamed or removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    
    // This test explicitly checks for product-nav presence
    const productNav = page.getByTestId('product-nav')
    await expect(productNav).toBeVisible({ timeout: 10000 })
    
    // Verify it has navigation role
    await expect(productNav).toHaveAttribute('role', 'navigation')
  })

  test('should fail if topbar test ID is renamed or removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    
    // This test explicitly checks for topbar presence
    const topbar = page.getByTestId('topbar')
    await expect(topbar).toBeVisible({ timeout: 10000 })
    
    // Verify it's a header element
    await expect(topbar).toHaveClass(/shell__topbar/)
  })

  test('should fail if context-desk-toggle test ID is renamed or removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    
    // This test explicitly checks for context-desk-toggle presence
    const toggle = page.getByTestId('context-desk-toggle')
    await expect(toggle).toBeVisible({ timeout: 10000 })
    
    // Verify it's a button
    await expect(toggle).toHaveAttribute('type', 'button')
  })

  test('should fail if session-message-input test ID is renamed or removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    
    // Wait for session workspace
    await expect(page.getByTestId('session-workspace')).toBeVisible({ timeout: 10000 })
    
    // This test explicitly checks for session-message-input presence
    const input = page.getByTestId('session-message-input')
    await expect(input).toBeVisible({ timeout: 5000 })
    
    // Verify it's a textarea
    await expect(input).toHaveAttribute('placeholder', /.+/)
  })

  test('should fail if session-send-button test ID is renamed or removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    
    // Wait for session workspace
    await expect(page.getByTestId('session-workspace')).toBeVisible({ timeout: 10000 })
    
    // This test explicitly checks for session-send-button presence
    const button = page.getByTestId('session-send-button')
    await expect(button).toBeVisible({ timeout: 5000 })
    
    // Verify it's a button
    await expect(button).toHaveText(/发送/)
  })

  test('should fail if session-new-button test ID is renamed or removed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    
    // Wait for app shell
    await expect(page.getByTestId('agent-shell')).toBeVisible({ timeout: 10000 })
    
    // This test explicitly checks for session-new-button presence
    const button = page.getByTestId('session-new-button')
    await expect(button).toBeVisible({ timeout: 5000 })
    
    // Verify it's enabled
    await expect(button).toBeEnabled()
  })
})
