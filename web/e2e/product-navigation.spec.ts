import { test, expect } from '@playwright/test'

test.describe('Product Navigation E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
  })

  test.describe('Product Navigation Bar', () => {
    test('displays four product sections in product-nav', async ({ page }) => {
      const productNav = page.getByTestId('product-nav')
      await expect(productNav).toBeVisible()

      await expect(page.getByTestId('product-nav-chat')).toBeVisible()
      await expect(page.getByTestId('product-nav-workspace')).toBeVisible()
      await expect(page.getByTestId('product-nav-operations')).toBeVisible()
      await expect(page.getByTestId('product-nav-admin')).toBeVisible()
    })

    test('product sections appear in correct order', async ({ page }) => {
      const productNav = page.getByTestId('product-nav')
      const buttons = productNav.locator('button')

      await expect(buttons.nth(0)).toHaveAttribute('data-testid', 'product-nav-chat')
      await expect(buttons.nth(1)).toHaveAttribute('data-testid', 'product-nav-workspace')
      await expect(buttons.nth(2)).toHaveAttribute('data-testid', 'product-nav-operations')
      await expect(buttons.nth(3)).toHaveAttribute('data-testid', 'product-nav-admin')
    })

    test('active section is marked with aria-current', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveAttribute('aria-current', 'page')
      await expect(page.getByTestId('product-nav-workspace')).not.toHaveAttribute('aria-current')
    })
  })

  test.describe('Section-Scoped Sidebar Navigation', () => {
    test('chat section shows only session-console in sidebar', async ({ page }) => {
      await page.goto('/chat')

      await expect(page.getByTestId('tab-session-console')).toBeVisible()

      await expect(page.getByTestId('tab-dashboard')).not.toBeVisible()
      await expect(page.getByTestId('tab-agent-monitor')).not.toBeVisible()
      await expect(page.getByTestId('tab-settings')).not.toBeVisible()
    })

    test('workspace section shows all workspace tabs in sidebar', async ({ page }) => {
      await page.goto('/workspace/dashboard')

      await expect(page.getByTestId('tab-dashboard')).toBeVisible()
      await expect(page.getByTestId('tab-sessions')).toBeVisible()
      await expect(page.getByTestId('tab-workflows')).toBeVisible()
      await expect(page.getByTestId('tab-observability')).toBeVisible()

      await expect(page.getByTestId('tab-session-console')).not.toBeVisible()
      await expect(page.getByTestId('tab-agent-monitor')).not.toBeVisible()
      await expect(page.getByTestId('tab-settings')).not.toBeVisible()
    })

    test('operations section shows all operations tabs in sidebar', async ({ page }) => {
      await page.goto('/operations/agent-monitor')

      await expect(page.getByTestId('tab-agent-monitor')).toBeVisible()
      await expect(page.getByTestId('tab-skills')).toBeVisible()
      await expect(page.getByTestId('tab-agents')).toBeVisible()
      await expect(page.getByTestId('tab-connectors')).toBeVisible()
      await expect(page.getByTestId('tab-dlq')).toBeVisible()

      await expect(page.getByTestId('tab-dashboard')).not.toBeVisible()
      await expect(page.getByTestId('tab-session-console')).not.toBeVisible()
      await expect(page.getByTestId('tab-settings')).not.toBeVisible()
    })

    test('admin section shows all admin tabs in sidebar', async ({ page }) => {
      await page.goto('/admin/settings')

      await expect(page.getByTestId('tab-settings')).toBeVisible()
      await expect(page.getByTestId('tab-admin')).toBeVisible()

      await expect(page.getByTestId('tab-dashboard')).not.toBeVisible()
      await expect(page.getByTestId('tab-agent-monitor')).not.toBeVisible()
      await expect(page.getByTestId('tab-session-console')).not.toBeVisible()
    })
  })

  test.describe('Route Mapping', () => {
    test('/chat route loads chat section', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-session-console')).toBeVisible()
    })

    test('/chat/:sessionId route loads chat section with session', async ({ page }) => {
      await page.goto('/chat/ses_test123')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('session-workspace')).toBeVisible()
    })

    test('/workspace/dashboard route loads workspace section', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-dashboard')).toBeVisible()
    })

    test('/workspace/sessions route loads workspace section with sessions tab', async ({ page }) => {
      await page.goto('/workspace/sessions')
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-sessions')).toBeVisible()
    })

    test('/workspace/workflows route loads workspace section with workflows tab', async ({ page }) => {
      await page.goto('/workspace/workflows')
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-workflows')).toBeVisible()
    })

    test('/operations/agent-monitor route loads operations section', async ({ page }) => {
      await page.goto('/operations/agent-monitor')
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-agent-monitor')).toBeVisible()
    })

    test('/operations/skills route loads operations section with skills tab', async ({ page }) => {
      await page.goto('/operations/skills')
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-skills')).toBeVisible()
    })

    test('/admin/settings route loads admin section', async ({ page }) => {
      await page.goto('/admin/settings')
      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-settings')).toBeVisible()
    })

    test('/admin/admin route loads admin section with admin tab', async ({ page }) => {
      await page.goto('/admin/admin')
      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-admin')).toBeVisible()
    })
  })

  test.describe('Product Section Navigation', () => {
    test('clicking chat section navigates to session-console', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('product-nav-chat').click()

      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-session-console')).toBeVisible()
      await expect(page).toHaveURL(/\/chat/)
    })

    test('clicking workspace section navigates to dashboard', async ({ page }) => {
      await page.goto('/chat')
      await expect(page.getByTestId('product-nav-chat')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('product-nav-workspace').click()

      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-dashboard')).toBeVisible()
      await expect(page).toHaveURL(/\/workspace\/dashboard/)
    })

    test('clicking operations section navigates to agent-monitor', async ({ page }) => {
      await page.goto('/workspace/dashboard')

      await page.getByTestId('product-nav-operations').click()

      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-agent-monitor')).toBeVisible()
      await expect(page).toHaveURL(/\/operations\/agent-monitor/)
    })

    test('clicking admin section navigates to settings', async ({ page }) => {
      await page.goto('/workspace/dashboard')

      await page.getByTestId('product-nav-admin').click()

      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)
      await expect(page.getByTestId('tab-settings')).toBeVisible()
      await expect(page).toHaveURL(/\/admin\/settings/)
    })
  })

  test.describe('Sidebar Tab Navigation Within Section', () => {
    test('sidebar tab clicks stay within workspace section', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('tab-sessions').click()
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page).toHaveURL(/\/workspace\/sessions/)

      await page.getByTestId('tab-workflows').click()
      await expect(page.getByTestId('product-nav-workspace')).toHaveClass(/product-nav__item--active/)
      await expect(page).toHaveURL(/\/workspace\/workflows/)
    })

    test('sidebar tab clicks stay within operations section', async ({ page }) => {
      await page.goto('/operations/agent-monitor')
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('tab-skills').click()
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page).toHaveURL(/\/operations\/skills/)

      await page.getByTestId('tab-connectors').click()
      await expect(page.getByTestId('product-nav-operations')).toHaveClass(/product-nav__item--active/)
      await expect(page).toHaveURL(/\/operations\/connectors/)
    })

    test('sidebar tab clicks stay within admin section', async ({ page }) => {
      await page.goto('/admin/settings')
      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)

      await page.getByTestId('tab-admin').click()
      await expect(page.getByTestId('product-nav-admin')).toHaveClass(/product-nav__item--active/)
      await expect(page).toHaveURL(/\/admin\/admin/)
    })
  })

  test.describe('URL Preservation', () => {
    test('workspace deep link preserves tab in URL', async ({ page }) => {
      await page.goto('/workspace/usage')
      await expect(page).toHaveURL('/workspace/usage')
      await expect(page.getByTestId('tab-usage')).toHaveAttribute('aria-selected', 'true')
    })

    test('operations deep link preserves tab in URL', async ({ page }) => {
      await page.goto('/operations/agents')
      await expect(page).toHaveURL('/operations/agents')
      await expect(page.getByTestId('tab-agents')).toHaveAttribute('aria-selected', 'true')
    })

    test('admin deep link preserves tab in URL', async ({ page }) => {
      await page.goto('/admin/admin')
      await expect(page).toHaveURL('/admin/admin')
      await expect(page.getByTestId('tab-admin')).toHaveAttribute('aria-selected', 'true')
    })

    test('chat deep link preserves session ID in URL', async ({ page }) => {
      await page.goto('/chat/ses_e2e_test_123')
      await expect(page).toHaveURL('/chat/ses_e2e_test_123')
    })
  })

  test.describe('Invalid Tab Fallback', () => {
    test('invalid workspace tab falls back to dashboard', async ({ page }) => {
      await page.goto('/workspace/invalid-tab-name')
      await expect(page).toHaveURL('/workspace/dashboard')
      await expect(page.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'true')
    })

    test('invalid operations tab falls back to agent-monitor', async ({ page }) => {
      await page.goto('/operations/invalid-tab-name')
      await expect(page).toHaveURL('/operations/agent-monitor')
      await expect(page.getByTestId('tab-agent-monitor')).toHaveAttribute('aria-selected', 'true')
    })

    test('invalid admin tab falls back to settings', async ({ page }) => {
      await page.goto('/admin/invalid-tab-name')
      await expect(page).toHaveURL('/admin/settings')
      await expect(page.getByTestId('tab-settings')).toHaveAttribute('aria-selected', 'true')
    })
  })

  test.describe('Navigation Hierarchy Verification', () => {
    test('product-nav is top-level, sidebar is secondary', async ({ page }) => {
      await page.goto('/workspace/dashboard')

      const productNavButtons = await page.getByTestId('product-nav').locator('button').count()
      expect(productNavButtons).toBe(4)

      const sidebarTabs = await page.getByTestId('sidebar').locator('button[role="tab"]').count()
      expect(sidebarTabs).toBe(12)
    })

    test('changing product section updates sidebar content', async ({ page }) => {
      await page.goto('/workspace/dashboard')
      await expect(page.getByTestId('tab-dashboard')).toBeVisible()
      await expect(page.getByTestId('tab-agent-monitor')).not.toBeVisible()

      await page.getByTestId('product-nav-operations').click()

      await expect(page.getByTestId('tab-agent-monitor')).toBeVisible()
      await expect(page.getByTestId('tab-dashboard')).not.toBeVisible()
    })
  })
})