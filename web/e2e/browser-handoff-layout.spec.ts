/**
 * Browser Handoff Panel Layout E2E Tests
 *
 * Verifies desktop/mobile layout, button states, text input overlay,
 * CJK state labels, error display, and handoff banner.
 *
 * All backend API calls for the browser handoff feature are mocked
 * via page.route() so these tests do not depend on a real browser
 * session or external sites.
 */

import { test, expect } from '@playwright/test'

const SESSION_ID = 'ses_browser_handoff_layout'
const API_BASE = '**/api/v1'

const makeStatus = (state: 'idle' | 'agent_controlled' | 'user_controlled' | 'handoff_requested') => ({
  ok: true,
  data: {
    sessionId: SESSION_ID,
    state,
    url: 'https://example.com',
    lastActivityAt: new Date().toISOString(),
    viewport: { width: 1280, height: 720 },
  },
})

const mockStatusRoute = async (
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  state: 'idle' | 'agent_controlled' | 'user_controlled' | 'handoff_requested',
) => {
  await page.route(`${API_BASE}/sessions/*/browser/status`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(makeStatus(state)),
    })
  })
}

const fulfillJson = async (
  route: Parameters<Parameters<typeof page.route>[1]>[0],
  body: Record<string, unknown>,
) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

const gotoChatSession = async (
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
) => {
  await page.goto(`/chat/${SESSION_ID}`)
  await page.waitForSelector('[data-testid="session-workspace"]', { timeout: 10000 })
}

test.describe('Browser Handoff Panel Layout', () => {
  test.beforeEach(async ({ page }) => {
    // Provide a minimal session object so the console tab hydrates.
    await page.route(`${API_BASE}/sessions/${SESSION_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: {
            session: {
              sessionId: SESSION_ID,
              userId: 'user-test',
              messageCount: 0,
              lastActivityAt: new Date().toISOString(),
              activePlannerRunIds: [],
              activeBackgroundRunIds: [],
            },
          },
        }),
      })
    })

    // Empty timeline prevents console errors and avoids extra network chatter.
    await page.route(`${API_BASE}/sessions/${SESSION_ID}/timeline`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          data: { events: [] },
        }),
      })
    })

    // Abort the SSE connection gracefully — the panel does not require it.
    await page.route(`${API_BASE}/sessions/*/events`, async (route) => {
      await route.abort('blockedbyclient')
    })

    // Abort frame stream gracefully — mocked status drives all assertions.
    await page.route(`${API_BASE}/sessions/*/browser/frame/stream`, async (route) => {
      await route.abort('blockedbyclient')
    })

    // Default action endpoints return success (overridden per test when needed).
    await page.route(`${API_BASE}/sessions/*/browser/takeover`, async (route) => {
      await fulfillJson(route, {
        ok: true,
        data: {
          sessionId: SESSION_ID,
          state: 'user_controlled',
          previousState: 'agent_controlled',
        },
      })
    })

    await page.route(`${API_BASE}/sessions/*/browser/release`, async (route) => {
      await fulfillJson(route, {
        ok: true,
        data: {
          sessionId: SESSION_ID,
          state: 'idle',
          previousState: 'user_controlled',
        },
      })
    })

    await page.route(`${API_BASE}/sessions/*/browser/input`, async (route) => {
      await fulfillJson(route, { ok: true, data: { success: true } })
    })
  })

  test('desktop layout shows browser handoff panel', async ({ page }) => {
    await mockStatusRoute(page, 'agent_controlled')
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoChatSession(page)

    const panel = page.getByTestId('browser-handoff')
    await expect(panel).toBeVisible({ timeout: 10000 })

    await page.screenshot({
      path: `.omo/evidence/browser-handoff-desktop-${Date.now()}.png`,
      fullPage: false,
    })
  })

  test('mobile layout does not clip CJK labels or input overlay', async ({ page }) => {
    await mockStatusRoute(page, 'user_controlled')
    await page.setViewportSize({ width: 375, height: 667 })
    await gotoChatSession(page)

    const panel = page.getByTestId('browser-handoff')
    await expect(panel).toBeVisible({ timeout: 10000 })

    const badge = page.locator('.browser-handoff__badge')
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('你已接管')

    // Assert the badge and overlay fit inside the panel bounding box.
    const panelBox = await panel.boundingBox()
    const badgeBox = await badge.boundingBox()
    const overlay = page.getByTestId('input-overlay')
    const overlayBox = await overlay.boundingBox()

    expect(panelBox).not.toBeNull()
    expect(badgeBox).not.toBeNull()
    expect(overlayBox).not.toBeNull()

    const pBox = panelBox!
    expect(badgeBox!.x).toBeGreaterThanOrEqual(pBox.x - 1)
    expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(pBox.x + pBox.width + 1)
    expect(overlayBox!.x).toBeGreaterThanOrEqual(pBox.x - 1)
    expect(overlayBox!.x + overlayBox!.width).toBeLessThanOrEqual(pBox.x + pBox.width + 1)

    await page.screenshot({
      path: `.omo/evidence/browser-handoff-mobile-${Date.now()}.png`,
      fullPage: false,
    })
  })

  test.describe('Button states', () => {
    test('takeover button is visible when agent_controlled', async ({ page }) => {
      await mockStatusRoute(page, 'agent_controlled')
      await page.setViewportSize({ width: 1280, height: 720 })
      await gotoChatSession(page)

      const panel = page.getByTestId('browser-handoff')
      await expect(panel).toHaveAttribute('data-state', 'agent_controlled')

      const takeoverBtn = page.getByTestId('takeover-btn')
      await expect(takeoverBtn).toBeVisible()
      await expect(takeoverBtn).toHaveText('接管')

      await expect(page.getByTestId('release-btn')).not.toBeVisible()
    })

    test('release button is visible when user_controlled', async ({ page }) => {
      await mockStatusRoute(page, 'user_controlled')
      await page.setViewportSize({ width: 1280, height: 720 })
      await gotoChatSession(page)

      const panel = page.getByTestId('browser-handoff')
      await expect(panel).toHaveAttribute('data-state', 'user_controlled')

      const releaseBtn = page.getByTestId('release-btn')
      await expect(releaseBtn).toBeVisible()
      await expect(releaseBtn).toHaveText('释放')

      await expect(page.getByTestId('takeover-btn')).not.toBeVisible()
    })
  })

  test('text input overlay is visible when user has lease', async ({ page }) => {
    await mockStatusRoute(page, 'user_controlled')
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoChatSession(page)

    const inputOverlay = page.getByTestId('input-overlay')
    await expect(inputOverlay).toBeVisible()

    const textInput = page.getByTestId('text-input')
    await expect(textInput).toBeVisible()
    await expect(textInput).toHaveAttribute('placeholder', '输入文字后回车发送...')
  })

  test.describe('CJK state labels', () => {
    const cases: Array<{ state: 'idle' | 'agent_controlled' | 'user_controlled' | 'handoff_requested'; label: string }> =
      [
        { state: 'idle', label: '空闲' },
        { state: 'agent_controlled', label: 'Agent 控制中' },
        { state: 'user_controlled', label: '你已接管' },
        { state: 'handoff_requested', label: 'Agent 请求接管' },
      ]

    for (const { state, label } of cases) {
      test(`renders "${label}" for ${state} state`, async ({ page }) => {
        await mockStatusRoute(page, state)
        await page.setViewportSize({ width: 1280, height: 720 })
        await gotoChatSession(page)

        const badge = page.locator('.browser-handoff__badge')
        await expect(badge).toBeVisible()
        await expect(badge).toHaveText(label)
      })
    }
  })

  test('browser error is rendered when status API fails', async ({ page }) => {
    await page.route(`${API_BASE}/sessions/*/browser/status`, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          error: { code: 'BROWSER_STATUS_ERROR', message: 'Browser service unavailable' },
        }),
      })
    })

    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoChatSession(page)

    const errorDisplay = page.getByTestId('browser-error')
    await expect(errorDisplay).toBeVisible({ timeout: 10000 })
  })

  test('handoff banner is rendered when state is handoff_requested', async ({ page }) => {
    await mockStatusRoute(page, 'handoff_requested')
    await page.setViewportSize({ width: 1280, height: 720 })
    await gotoChatSession(page)

    const banner = page.getByTestId('agent-request-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveText('Agent 请求接管浏览器，请释放控制权')
  })
})
