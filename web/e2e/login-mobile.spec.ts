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
  const screenshotName = `login-mobile-${viewport.name}-${testName}.png`;
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

test.describe('Login Page Mobile Viewport Matrix Tests', () => {
  for (const viewport of VIEWPORT_MATRIX) {
    test.describe(`${viewport.name} (${viewport.width}x${viewport.height})`, () => {
      test.beforeEach(async ({ context, page }) => {
        // Clear any existing storage state to ensure unauthenticated state
        await context.clearCookies();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto('/login');
        await page.waitForLoadState('networkidle');
      });

      test('login page should have no horizontal overflow', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== LOGIN ${viewport.name.toUpperCase()} OVERFLOW TEST ===`,
          `Viewport: ${viewport.width}x${viewport.height} (${viewport.type})`,
          `Started: ${new Date().toISOString()}\n`,
        ];

        const noOverflow = await assertNoHorizontalOverflow(page, viewport.name);
        await captureEvidence(page, viewport, 'login-overflow-check', evidenceLog);

        evidenceLog.push(`Result: ${noOverflow ? 'PASS - No overflow' : 'FAIL - Overflow detected'}`);
        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `login-mobile-${viewport.name}-overflow.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));

        expect(noOverflow, `Horizontal overflow detected at ${viewport.name}`).toBe(true);
      });

      test('login page should render content within viewport bounds', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== LOGIN ${viewport.name.toUpperCase()} VIEWPORT BOUNDS TEST ===`,
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

        await captureEvidence(page, viewport, 'login-viewport-bounds', evidenceLog);

        const withinBounds = pageInfo.documentWidth <= viewport.width + 1;

        evidenceLog.push(`Result: ${withinBounds ? 'PASS - Within bounds' : 'FAIL - Exceeds viewport'}`);
        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `login-mobile-${viewport.name}-bounds.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));

        expect(withinBounds, `Content exceeds viewport width at ${viewport.name}`).toBe(true);
      });

      test('login form elements should be visible and clickable', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== LOGIN ${viewport.name.toUpperCase()} FORM ELEMENTS TEST ===`,
          `Viewport: ${viewport.width}x${viewport.height} (${viewport.type})`,
          `Started: ${new Date().toISOString()}\n`,
        ];

        // Check which page we're on - could be login or setup (both use Auth.css)
        const loginPage = page.getByTestId('login-page');
        const isLoginPage = await loginPage.isVisible().catch(() => false);

        // Check admin-username-input which indicates ProductionSetupChecklist (setup wizard)
        const adminUsername = page.getByTestId('admin-username-input');
        const isSetupWizard = await adminUsername.isVisible().catch(() => false);

        if (isSetupWizard) {
          evidenceLog.push('Setup wizard (ProductionSetupChecklist) is shown instead of login page');
          evidenceLog.push('This is expected when the app needs initial setup');

          // Test the setup wizard form elements instead
          await expect(adminUsername).toBeVisible();
          await expect(adminUsername).toBeEnabled();
          evidenceLog.push('✓ admin-username-input visible and enabled');

          const adminPassword = page.getByTestId('admin-password-input');
          await expect(adminPassword).toBeVisible();
          await expect(adminPassword).toBeEnabled();
          evidenceLog.push('✓ admin-password-input visible and enabled');

          const adminSubmit = page.getByTestId('admin-create-submit');
          await expect(adminSubmit).toBeVisible();
          await expect(adminSubmit).toBeEnabled();
          evidenceLog.push('✓ admin-create-submit visible and enabled');

          await captureEvidence(page, viewport, 'setup-wizard-form-elements', evidenceLog);
        } else if (isLoginPage) {
          evidenceLog.push('✓ login-page visible');

          // Check title and subtitle
          const authTitle = page.getByTestId('auth-title');
          await expect(authTitle).toBeVisible();
          evidenceLog.push('✓ auth-title visible');

          const authSubtitle = page.getByTestId('auth-subtitle');
          await expect(authSubtitle).toBeVisible();
          evidenceLog.push('✓ auth-subtitle visible');

          // Check form inputs
          const usernameInput = page.getByTestId('login-username');
          await expect(usernameInput).toBeVisible();
          await expect(usernameInput).toBeEnabled();
          evidenceLog.push('✓ login-username visible and enabled');

          const passwordInput = page.getByTestId('login-password');
          await expect(passwordInput).toBeVisible();
          await expect(passwordInput).toBeEnabled();
          evidenceLog.push('✓ login-password visible and enabled');

          // Check submit button
          const submitButton = page.getByTestId('login-submit');
          await expect(submitButton).toBeVisible();
          await expect(submitButton).toBeEnabled();
          evidenceLog.push('✓ login-submit visible and enabled');

          // Test clickability of form elements
          await usernameInput.click();
          await usernameInput.fill('testuser');
          evidenceLog.push('✓ login-username clickable and fillable');

          await passwordInput.click();
          await passwordInput.fill('testpassword');
          evidenceLog.push('✓ login-password clickable and fillable');

          // Verify values are entered
          await expect(usernameInput).toHaveValue('testuser');
          await expect(passwordInput).toHaveValue('testpassword');
          evidenceLog.push('✓ Input values verified');

          await captureEvidence(page, viewport, 'login-form-elements', evidenceLog);
        } else {
          evidenceLog.push('Neither login page nor setup wizard found - unexpected state');
          await captureEvidence(page, viewport, 'unexpected-state', evidenceLog);
          throw new Error('Neither login page nor setup wizard is visible');
        }

        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `login-mobile-${viewport.name}-form.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));
      });
    });
  }
});

test.describe('Setup Page Mobile Viewport Tests', () => {
  for (const viewport of VIEWPORT_MATRIX) {
    test.describe(`Setup ${viewport.name} (${viewport.width}x${viewport.height})`, () => {
      test.beforeEach(async ({ context, page }) => {
        // Clear any existing storage state to ensure unauthenticated state
        await context.clearCookies();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // Navigate to root - will redirect to setup if needed
        await page.goto('/');
        await page.waitForLoadState('networkidle');
      });

      test('setup page should have no horizontal overflow when shown', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== SETUP ${viewport.name.toUpperCase()} OVERFLOW TEST ===`,
          `Viewport: ${viewport.width}x${viewport.height} (${viewport.type})`,
          `Started: ${new Date().toISOString()}\n`,
        ];

        // Check if we're on the setup page
        const setupUsername = page.getByTestId('setup-username');
        const isSetupPage = await setupUsername.isVisible().catch(() => false);

        if (!isSetupPage) {
          evidenceLog.push('Setup page not shown (may be already configured)');
          test.skip();
          return;
        }

        const noOverflow = await assertNoHorizontalOverflow(page, viewport.name);
        await captureEvidence(page, viewport, 'setup-overflow-check', evidenceLog);

        evidenceLog.push(`Result: ${noOverflow ? 'PASS - No overflow' : 'FAIL - Overflow detected'}`);
        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `setup-mobile-${viewport.name}-overflow.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));

        expect(noOverflow, `Horizontal overflow detected at ${viewport.name}`).toBe(true);
      });

      test('setup form elements should be visible and clickable when shown', async ({ page }) => {
        const evidenceLog: string[] = [
          `\n=== SETUP ${viewport.name.toUpperCase()} FORM ELEMENTS TEST ===`,
          `Viewport: ${viewport.width}x${viewport.height} (${viewport.type})`,
          `Started: ${new Date().toISOString()}\n`,
        ];

        // Check if we're on the setup page
        const setupUsername = page.getByTestId('setup-username');
        const isSetupPage = await setupUsername.isVisible().catch(() => false);

        if (!isSetupPage) {
          evidenceLog.push('Setup page not shown (may be already configured)');
          test.skip();
          return;
        }

        // Check setup form inputs
        await expect(setupUsername).toBeVisible();
        await expect(setupUsername).toBeEnabled();
        evidenceLog.push('✓ setup-username visible and enabled');

        const setupPassword = page.getByTestId('setup-password');
        await expect(setupPassword).toBeVisible();
        await expect(setupPassword).toBeEnabled();
        evidenceLog.push('✓ setup-password visible and enabled');

        const setupSubmit = page.getByTestId('setup-submit');
        await expect(setupSubmit).toBeVisible();
        await expect(setupSubmit).toBeEnabled();
        evidenceLog.push('✓ setup-submit visible and enabled');

        // Test clickability of form elements
        await setupUsername.click();
        await setupUsername.fill('admin');
        evidenceLog.push('✓ setup-username clickable and fillable');

        await setupPassword.click();
        await setupPassword.fill('password123');
        evidenceLog.push('✓ setup-password clickable and fillable');

        // Verify values are entered
        await expect(setupUsername).toHaveValue('admin');
        await expect(setupPassword).toHaveValue('password123');
        evidenceLog.push('✓ Input values verified');

        await captureEvidence(page, viewport, 'setup-form-elements', evidenceLog);

        evidenceLog.push(`Completed: ${new Date().toISOString()}\n`);

        const logPath = path.join(EVIDENCE_DIR, `setup-mobile-${viewport.name}-form.log`);
        fs.writeFileSync(logPath, evidenceLog.join('\n'));
      });
    });
  }
});

test.describe('Login Mobile Summary Evidence', () => {
  test('generate summary report', async () => {
    const summaryLog: string[] = [
      '\n========================================',
      'LOGIN MOBILE VIEWPORT MATRIX TEST SUMMARY',
      '========================================',
      `Generated: ${new Date().toISOString()}`,
      '',
      'Viewport Matrix Tested:',
      ...VIEWPORT_MATRIX.map(v => `  - ${v.name}: ${v.width}x${v.height} (${v.type})`),
      '',
      'Test Categories:',
      '  1. Login page no horizontal overflow (all viewports)',
      '  2. Login page content within viewport bounds (all viewports)',
      '  3. Login form elements visibility and clickability (all viewports)',
      '  4. Setup page overflow check (all viewports)',
      '  5. Setup form elements visibility and clickability (all viewports)',
      '',
      'Evidence Files:',
      '',
    ];

    if (fs.existsSync(EVIDENCE_DIR)) {
      const files = fs.readdirSync(EVIDENCE_DIR).filter(f => f.startsWith('login-mobile-') || f.startsWith('setup-mobile-'));
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
    summaryLog.push('========================================');

    const summaryPath = path.join(EVIDENCE_DIR, 'login-mobile-summary.txt');
    fs.writeFileSync(summaryPath, summaryLog.join('\n'));

    console.log(`Login mobile summary report saved to: ${summaryPath}`);
  });
});
