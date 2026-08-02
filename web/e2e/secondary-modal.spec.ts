import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const evidenceDirectory = resolve(process.cwd(), '..', '.omo/evidence/opencode-settings-style')
mkdirSync(evidenceDirectory, { recursive: true })

async function openSettings(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  const trigger = page.getByTestId('floating-settings-trigger')
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByTestId('floating-settings-panel')
  await expect(dialog).toBeVisible()
  return { dialog, trigger }
}

test.describe('Centered secondary settings modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/chat')
  })

  test('dialog lifecycle keeps focus and body state contained', async ({ page }) => {
    const { dialog, trigger } = await openSettings(page)

    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAttribute('aria-label', '设置')

    const viewport = page.viewportSize()
    const box = await dialog.boundingBox()
    expect(viewport).not.toBeNull()
    expect(box).not.toBeNull()
    if (!viewport || !box) {
      throw new Error('Expected the modal to have a viewport-relative bounding box')
    }
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    await expect(page.getByTestId('secondary-modal-scrim')).toBeVisible()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

    const focusable = dialog.locator('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    const first = focusable.first()
    const last = focusable.last()
    await expect(first).toBeVisible()
    await first.focus()
    await page.keyboard.press('Shift+Tab')
    await expect(last).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(first).toBeFocused()

    await page.screenshot({ path: resolve(evidenceDirectory, 'secondary-modal-open.png') })
    await page.setViewportSize({ width: 768, height: 900 })
    await page.screenshot({ path: resolve(evidenceDirectory, 'secondary-modal-tablet.png') })

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
  })

  test('scrim closes once and repeated open/close cycles leave no residue', async ({ page }) => {
    const { dialog, trigger } = await openSettings(page)
    const scrim = page.getByTestId('secondary-modal-scrim')
    await scrim.click({ position: { x: 4, y: 4 } })
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await trigger.click()
      await expect(page.getByTestId('floating-settings-panel')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('floating-settings-panel')).toBeHidden()
      await expect(trigger).toBeFocused()
    }
  })

  test('renders the context desk with a mobile panel entry point', async ({ page }) => {
    const { dialog } = await openSettings(page)

    await expect(dialog.getByTestId('secondary-modal-context-desk')).toBeVisible()
    await expect(dialog.getByTestId('context-desk-panel')).toBeVisible()

    await page.setViewportSize({ width: 375, height: 800 })
    await expect(dialog.getByTestId('secondary-modal-context-desk-toggle')).toBeVisible()
    await dialog.getByTestId('secondary-modal-context-desk-toggle').click()
    await expect(dialog.getByTestId('context-desk-panel')).toBeVisible()
    await page.screenshot({ path: resolve(evidenceDirectory, 'secondary-modal-mobile.png') })
  })

  test('keeps the card inside 16px mobile margins without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    const { dialog } = await openSettings(page)
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    if (!box) {
      throw new Error('Expected the mobile modal to have a bounding box')
    }
    expect(box.x).toBeGreaterThanOrEqual(16)
    expect(375 - (box.x + box.width)).toBeGreaterThanOrEqual(16)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    const monitorGroup = dialog.getByTestId('settings-tab-nav-monitor')
    await expect(monitorGroup).toBeVisible()
    await monitorGroup.click()
    await expect(dialog.getByTestId('nav-content-monitor')).toBeVisible()
  })

  test('all modal destinations render in place without changing the URL', async ({ page }) => {
    const { dialog } = await openSettings(page)
    const initialUrl = page.url()

    const groupButtons = dialog.locator('button[data-testid^="settings-tab-nav-"]')
    const groupTestIds = await groupButtons.evaluateAll((buttons) =>
      buttons
        .map((button) => button.getAttribute('data-testid'))
        .filter((testId): testId is string => Boolean(testId)),
    )
    expect(groupTestIds.length).toBeGreaterThan(0)

    for (const testId of groupTestIds) {
      const groupButton = dialog.getByTestId(testId)
      await groupButton.click()
      await expect(dialog).toBeVisible()
      await expect(groupButton).toHaveAttribute('aria-selected', 'true')
      await expect(dialog.locator('[data-testid^="nav-content-"]')).toBeVisible()
      expect(page.url()).toBe(initialUrl)
    }

    const destinationButtons = dialog.locator('button.floating-settings__tab')
    const destinationTestIds = await destinationButtons.evaluateAll((buttons) =>
      buttons
        .map((button) => button.getAttribute('data-testid'))
        .filter((testId): testId is string => Boolean(testId)),
    )
    expect(destinationTestIds.length).toBe(24)

    for (const testId of destinationTestIds) {
      const destinationButton = dialog.getByTestId(testId)
      await destinationButton.click()
      await expect(dialog).toBeVisible()
      await expect(destinationButton).toHaveAttribute('aria-selected', 'true')
      await expect(dialog.locator('[data-testid^="nav-content-"]')).toBeVisible()
      await expect(dialog.locator('button.floating-settings__tab[aria-selected="true"]')).toHaveAttribute(
        'data-testid',
        testId,
      )
      expect(page.url()).toBe(initialUrl)
    }

    await page.screenshot({ path: resolve(evidenceDirectory, 'secondary-modal-destinations.png') })
  })

  test('back to chat closes the modal and keeps the current chat URL', async ({ page }) => {
    const { dialog } = await openSettings(page)
    const chatUrl = page.url()

    await dialog.getByTestId('tab-status').click()
    await expect(dialog.getByTestId('status-panel')).toBeVisible()
    await dialog.getByTestId('status-open-session').click()

    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(chatUrl)
    expect(new URL(page.url()).pathname).toMatch(/^\/chat(?:\/[^/]+)?$/)
  })
})

test.describe('Legacy route deep links', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
  })

  test('legacy route /workspace/dashboard lands on chat with dashboard modal open', async ({ page }) => {
    await page.goto('/workspace/dashboard')

    await expect(page).toHaveURL(/\/chat\/?$/)
    const dialog = page.getByTestId('floating-settings-panel')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('tab-dashboard')).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByTestId('nav-content-monitor')).toBeVisible()
  })

  test('legacy route /operations/agent-monitor lands on chat with agent-monitor modal open', async ({ page }) => {
    await page.goto('/operations/agent-monitor')

    await expect(page).toHaveURL(/\/chat\/?$/)
    const dialog = page.getByTestId('floating-settings-panel')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('tab-agent-monitor')).toHaveAttribute('aria-selected', 'true')
  })

  test('legacy route /admin/admin and /admin/settings land on chat with modal open', async ({ page }) => {
    await page.goto('/admin/admin')
    await expect(page).toHaveURL(/\/chat\/?$/)
    let dialog = page.getByTestId('floating-settings-panel')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('tab-admin')).toHaveAttribute('aria-selected', 'true')

    await page.goto('/admin/settings')
    await expect(page).toHaveURL(/\/chat\/?$/)
    dialog = page.getByTestId('floating-settings-panel')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByTestId('tab-settings')).toHaveAttribute('aria-selected', 'true')
    await expect(dialog.getByTestId('nav-content-settings')).toBeVisible()
  })

  test('invalid legacy tab /workspace/not-real redirects to chat without opening the modal', async ({ page }) => {
    await page.goto('/workspace/not-real')

    await expect(page).toHaveURL(/\/chat\/?$/)
    await expect(page.getByTestId('agent-shell')).toBeVisible()
    await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()
  })

  test('legacy route modal does not re-open after refresh', async ({ page }) => {
    await page.goto('/workspace/dashboard')
    await expect(page).toHaveURL(/\/chat\/?$/)
    await expect(page.getByTestId('floating-settings-panel')).toBeVisible()

    await page.reload()

    await expect(page.getByTestId('agent-shell')).toBeVisible()
    await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()
  })

  test('legacy route modal does not re-open after closing and going back', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.getByTestId('agent-shell')).toBeVisible()

    await page.goto('/workspace/dashboard')
    await expect(page).toHaveURL(/\/chat\/?$/)
    await expect(page.getByTestId('floating-settings-panel')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()

    await page.goBack()

    await expect(page).toHaveURL(/\/chat\/?$/)
    await expect(page.getByTestId('agent-shell')).toBeVisible()
    await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()
  })

  test('standalone map route /map/:sessionId renders the map without opening the modal', async ({ page }) => {
    await page.goto('/map/test-session')

    await expect(page.locator('.session-map-page')).toBeVisible()
    await expect(page.getByTestId('floating-settings-panel')).not.toBeVisible()
  })
})
