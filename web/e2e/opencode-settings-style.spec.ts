import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const evidenceDirectory = resolve(process.cwd(), '..', '.omo/evidence/opencode-settings-style')
mkdirSync(evidenceDirectory, { recursive: true })

type ScreenshotTheme = 'default' | 'warm-paper' | 'dark'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function readPngDimensions(filePath: string): { width: number; height: number } {
  const image = readFileSync(filePath)
  if (!image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`Expected a PNG screenshot: ${filePath}`)
  }

  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
}

async function openSettings(page: Page) {
  const trigger = page.getByTestId('floating-settings-trigger')
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByTestId('floating-settings-panel')
  await expect(dialog).toBeVisible()
  return dialog
}

test('captures the Warm-Paper modal across themes and viewport sizes', async ({ page }) => {
  test.setTimeout(180_000)

  const themes: readonly ScreenshotTheme[] = ['default', 'warm-paper', 'dark']
  const viewports = [
    { name: 'mobile', width: 375, height: 800 },
    { name: 'tablet', width: 768, height: 900 },
    { name: 'desktop', width: 1280, height: 900 },
  ] as const
  const states = [
    { name: 'modal-open', testId: null },
    { name: 'business-agent-monitor', testId: 'tab-agent-monitor' },
    { name: 'settings-appearance', testId: 'settings-tab-settings-appearance' },
  ] as const

  for (const theme of themes) {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.addInitScript((selectedTheme: ScreenshotTheme) => {
        localStorage.setItem('agent-platform-theme', selectedTheme)
      }, theme)
      await page.goto('/chat')
      await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme)

      const dialog = await openSettings(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      for (const state of states) {
        if (state.testId) {
          const destination = dialog.getByTestId(state.testId)
          await destination.click()
          await expect(destination).toHaveAttribute('aria-selected', 'true')
        }

        const screenshotPath = resolve(evidenceDirectory, `${theme}-${viewport.name}-${state.name}.png`)
        await page.screenshot({ path: screenshotPath, fullPage: false })
        expect(existsSync(screenshotPath)).toBe(true)
        expect(readPngDimensions(screenshotPath)).toEqual({ width: viewport.width, height: viewport.height })
      }

      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }
  }
})
