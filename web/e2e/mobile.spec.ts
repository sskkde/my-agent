import { test, expect } from '@playwright/test'

const VIEWPORT_MATRIX = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'ipad-mini', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]

test.describe('Mobile Viewport Matrix Tests', () => {
  for (const viewport of VIEWPORT_MATRIX) {
    test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto('/')
        await page.waitForLoadState('networkidle')
      })

      test('should have no horizontal overflow on initial load', async ({ page }) => {
        const overflowInfo = await page.evaluate(() => {
          const html = document.documentElement
          const body = document.body
          return {
            htmlScrollWidth: html.scrollWidth,
            htmlClientWidth: html.clientWidth,
            bodyScrollWidth: body.scrollWidth,
            bodyClientWidth: body.clientWidth,
            hasOverflow: html.scrollWidth > html.clientWidth || body.scrollWidth > body.clientWidth,
          }
        })
        expect(overflowInfo.hasOverflow, `Overflow at ${viewport.name}: ${overflowInfo.htmlScrollWidth}px > ${overflowInfo.htmlClientWidth}px`).toBe(false)
      })

      test('should render app shell within viewport bounds', async ({ page }) => {
        await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 })
        const pageInfo = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          windowWidth: window.innerWidth,
        }))
        expect(pageInfo.documentWidth).toBeLessThanOrEqual(viewport.width + 1)
      })
    })
  }
})

test.describe('Chat Shell Responsive', () => {
  test('desktop shows chat-shell with sidebar toggle', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('chat-sidebar-toggle')).toBeVisible()
    await expect(page.getByTestId('chat-right-toggle')).toBeVisible()
  })

  test('mobile viewport renders without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/chat')
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(hasOverflow).toBe(false)
  })

  test('non-chat section renders chat-shell on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/workspace/dashboard')
    await expect(page.getByTestId('chat-shell')).toBeVisible({ timeout: 10000 })

    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth
    })
    expect(hasOverflow).toBe(false)
  })
})
