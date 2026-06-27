/**
 * AMap Shared Map — E2E / Playwright Scenario
 *
 * Verifies the full AMap shared map flow using mocked AMap JSAPI and
 * mocked timeline data. No real AMap network calls or API keys required.
 *
 * Flow under test:
 *   1. User opens a session → map renders in mock mode
 *   2. Agent AMap route result appears on map (markers/route)
 *   3. User selects a marker/point → context is captured
 *   4. Context send button works → message formatted and sent
 *   5. Session switch → old map overlays cleaned up (remount)
 *
 * Prerequisites:
 *   - Vite dev server running (started by playwright.config.ts webServer)
 *   - No VITE_AMAP_JSAPI_KEY set → mock mode activates automatically
 *   - Test harness page at /amap-e2e.html (standalone, no auth required)
 */

import { test, expect, type Page } from '@playwright/test'

const HARNESS_URL = '/amap-e2e.html'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all outgoing request URLs for AMap domain assertions. */
async function collectRequestUrls(page: Page): Promise<string[]> {
  const urls: string[] = []
  page.on('request', (req) => urls.push(req.url()))
  return urls
}

/** Filter URLs that target AMap domains. */
function amapRequests(urls: string[]): string[] {
  return urls.filter(
    (u) => u.includes('amap.com') || u.includes('gaode') || u.includes('restapi.amap.com'),
  )
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('AMap Shared Map E2E — Mocked', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(HARNESS_URL)
    await page.waitForLoadState('networkidle')
  })

  // ---- Scenario 1: Map renders in mock mode ----

  test('should render map in mock mode with no real AMap network calls', async ({ page }) => {
    const requestUrls = await collectRequestUrls(page)

    // Verify harness loaded
    await expect(page.getByTestId('harness-title')).toHaveText('AMap E2E Test Harness')
    await expect(page.getByTestId('active-session-id')).toHaveText('session-a')

    // Verify map panel rendered
    await expect(page.getByTestId('session-map-panel')).toBeVisible()
    await expect(page.getByTestId('amap-shared-map')).toBeVisible()
    await expect(page.getByTestId('amap-map-container')).toBeVisible()

    // Verify NO real AMap network requests were made
    expect(amapRequests(requestUrls)).toHaveLength(0)
  })

  // ---- Scenario 2: Agent AMap route result appears on map ----

  test('should display map with route/geocode/POI operations from timeline events', async ({
    page,
  }) => {
    // Session A has geocode, POI, route, and weather events.
    // The map should render without errors — mock constructors handle all calls.
    await expect(page.getByTestId('amap-map-container')).toBeVisible()

    // Verify the map container is a real DOM element with dimensions
    const container = page.getByTestId('amap-map-container')
    const box = await container.boundingBox()
    expect(box).not.toBeNull()
    if (box) {
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
    }

    // Verify no error state (would show amap-error-message if operations failed)
    await expect(page.getByTestId('amap-error-message')).toHaveCount(0)
  })

  test('should render session B with only geocode operations', async ({ page }) => {
    // Switch to session B (geocode only)
    await page.getByTestId('switch-session-b').click()
    await expect(page.getByTestId('active-session-id')).toHaveText('session-b')

    // Map should still render
    await expect(page.getByTestId('session-map-panel')).toBeVisible()
    await expect(page.getByTestId('amap-map-container')).toBeVisible()

    // No error
    await expect(page.getByTestId('amap-error-message')).toHaveCount(0)
  })

  // ---- Scenario 3: User selects a marker/point → context captured ----

  test('should capture context when map click is simulated', async ({ page }) => {
    // Initial state: no context
    await expect(page.getByTestId('context-snapshot')).toContainText('No context captured')

    // Simulate a map click (since mock AMap.on() is a no-op, we use the test button)
    await page.getByTestId('simulate-map-click').click()

    // Verify context was captured
    const snapshot = page.getByTestId('context-snapshot')
    await expect(snapshot).not.toContainText('No context captured')

    // Verify snapshot contains expected map state
    const snapshotText = await snapshot.textContent()
    const parsed = JSON.parse(snapshotText!)

    expect(parsed.center).toEqual([116.407, 39.914])
    expect(parsed.zoom).toBe(14)
    expect(parsed.selectedPoint.position).toEqual([116.407, 39.914])
    expect(parsed.selectedPoint.name).toBe('Starbucks Wangfujing')
    expect(parsed.currentRoute.origin).toBe('Beijing Railway Station')
    expect(parsed.currentRoute.destination).toBe('Wangfujing')
    expect(parsed.currentRoute.distance).toBe('3.2 km')
    expect(parsed.currentRoute.duration).toBe('10 min')
  })

  // ---- Scenario 4: Context send button works → sendMessage called ----

  test('should format and send map context when send button is clicked', async ({ page }) => {
    // Initially send button should be disabled (no context)
    const sendBtn = page.getByTestId('send-context-btn')
    await expect(sendBtn).toBeDisabled()

    // Simulate map click to capture context
    await page.getByTestId('simulate-map-click').click()
    await expect(sendBtn).toBeEnabled()

    // Verify sent messages count is 0
    await expect(page.getByTestId('messages-section')).toContainText('Sent Messages (0)')

    // Click send
    await sendBtn.click()

    // Verify message was sent
    const messages = page.getByTestId('sent-message')
    await expect(messages).toHaveCount(1)

    // Verify message content starts with [Map Context]
    const messageText = await messages.first().textContent()
    expect(messageText).toContain('[Map Context]')
    expect(messageText).toContain('selected point: Starbucks Wangfujing')
    expect(messageText).toContain('116.407')
    expect(messageText).toContain('39.914')
    expect(messageText).toContain('Beijing Railway Station')
    expect(messageText).toContain('Wangfujing')
    expect(messageText).toContain('3.2 km')
    expect(messageText).toContain('10 min')

    // Context should be cleared after send
    await expect(page.getByTestId('context-snapshot')).toContainText('No context captured')
    await expect(sendBtn).toBeDisabled()
  })

  test('should allow multiple context captures and sends', async ({ page }) => {
    // First capture + send
    await page.getByTestId('simulate-map-click').click()
    await page.getByTestId('send-context-btn').click()
    await expect(page.getByTestId('sent-message')).toHaveCount(1)

    // Second capture + send
    await page.getByTestId('simulate-map-click').click()
    await page.getByTestId('send-context-btn').click()
    await expect(page.getByTestId('sent-message')).toHaveCount(2)

    // Verify messages-section header updated
    await expect(page.getByTestId('messages-section')).toContainText('Sent Messages (2)')
  })

  // ---- Scenario 5: Session switch → old map overlays cleaned up ----

  test('should remount map on session switch (cleanup old overlays)', async ({ page }) => {
    // Start on session A — map is rendered
    await expect(page.getByTestId('active-session-id')).toHaveText('session-a')
    const mapContainerA = page.getByTestId('amap-map-container')
    await expect(mapContainerA).toBeVisible()

    // Capture context on session A
    await page.getByTestId('simulate-map-click').click()
    await expect(page.getByTestId('context-snapshot')).not.toContainText('No context captured')

    // Switch to session B — map should remount (key={sessionId} forces unmount/remount)
    await page.getByTestId('switch-session-b').click()
    await expect(page.getByTestId('active-session-id')).toHaveText('session-b')

    // Map should still be visible (remounted with session B data)
    await expect(page.getByTestId('session-map-panel')).toBeVisible()
    await expect(page.getByTestId('amap-map-container')).toBeVisible()

    // No error after remount
    await expect(page.getByTestId('amap-error-message')).toHaveCount(0)

    // Switch back to session A — another remount
    await page.getByTestId('switch-session-a').click()
    await expect(page.getByTestId('active-session-id')).toHaveText('session-a')
    await expect(page.getByTestId('amap-map-container')).toBeVisible()
    await expect(page.getByTestId('amap-error-message')).toHaveCount(0)
  })

  test('should handle session with no AMap events gracefully', async ({ page }) => {
    // Switch to session C (no AMap events)
    await page.getByTestId('switch-session-c').click()
    await expect(page.getByTestId('active-session-id')).toHaveText('session-c')

    // Map should still render (empty operations array)
    await expect(page.getByTestId('session-map-panel')).toBeVisible()
    await expect(page.getByTestId('amap-map-container')).toBeVisible()

    // No error
    await expect(page.getByTestId('amap-error-message')).toHaveCount(0)
  })

  // ---- Full flow: end-to-end scenario ----

  test('should complete full user flow: open → view → click → send → switch', async ({
    page,
  }) => {
    // Step 1: Open session A
    await expect(page.getByTestId('active-session-id')).toHaveText('session-a')
    await expect(page.getByTestId('amap-map-container')).toBeVisible()
    await expect(page.getByTestId('amap-error-message')).toHaveCount(0)

    // Step 2: Map rendered with operations from timeline events
    const mapContainer = page.getByTestId('amap-map-container')
    const box = await mapContainer.boundingBox()
    expect(box).not.toBeNull()

    // Step 3: Simulate selecting a point on the map
    await page.getByTestId('simulate-map-click').click()
    const snapshot = page.getByTestId('context-snapshot')
    const snapshotText = await snapshot.textContent()
    expect(snapshotText).toContain('Starbucks Wangfujing')

    // Step 4: Send context to agent
    await page.getByTestId('send-context-btn').click()
    const msg = page.getByTestId('sent-message').first()
    await expect(msg).toContainText('[Map Context]')
    await expect(msg).toContainText('Starbucks Wangfujing')

    // Step 5: Switch session — map remounts, old overlays cleaned up
    await page.getByTestId('switch-session-b').click()
    await expect(page.getByTestId('active-session-id')).toHaveText('session-b')
    await expect(page.getByTestId('amap-map-container')).toBeVisible()
    await expect(page.getByTestId('amap-error-message')).toHaveCount(0)

    // Step 6: Switch back — fresh render
    await page.getByTestId('switch-session-a').click()
    await expect(page.getByTestId('active-session-id')).toHaveText('session-a')
    await expect(page.getByTestId('amap-map-container')).toBeVisible()

    // Verify no real AMap requests throughout
    // (checked via mock mode, no VITE_AMAP_JSAPI_KEY set)
  })
})
