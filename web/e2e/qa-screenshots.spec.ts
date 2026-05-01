import { test } from '@playwright/test';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'test-results', 'qa-screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

test.describe('QA Screenshots - All Tabs', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
  });

  test('capture screenshot of Dashboard tab', async ({ page }) => {
    await page.getByTestId('tab-dashboard').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '01-dashboard.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Session Console tab', async ({ page }) => {
    await page.getByTestId('tab-session-console').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '02-session-console.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Sessions tab', async ({ page }) => {
    await page.getByTestId('tab-sessions').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '03-sessions.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Usage tab', async ({ page }) => {
    await page.getByTestId('tab-usage').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '04-usage.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Logs/Debug tab', async ({ page }) => {
    await page.getByTestId('tab-logs-debug').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '05-logs-debug.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Channels tab', async ({ page }) => {
    await page.getByTestId('tab-channels').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '06-channels.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Instances tab', async ({ page }) => {
    await page.getByTestId('tab-instances').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '07-instances.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Status tab', async ({ page }) => {
    await page.getByTestId('tab-status').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '08-status.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Agent Monitor tab', async ({ page }) => {
    await page.getByTestId('tab-agent-monitor').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '09-agent-monitor.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Skills tab', async ({ page }) => {
    await page.getByTestId('tab-skills').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '10-skills.png'),
      fullPage: false 
    });
  });

  test('capture screenshot of Settings tab', async ({ page }) => {
    await page.getByTestId('tab-settings').click();
    await page.waitForTimeout(500);
    await page.screenshot({ 
      path: path.join(SCREENSHOTS_DIR, '11-settings.png'),
      fullPage: false 
    });
  });
});
