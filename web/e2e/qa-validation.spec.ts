import { test, expect } from '@playwright/test';

test.describe('QA Console Error Detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('should have no JavaScript errors across all tabs', async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];

    page.on('console', (msg) => {
      const text = msg.text();
      const type = msg.type();
      
      if (type === 'error') {
        const isNetworkError = text.includes('Failed to load resource') ||
                               text.includes('Failed to fetch') ||
                               text.includes('404') ||
                               text.includes('net::ERR_CONNECTION_REFUSED');
        if (!isNetworkError) {
          consoleErrors.push(text);
        }
      } else if (type === 'warning') {
        consoleWarnings.push(text);
      }
    });

    page.on('pageerror', (error) => {
      consoleErrors.push(`Page Error: ${error.message}`);
    });

    await page.goto('/');

    const allTabs = [
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

    for (const tabId of allTabs) {
      const tab = page.getByTestId(tabId);
      await expect(tab).toBeVisible();
      await tab.click();
      await page.waitForTimeout(500);
      
      const panelId = tabId.replace('tab-', '') + '-panel';
      const hasPanel = await page.locator(`[data-testid="${panelId}"]`).isVisible().catch(() => false);
      if (hasPanel) {
        console.log(`  ✓ ${tabId} panel visible`);
      }
    }

    console.log(`\nConsole Warnings: ${consoleWarnings.length}`);
    consoleWarnings.forEach(w => console.log(`  ⚠ ${w.substring(0, 100)}`));
    
    console.log(`\nConsole Errors: ${consoleErrors.length}`);
    consoleErrors.forEach(e => console.log(`  ✗ ${e.substring(0, 100)}`));

    expect(consoleErrors).toHaveLength(0);
  });

  test('verify all navigation groups are visible', async ({ page }) => {
    await page.goto('/');
    
    const groups = [
      { id: 'nav-group-chat', label: 'Chat' },
      { id: 'nav-group-control', label: 'Control' },
      { id: 'nav-group-agent', label: 'Agent' },
      { id: 'nav-group-settings', label: 'Settings' },
    ];

    for (const group of groups) {
      const element = page.getByTestId(group.id);
      await expect(element).toBeVisible();
      console.log(`  ✓ ${group.label} group visible`);
    }
  });

  test('verify session console functionality', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-session-console').click();
    
    const newButton = page.getByTestId('session-new-button');
    await expect(newButton).toBeVisible();
    await expect(newButton).toBeEnabled();
    
    console.log('  ✓ Session Console: New button visible and enabled');
    
    const emptyState = page.getByTestId('session-empty-state');
    await expect(emptyState).toBeVisible();
    
    console.log('  ✓ Session Console: Empty state visible');
  });

  test('verify dashboard health status', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-dashboard').click();
    
    const healthStatus = page.getByTestId('dashboard-health-status');
    await expect(healthStatus).toBeVisible();
    
    console.log('  ✓ Dashboard: Health status visible');
  });

  test('verify agent monitor components', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-agent-monitor').click();
    
    const stream = page.getByTestId('agent-monitor-stream');
    await expect(stream).toBeVisible();
    
    const runsList = page.getByTestId('runs-list');
    await expect(runsList).toBeVisible();
    
    console.log('  ✓ Agent Monitor: Stream and runs list visible');
  });

  test('verify status panel components', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('tab-status').click();
    
    const statusPanel = page.getByTestId('status-panel');
    await expect(statusPanel).toBeVisible();
    
    const healthSummary = page.getByTestId('status-health-summary');
    await expect(healthSummary).toBeVisible();
    
    console.log('  ✓ Status: Panel and health summary visible');
  });
});
