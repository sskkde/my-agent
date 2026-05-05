# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web/e2e/tabs.spec.ts >> All Console Tabs Navigation >> should display all 4 navigation groups with correct labels
- Location: web/e2e/tabs.spec.ts:261:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  65  | 
  66  |     await expect(page.getByTestId('nav-group-chat')).toBeVisible();
  67  |     await expect(page.getByTestId('nav-group-control')).toBeVisible();
  68  |     await expect(page.getByTestId('nav-group-agent')).toBeVisible();
  69  |     await expect(page.getByTestId('nav-group-settings')).toBeVisible();
  70  |   });
  71  | 
  72  |   test('should show topbar with breadcrumb', async ({ page }) => {
  73  |     await page.setViewportSize({ width: 1440, height: 900 });
  74  |     await page.goto('/');
  75  | 
  76  |     const topbar = page.getByTestId('topbar');
  77  |     await expect(topbar).toBeVisible();
  78  | 
  79  |     const breadcrumb = topbar.locator('.topbar__breadcrumb');
  80  |     await expect(breadcrumb).toContainText('Agent Platform');
  81  |   });
  82  | 
  83  |   test('should collapse and expand sidebar', async ({ page }) => {
  84  |     await page.setViewportSize({ width: 1440, height: 900 });
  85  |     await page.goto('/');
  86  | 
  87  |     const sidebar = page.getByTestId('sidebar');
  88  |     await expect(sidebar).toBeVisible();
  89  | 
  90  |     const collapseToggle = page.getByTestId('sidebar-collapse-toggle');
  91  |     await expect(collapseToggle).toBeVisible();
  92  |     await expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
  93  | 
  94  |     await collapseToggle.click();
  95  |     await expect(collapseToggle).toHaveAttribute('aria-expanded', 'false');
  96  |     await expect(sidebar).toBeVisible();
  97  | 
  98  |     await collapseToggle.click();
  99  |     await expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
  100 |     await expect(sidebar).toBeVisible();
  101 |   });
  102 | 
  103 |   test('should open mobile drawer at narrow viewport', async ({ page }) => {
  104 |     await page.setViewportSize({ width: 1000, height: 800 });
  105 |     await page.goto('/');
  106 | 
  107 |     const mobileToggle = page.getByTestId('mobile-nav-toggle');
  108 |     await expect(mobileToggle).toBeVisible();
  109 |     await expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
  110 | 
  111 |     await mobileToggle.click();
  112 |     await expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');
  113 | 
  114 |     const sidebar = page.getByTestId('sidebar');
  115 |     await expect(sidebar).toBeVisible();
  116 | 
  117 |     await page.getByTestId('tab-status').click();
  118 |   });
  119 | 
  120 |   test('should close mobile drawer on tab selection', async ({ page }) => {
  121 |     await page.setViewportSize({ width: 1000, height: 800 });
  122 |     await page.goto('/');
  123 | 
  124 |     const mobileToggle = page.getByTestId('mobile-nav-toggle');
  125 |     await mobileToggle.click();
  126 | 
  127 |     await page.getByTestId('tab-status').click();
  128 | 
  129 |     const statusPanel = page.getByTestId('status-panel');
  130 |     await expect(statusPanel).toBeVisible();
  131 | 
  132 |     await expect(page.getByTestId('status-health-summary')).toBeVisible();
  133 |   });
  134 | 
  135 |   test('should have no console errors during original tab navigation', async ({ page }) => {
  136 |     await page.setViewportSize({ width: 1440, height: 900 });
  137 |     await page.goto('/');
  138 | 
  139 |     const consoleErrors: string[] = [];
  140 |     page.on('console', (msg) => {
  141 |       if (msg.type() === 'error') {
  142 |         const text = msg.text();
  143 |         const isNetworkError = text.includes('Failed to load resource') ||
  144 |                                text.includes('Failed to fetch') ||
  145 |                                text.includes('404');
  146 |         if (!isNetworkError) {
  147 |           consoleErrors.push(text);
  148 |         }
  149 |       }
  150 |     });
  151 | 
  152 |     const tabs = ['tab-dashboard', 'tab-session-console', 'tab-agent-monitor', 'tab-status'];
  153 |     for (const tabId of tabs) {
  154 |       await page.getByTestId(tabId).click();
  155 |       await page.waitForTimeout(300);
  156 |     }
  157 | 
  158 |     expect(consoleErrors).toHaveLength(0);
  159 |   });
  160 | });
  161 | 
  162 | test.describe('All Console Tabs Navigation', () => {
  163 |   test.beforeEach(async ({ page }) => {
  164 |     await page.setViewportSize({ width: 1440, height: 900 });
> 165 |     await page.goto('/');
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  166 |   });
  167 | 
  168 |   test('should display all 11 tab navigation items', async ({ page }) => {
  169 |     await expect(page.getByTestId('tab-session-console')).toBeVisible();
  170 |     await expect(page.getByTestId('tab-dashboard')).toBeVisible();
  171 |     await expect(page.getByTestId('tab-sessions')).toBeVisible();
  172 |     await expect(page.getByTestId('tab-usage')).toBeVisible();
  173 |     await expect(page.getByTestId('tab-logs-debug')).toBeVisible();
  174 |     await expect(page.getByTestId('tab-channels')).toBeVisible();
  175 |     await expect(page.getByTestId('tab-instances')).toBeVisible();
  176 |     await expect(page.getByTestId('tab-status')).toBeVisible();
  177 |     await expect(page.getByTestId('tab-agent-monitor')).toBeVisible();
  178 |     await expect(page.getByTestId('tab-skills')).toBeVisible();
  179 |     await expect(page.getByTestId('tab-settings')).toBeVisible();
  180 |   });
  181 | 
  182 |   test('should switch to sessions tab and show sessions list', async ({ page }) => {
  183 |     await page.getByTestId('tab-sessions').click();
  184 |     await expect(page.getByTestId('sessions-panel')).toBeVisible();
  185 |   });
  186 | 
  187 |   test('should switch to usage tab and show usage panel', async ({ page }) => {
  188 |     await page.getByTestId('tab-usage').click();
  189 |     await expect(page.getByTestId('usage-panel')).toBeVisible();
  190 |   });
  191 | 
  192 |   test('should switch to logs-debug tab and show logs panel', async ({ page }) => {
  193 |     await page.getByTestId('tab-logs-debug').click();
  194 |     await expect(page.getByTestId('logs-debug-panel')).toBeVisible();
  195 |   });
  196 | 
  197 |   test('should switch to channels tab and show channels panel', async ({ page }) => {
  198 |     await page.getByTestId('tab-channels').click();
  199 |     await expect(page.getByTestId('channels-panel')).toBeVisible();
  200 |   });
  201 | 
  202 |   test('should switch to instances tab and show instances panel', async ({ page }) => {
  203 |     await page.getByTestId('tab-instances').click();
  204 |     await expect(page.getByTestId('instances-panel')).toBeVisible();
  205 |   });
  206 | 
  207 |   test('should switch to skills tab and show skills panel', async ({ page }) => {
  208 |     await page.getByTestId('tab-skills').click();
  209 |     await expect(page.getByTestId('skills-panel')).toBeVisible();
  210 |   });
  211 | 
  212 |   test('should switch to settings tab and show settings panel', async ({ page }) => {
  213 |     await page.getByTestId('tab-settings').click();
  214 |     await expect(page.getByTestId('settings-panel')).toBeVisible();
  215 |   });
  216 | 
  217 |   test('session-console shows session list on load without auto-creating', async ({ page }) => {
  218 |     await page.getByTestId('tab-session-console').click();
  219 |     await expect(page.getByTestId('session-new-button')).toBeVisible();
  220 |     await expect(page.getByTestId('session-empty-state')).toBeVisible();
  221 |   });
  222 | 
  223 |   test('should navigate all 11 tabs with no console errors', async ({ page }) => {
  224 |     const consoleErrors: string[] = [];
  225 |     page.on('console', (msg) => {
  226 |       if (msg.type() === 'error') {
  227 |         const text = msg.text();
  228 |         const isNetworkError = text.includes('Failed to load resource') ||
  229 |                                text.includes('Failed to fetch') ||
  230 |                                text.includes('404');
  231 |         if (!isNetworkError) {
  232 |           consoleErrors.push(text);
  233 |         }
  234 |       }
  235 |     });
  236 | 
  237 |     const allTabs = [
  238 |       'tab-session-console',
  239 |       'tab-dashboard',
  240 |       'tab-sessions',
  241 |       'tab-usage',
  242 |       'tab-logs-debug',
  243 |       'tab-channels',
  244 |       'tab-instances',
  245 |       'tab-status',
  246 |       'tab-agent-monitor',
  247 |       'tab-skills',
  248 |       'tab-settings',
  249 |     ];
  250 | 
  251 |     for (const tabId of allTabs) {
  252 |       const tab = page.getByTestId(tabId);
  253 |       await expect(tab).toBeVisible();
  254 |       await tab.click();
  255 |       await page.waitForTimeout(300);
  256 |     }
  257 | 
  258 |     expect(consoleErrors).toHaveLength(0);
  259 |   });
  260 | 
  261 |   test('should display all 4 navigation groups with correct labels', async ({ page }) => {
  262 |     await expect(page.getByTestId('nav-group-chat')).toBeVisible();
  263 |     await expect(page.getByTestId('nav-group-control')).toBeVisible();
  264 |     await expect(page.getByTestId('nav-group-agent')).toBeVisible();
  265 |     await expect(page.getByTestId('nav-group-settings')).toBeVisible();
```