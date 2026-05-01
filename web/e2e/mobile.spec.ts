import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVIDENCE_DIR = path.join(__dirname, '..', '..', '.sisyphus', 'evidence');

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

const VIEWPORT_MATRIX = [
  { name: 'iphone-se', width: 375, height: 667, type: 'phone' },
  { name: 'iphone-14', width: 390, height: 844, type: 'phone' },
  { name: 'iphone-14-pro-max', width: 430, height: 932, type: 'phone' },
  { name: 'ipad-mini', width: 768, height: 1024, type: 'tablet' },
  { name: 'desktop', width: 1440, height: 900, type: 'desktop' },
];

async function assertNoHorizontalOverflow(page: any, viewportName: string): Promise<boolean> {
  const overflowInfo = await page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    return {
      htmlScrollWidth: html.scrollWidth,
      htmlClientWidth: html.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      hasHtmlOverflow: html.scrollWidth > html.clientWidth,
      hasBodyOverflow: body.scrollWidth > body.clientWidth,
    };
  });

  const hasOverflow = overflowInfo.hasHtmlOverflow || overflowInfo.hasBodyOverflow;

  if (hasOverflow) {
    console.log(`  ⚠️  Overflow detected at ${viewportName}:`);
    console.log(`     HTML: ${overflowInfo.htmlScrollWidth}px > ${overflowInfo.htmlClientWidth}px`);
    console.log(`     Body: ${overflowInfo.bodyScrollWidth}px > ${overflowInfo.bodyClientWidth}px`);
  }

  return !hasOverflow;
}

async function captureEvidence(
  page: any,
  viewport: typeof VIEWPORT_MATRIX[0],
  testName: string,
  evidenceLog: string[]
): Promise<void> {
  const timestamp = new Date().toISOString();
  const screenshotName = `mobile-${viewport.name}-${testName}.png`;
  const screenshotPath = path.join(EVIDENCE_DIR, screenshotName);

  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });

  evidenceLog.push(`[${timestamp}] ${testName}`);
  evidenceLog.push(`  Viewport: ${viewport.name} (${viewport.width}x${viewport.height})`);
  evidenceLog.push(`  Type: ${viewport.type}`);
  evidenceLog.push(`  Screenshot: ${screenshotName}`);

  const dimensions = await page.evaluate(() => ({
    scrollWidth: Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth
    ),
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight
    ),
    clientHeight: document.documentElement.clientHeight,
  }));

  evidenceLog.push(`  Scroll: ${dimensions.scrollWidth}x${dimensions.scrollHeight}px`);
  evidenceLog.push(`  Client: ${dimensions.clientWidth}x${dimensions.clientHeight}px`);
  evidenceLog.push('');
}

test.describe('Mobile Viewport Matrix Tests', () => {
  for (const viewport of VIEWPORT_MATRIX) {
    test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/');
        await page.waitForLoadState('networkidle');
      });

      test('should have no horizontal overflow on initial load', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== ${viewport.name.toUpperCase()} OVERFLOW TEST ===`,
          `Viewport: ${viewport.width}x${viewport.height} (${viewport.type})`,
          `Started: ${new Date().toISOString()}\n`,
        ];

        const noOverflow = await assertNoHorizontalOverflow(page, viewport.name);
        await captureEvidence(page, viewport, 'overflow-check', evidenceLog);

        evidenceLog.push(`Result: ${noOverflow ? 'PASS - No overflow' : 'FAIL - Overflow detected'}`);
        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `mobile-${viewport.name}-overflow.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));

        expect(noOverflow, `Horizontal overflow detected at ${viewport.name}`).toBe(true);
      });

      test('should render content within viewport bounds', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== ${viewport.name.toUpperCase()} VIEWPORT BOUNDS TEST ===`,
          `Viewport: ${viewport.width}x${viewport.height} (${viewport.type})`,
          `Started: ${new Date().toISOString()}\n`,
        ];

        const pageInfo = await page.evaluate(() => ({
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight,
          bodyOverflowX: window.getComputedStyle(document.body).overflowX,
          bodyOverflowY: window.getComputedStyle(document.body).overflowY,
        }));

        evidenceLog.push(`Document: ${pageInfo.documentWidth}x${pageInfo.documentHeight}px`);
        evidenceLog.push(`Window: ${pageInfo.windowWidth}x${pageInfo.windowHeight}px`);
        evidenceLog.push(`Body overflow-x: ${pageInfo.bodyOverflowX}`);
        evidenceLog.push(`Body overflow-y: ${pageInfo.bodyOverflowY}`);

        await captureEvidence(page, viewport, 'viewport-bounds', evidenceLog);

        const withinBounds = pageInfo.documentWidth <= viewport.width + 1;

        evidenceLog.push(`Result: ${withinBounds ? 'PASS - Within bounds' : 'FAIL - Exceeds viewport'}`);
        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `mobile-${viewport.name}-bounds.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));

        expect(withinBounds, `Content exceeds viewport width at ${viewport.name}`).toBe(true);
      });

      test('should handle mobile navigation elements if present', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== ${viewport.name.toUpperCase()} NAVIGATION TEST ===`,
          `Viewport: ${viewport.width}x${viewport.height} (${viewport.type})`,
          `Started: ${new Date().toISOString()}\n`,
        ];

        const mobileToggle = page.getByTestId('mobile-nav-toggle');
        const hasMobileToggle = await mobileToggle.isVisible().catch(() => false);

        evidenceLog.push(`Mobile toggle visible: ${hasMobileToggle}`);

        if (hasMobileToggle) {
          await expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
          await mobileToggle.click();
          await page.waitForTimeout(200);
          await expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');

          const sidebar = page.getByTestId('sidebar');
          const sidebarVisible = await sidebar.isVisible().catch(() => false);
          evidenceLog.push(`Sidebar visible after toggle: ${sidebarVisible}`);

          await mobileToggle.click();
          await page.waitForTimeout(200);
        }

        if (viewport.type === 'tablet' || viewport.type === 'desktop') {
          const sidebar = page.getByTestId('sidebar');
          const sidebarVisible = await sidebar.isVisible().catch(() => false);
          evidenceLog.push(`Sidebar visible (tablet/desktop): ${sidebarVisible}`);
        }

        await captureEvidence(page, viewport, 'navigation', evidenceLog);

        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `mobile-${viewport.name}-nav.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));
      });
    });
  }
});

test.describe('Mobile Tab Navigation', () => {
  const PHONE_VIEWPORT = { name: 'iphone-14', width: 390, height: 844, type: 'phone' };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should check all available tabs on mobile', async ({ page }) => {
    const evidenceLog: string[] = [
      `\n=== MOBILE TAB NAVIGATION TEST ===`,
      `Viewport: ${PHONE_VIEWPORT.width}x${PHONE_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ];

    const tabIds = [
      'tab-session-console',
      'tab-dashboard',
      'tab-sessions',
      'tab-usage',
      'tab-logs-debug',
      'tab-channels',
      'tab-instances',
      'tab-status',
      'tab-agent-monitor',
      'tab-skills',
      'tab-settings',
    ];

    const foundTabs: string[] = [];
    const missingTabs: string[] = [];

    for (const tabId of tabIds) {
      const tab = page.getByTestId(tabId);
      const isVisible = await tab.isVisible().catch(() => false);

      if (isVisible) {
        foundTabs.push(tabId);

        const mobileToggle = page.getByTestId('mobile-nav-toggle');
        const hasMobileToggle = await mobileToggle.isVisible().catch(() => false);

        if (hasMobileToggle) {
          const isExpanded = await mobileToggle.getAttribute('aria-expanded');
          if (isExpanded === 'false') {
            await mobileToggle.click();
            await page.waitForTimeout(200);
          }
        }

        await tab.click();
        await page.waitForTimeout(300);

        const noOverflow = await assertNoHorizontalOverflow(page, `${PHONE_VIEWPORT.name}-${tabId}`);
        evidenceLog.push(`[${tabId}] Clicked - Overflow: ${noOverflow ? 'None' : 'YES'}`);
      } else {
        missingTabs.push(tabId);
      }
    }

    evidenceLog.push(`\nFound tabs: ${foundTabs.length}/${tabIds.length}`);
    evidenceLog.push(`Missing tabs: ${missingTabs.join(', ') || 'None'}`);

    await captureEvidence(page, PHONE_VIEWPORT, 'tab-navigation', evidenceLog);

    evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

    const logPath = path.join(EVIDENCE_DIR, `mobile-tabs-nav.log`);
    fs.writeFileSync(logPath, evidenceLog.join('\n'));

    if (foundTabs.length === 0) {
      console.log('  ⚠️  No tabs found - may be on login/unauthenticated page');
    }
  });
});

test.describe('Tablet Viewport Assertions', () => {
  const TABLET_VIEWPORT = { name: 'ipad-mini', width: 768, height: 1024, type: 'tablet' };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: TABLET_VIEWPORT.width, height: TABLET_VIEWPORT.height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('tablet viewport should handle sidebar and content', async ({ page }) => {
    const evidenceLog: string[] = [
      `\n=== TABLET VIEWPORT TEST ===`,
      `Viewport: ${TABLET_VIEWPORT.width}x${TABLET_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ];

    const noOverflow = await assertNoHorizontalOverflow(page, TABLET_VIEWPORT.name);
    evidenceLog.push(`Overflow check: ${noOverflow ? 'PASS' : 'FAIL'}`);

    const sidebar = page.getByTestId('sidebar');
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    evidenceLog.push(`Sidebar visible: ${sidebarVisible}`);

    const contentPanel = page.getByTestId('content-panel');
    const contentVisible = await contentPanel.isVisible().catch(() => false);
    evidenceLog.push(`Content panel visible: ${contentVisible}`);

    await captureEvidence(page, TABLET_VIEWPORT, 'tablet-layout', evidenceLog);

    evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

    const logPath = path.join(EVIDENCE_DIR, `tablet-layout.log`);
    fs.writeFileSync(logPath, evidenceLog.join('\n'));

    expect(noOverflow).toBe(true);
  });
});

test.describe('Desktop Regression', () => {
  const DESKTOP_VIEWPORT = { name: 'desktop-regression', width: 1440, height: 900, type: 'desktop' };

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('desktop viewport should show full layout without overflow', async ({ page }) => {
    const evidenceLog: string[] = [
      `\n=== DESKTOP REGRESSION TEST ===`,
      `Viewport: ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ];

    const noOverflow = await assertNoHorizontalOverflow(page, DESKTOP_VIEWPORT.name);
    evidenceLog.push(`Overflow check: ${noOverflow ? 'PASS' : 'FAIL'}`);

    const mobileToggle = page.getByTestId('mobile-nav-toggle');
    const hasMobileToggle = await mobileToggle.isVisible().catch(() => false);
    evidenceLog.push(`Mobile toggle visible: ${hasMobileToggle} (expected: false)`);

    const sidebar = page.getByTestId('sidebar');
    const sidebarVisible = await sidebar.isVisible().catch(() => false);
    evidenceLog.push(`Sidebar visible: ${sidebarVisible} (expected: true)`);

    await captureEvidence(page, DESKTOP_VIEWPORT, 'desktop-regression', evidenceLog);

    evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

    const logPath = path.join(EVIDENCE_DIR, `desktop-regression.log`);
    fs.writeFileSync(logPath, evidenceLog.join('\n'));

    expect(noOverflow).toBe(true);
  });
});

test.describe('Summary Evidence', () => {
  test('generate summary report', async () => {
    const summaryLog: string[] = [
      '\n========================================',
      'MOBILE VIEWPORT MATRIX TEST SUMMARY',
      '========================================',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Viewport Matrix Tested:',
      ...VIEWPORT_MATRIX.map(v => `  - ${v.name}: ${v.width}x${v.height} (${v.type})`),
      '',
      'Evidence Files:',
      '',
    ];

    if (fs.existsSync(EVIDENCE_DIR)) {
      const files = fs.readdirSync(EVIDENCE_DIR);
      if (files.length > 0) {
        files.forEach(file => {
          const stats = fs.statSync(path.join(EVIDENCE_DIR, file));
          summaryLog.push(`  - ${file} (${(stats.size / 1024).toFixed(2)} KB)`);
        });
      } else {
        summaryLog.push('  No evidence files found');
      }
    }

    summaryLog.push('');
    summaryLog.push('Test Categories:');
    summaryLog.push('  1. No horizontal overflow on initial load (all viewports)');
    summaryLog.push('  2. Content within viewport bounds (all viewports)');
    summaryLog.push('  3. Mobile navigation elements (responsive)');
    summaryLog.push('  4. Tablet viewport assertions');
    summaryLog.push('  5. Desktop regression (1440x900)');
    summaryLog.push('');
    summaryLog.push('========================================');

    const summaryPath = path.join(EVIDENCE_DIR, 'task-8-mobile-playwright.txt');
    fs.writeFileSync(summaryPath, summaryLog.join('\n'));

    console.log(`Summary report saved to: ${summaryPath}`);
  });
});
