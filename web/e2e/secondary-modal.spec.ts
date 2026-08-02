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
})
