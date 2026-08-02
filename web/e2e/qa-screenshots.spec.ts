import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const screenshotsDirectory = path.resolve(currentDirectory, '..', 'test-results', 'qa-screenshots')
mkdirSync(screenshotsDirectory, { recursive: true })

async function openModalDestination(page: Page, testId: string): Promise<void> {
  await page.getByTestId('floating-settings-trigger').click()
  const panel = page.getByTestId('floating-settings-panel')
  await expect(panel).toBeVisible()

  const destination = panel.getByTestId(testId)
  await expect(destination).toBeVisible()
  await destination.click()
  await expect(destination).toHaveAttribute('aria-selected', 'true')
}

async function capture(page: Page, filename: string): Promise<void> {
  await page.screenshot({
    path: path.join(screenshotsDirectory, filename),
    fullPage: false,
  })
}

test.describe('QA Screenshots - All Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('floating-settings-trigger')).toBeVisible()
  })

  test('capture screenshot of Dashboard tab', async ({ page }) => {
    await openModalDestination(page, 'tab-dashboard')
    await capture(page, '01-dashboard.png')
  })

  test('capture screenshot of the Chat session surface', async ({ page }) => {
    await expect(page.getByTestId('chat-shell')).toBeVisible()
    await capture(page, '02-session-console.png')
  })

  test('capture screenshot of Sessions tab', async ({ page }) => {
    await openModalDestination(page, 'tab-sessions')
    await capture(page, '03-sessions.png')
  })

  test('capture screenshot of Usage tab', async ({ page }) => {
    await openModalDestination(page, 'tab-usage')
    await capture(page, '04-usage.png')
  })

  test('capture screenshot of Logs/Debug tab', async ({ page }) => {
    await openModalDestination(page, 'tab-logs-debug')
    await capture(page, '05-logs-debug.png')
  })

  test('capture screenshot of Channels tab', async ({ page }) => {
    await openModalDestination(page, 'tab-channels')
    await capture(page, '06-channels.png')
  })

  test('capture screenshot of Instances tab', async ({ page }) => {
    await openModalDestination(page, 'tab-instances')
    await capture(page, '07-instances.png')
  })

  test('capture screenshot of Status tab', async ({ page }) => {
    await openModalDestination(page, 'tab-status')
    await capture(page, '08-status.png')
  })

  test('capture screenshot of Agent Monitor tab', async ({ page }) => {
    await openModalDestination(page, 'tab-agent-monitor')
    await capture(page, '09-agent-monitor.png')
  })

  test('capture screenshot of Skills tab', async ({ page }) => {
    await openModalDestination(page, 'tab-skills')
    await capture(page, '10-skills.png')
  })

  test('capture screenshot of Settings tab in the modal', async ({ page }) => {
    await openModalDestination(page, 'tab-settings')
    await capture(page, '11-settings.png')
  })
})
