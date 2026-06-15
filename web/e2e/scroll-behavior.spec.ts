import { test, expect } from '@playwright/test';

/**
 * Scroll Behavior Tests for Session Console
 *
 * These tests verify that scroll containers are properly isolated:
 * - Desktop: Session sidebar and timeline body scroll independently
 * - Mobile: Chat content scrolls without whole-page scroll bleed
 *
 * These tests are designed to FAIL on the current implementation
 * and will PASS after Task 7/13 implementation.
 */

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 375, height: 667 }; // iPhone SE


test.describe('Desktop Scroll Independence', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should have separate scroll containers for sidebar and timeline on desktop', async ({ page }) => {
    // Navigate to session console tab
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Verify both containers exist
    const sidebar = page.getByTestId('sessions-sidebar');
    const timeline = page.getByTestId('session-timeline');

    await expect(sidebar).toBeVisible();
    await expect(timeline).toBeVisible();

    // Get scroll container elements
    const sidebarScrollContainer = sidebar.locator('.sessions-list');
    const timelineScrollContainer = timeline.locator('.session-timeline-container');

    // Verify scroll containers exist
    await expect(sidebarScrollContainer).toBeVisible();
    await expect(timelineScrollContainer).toBeVisible();

    // Check CSS overflow properties - both should have overflow-y: auto
    const sidebarOverflow = await sidebarScrollContainer.evaluate((el) =>
      window.getComputedStyle(el).overflowY
    );
    const timelineOverflow = await timelineScrollContainer.evaluate((el) =>
      window.getComputedStyle(el).overflowY
    );

    // FAILING: Current implementation may have nested scroll or incorrect overflow
    expect(sidebarOverflow).toBe('auto');
    expect(timelineOverflow).toBe('auto');

    // Verify parent container does NOT have overflow scroll
    const parentContainer = page.locator('.session-console-rich');
    const parentOverflow = await parentContainer.evaluate((el) =>
      window.getComputedStyle(el).overflow
    );

    // FAILING: Parent should not have scroll, only hidden or visible
    expect(parentOverflow).not.toBe('scroll');
    expect(parentOverflow).not.toBe('auto');
  });

  test('should scroll sidebar without affecting timeline scroll position', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // This test requires multiple sessions to be visible
    // If no sessions exist, create some by clicking "new session" multiple times
    const newSessionButton = page.getByTestId('session-new-button');

    // Create multiple sessions to enable scrolling
    for (let i = 0; i < 5; i++) {
      if (await newSessionButton.isVisible()) {
        await newSessionButton.click();
        await page.waitForTimeout(200);
      }
    }

    const sidebar = page.getByTestId('sessions-sidebar');
    const timeline = page.getByTestId('session-timeline');
    const sidebarList = sidebar.locator('.sessions-list');

    // Select a session to show timeline
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // Record initial scroll positions
    const initialSidebarScroll = await sidebarList.evaluate((el) => el.scrollTop);
    const initialTimelineScroll = await timeline.evaluate((el) => {
      const container = el.querySelector('.session-timeline-container') as HTMLElement;
      return container?.scrollTop ?? 0;
    });

    // Scroll the sidebar
    await sidebarList.evaluate((el) => {
      el.scrollTop = el.scrollHeight; // Scroll to bottom
    });
    await page.waitForTimeout(100);

    // Verify sidebar scrolled
    const newSidebarScroll = await sidebarList.evaluate((el) => el.scrollTop);
    expect(newSidebarScroll).toBeGreaterThan(initialSidebarScroll);

    // FAILING: Timeline scroll should remain unchanged
    const timelineScrollAfterSidebarScroll = await timeline.evaluate((el) => {
      const container = el.querySelector('.session-timeline-container') as HTMLElement;
      return container?.scrollTop ?? 0;
    });

    expect(timelineScrollAfterSidebarScroll).toBe(initialTimelineScroll);
  });

  test('should scroll timeline without affecting sidebar scroll position', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    const sidebar = page.getByTestId('sessions-sidebar');
    const timeline = page.getByTestId('session-timeline');
    const sidebarList = sidebar.locator('.sessions-list');
    const timelineContainer = timeline.locator('.session-timeline-container');

    // Select a session
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // Record initial scroll positions
    const initialSidebarScroll = await sidebarList.evaluate((el) => el.scrollTop);
    const initialTimelineScroll = await timelineContainer.evaluate((el) => el.scrollTop);

    // Scroll the timeline
    await timelineContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight; // Scroll to bottom
    });
    await page.waitForTimeout(100);

    // Verify timeline scrolled
    const newTimelineScroll = await timelineContainer.evaluate((el) => el.scrollTop);
    expect(newTimelineScroll).toBeGreaterThanOrEqual(initialTimelineScroll);

    // FAILING: Sidebar scroll should remain unchanged
    const sidebarScrollAfterTimelineScroll = await sidebarList.evaluate((el) => el.scrollTop);

    expect(sidebarScrollAfterTimelineScroll).toBe(initialSidebarScroll);
  });

  test('should have single scroll container for timeline (not nested)', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    const timeline = page.getByTestId('session-timeline');

    // Select a session
    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // FAILING: Check that there are no nested scroll containers
    // Only .session-timeline-container should have overflow-y: auto
    // .timeline-list should NOT have overflow-y: auto (it should inherit scroll from parent)
    const nestedScrollContainers = await timeline.evaluate(() => {
      const findScrollContainers = (el: Element): Element[] => {
        const containers: Element[] = [];
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          containers.push(el);
        }
        el.children && Array.from(el.children).forEach(child => {
          containers.push(...findScrollContainers(child));
        });
        return containers;
      };

      const timelineEl = document.querySelector('[data-testid="session-timeline"]');
      return timelineEl ? findScrollContainers(timelineEl) : [];
    });

    // Should have exactly 1 scroll container (.session-timeline-container)
    // FAILING: Currently has both .session-timeline-container AND .timeline-list with overflow
    expect(nestedScrollContainers.length).toBe(1);
  });
});

test.describe('Mobile Scroll Isolation', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should prevent whole-page scroll when scrolling timeline on mobile', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // On mobile, sidebar is hidden. Need to open it and select a session first
    const sidebarToggle = page.getByTestId('session-sidebar-toggle');
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
      await page.waitForTimeout(200);
    }

    // Select a session
    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    const timeline = page.getByTestId('session-timeline');
    const timelineContainer = timeline.locator('.session-timeline-container');

    // Verify timeline is visible
    await expect(timeline).toBeVisible();

    // Record initial document scroll position
    const initialDocScroll = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollX: window.scrollX,
    }));

    // Scroll the timeline content
    await timelineContainer.evaluate((el) => {
      el.scrollTop = 100;
    });
    await page.waitForTimeout(100);

    // FAILING: Document scroll should NOT change when scrolling timeline
    const docScrollAfterTimelineScroll = await page.evaluate(() => ({
      scrollY: window.scrollY,
      scrollX: window.scrollX,
    }));

    expect(docScrollAfterTimelineScroll.scrollY).toBe(initialDocScroll.scrollY);
    expect(docScrollAfterTimelineScroll.scrollX).toBe(initialDocScroll.scrollX);
  });

  test('should keep input dock visible while scrolling timeline on mobile', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Open sidebar and select session
    const sidebarToggle = page.getByTestId('session-sidebar-toggle');
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
      await page.waitForTimeout(200);
    }

    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // Input dock should be visible
    const inputDock = page.locator('.session-input-dock');
    await expect(inputDock).toBeVisible();

    // Scroll timeline
    const timeline = page.getByTestId('session-timeline');
    const timelineContainer = timeline.locator('.session-timeline-container');
    await timelineContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(100);

    // FAILING: Input dock should still be visible after scrolling
    await expect(inputDock).toBeVisible();

    // Verify input is still interactable
    const input = page.getByTestId('session-message-input');
    await expect(input).toBeVisible();
    await expect(input).not.toBeDisabled();
  });

  test('should have timeline scroll container properly sized on mobile', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Open sidebar and select session
    const sidebarToggle = page.getByTestId('session-sidebar-toggle');
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
      await page.waitForTimeout(200);
    }

    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    const timeline = page.getByTestId('session-timeline');
    const timelineContainer = timeline.locator('.session-timeline-container');

    // FAILING: Check that timeline container has proper height constraints
    const containerInfo = await timelineContainer.evaluate((el) => ({
      height: el.clientHeight,
      scrollHeight: el.scrollHeight,
      computedHeight: window.getComputedStyle(el).height,
      hasOverflow: window.getComputedStyle(el).overflowY,
    }));

    // Container should have constrained height (not 100vh or auto)
    expect(containerInfo.computedHeight).not.toBe('auto');

    // Should have overflow-y: auto for scrolling
    expect(containerInfo.hasOverflow).toBe('auto');
  });

  test('should not have timeline-list with overflow scroll on mobile', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Open sidebar and select session
    const sidebarToggle = page.getByTestId('session-sidebar-toggle');
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
      await page.waitForTimeout(200);
    }

    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // FAILING: .timeline-list should NOT have its own overflow
    // Only .session-timeline-container should handle scrolling
    const timelineList = page.locator('.timeline-list');
    const listOverflow = await timelineList.evaluate((el) =>
      window.getComputedStyle(el).overflowY
    );

    // Should not be auto or scroll - should be visible
    expect(listOverflow).not.toBe('auto');
    expect(listOverflow).not.toBe('scroll');
  });

  test('should scroll chat content without body scroll bleed', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Open sidebar and select session
    const sidebarToggle = page.getByTestId('session-sidebar-toggle');
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
      await page.waitForTimeout(200);
    }

    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // FAILING: Body should have overflow hidden to prevent page scroll
    const bodyOverflow = await page.evaluate(() =>
      window.getComputedStyle(document.body).overflow
    );

    // Body should not allow scroll
    expect(bodyOverflow).toBe('hidden');

    // Verify the whole page stays in place while timeline scrolls
    const timeline = page.getByTestId('session-timeline');
    const timelineContainer = timeline.locator('.session-timeline-container');

    // Get initial positions
    await page.evaluate(() => ({
      bodyScrollTop: document.body.scrollTop,
      docScrollTop: document.documentElement.scrollTop,
      windowScrollY: window.scrollY,
    }));

    // Scroll timeline
    await timelineContainer.evaluate((el) => {
      el.scrollTop = 200;
    });
    await page.waitForTimeout(100);

    // Check positions after scroll
    const positionsAfterScroll = await page.evaluate(() => ({
      bodyScrollTop: document.body.scrollTop,
      docScrollTop: document.documentElement.scrollTop,
      windowScrollY: window.scrollY,
    }));

    // All body/document scroll positions should remain at 0
    expect(positionsAfterScroll.bodyScrollTop).toBe(0);
    expect(positionsAfterScroll.docScrollTop).toBe(0);
    expect(positionsAfterScroll.windowScrollY).toBe(0);
  });
});

test.describe('Scroll Container Structure Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('should have exactly one scroll container in timeline hierarchy', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Select a session
    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // FAILING: Count scroll containers in the timeline
    const scrollContainerCount = await page.evaluate(() => {
      const countContainers = (el: Element): number => {
        let count = 0;
        const style = window.getComputedStyle(el);

        // Check if this element has scroll
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight) {
          count = 1;
        }

        // Recursively check children
        Array.from(el.children).forEach(child => {
          count += countContainers(child);
        });

        return count;
      };

      const timeline = document.querySelector('[data-testid="session-timeline"]');
      return timeline ? countContainers(timeline) : 0;
    });

    // Should have exactly 1 active scroll container
    expect(scrollContainerCount).toBe(1);
  });

  test('should have flex:1 on timeline scroll container for proper sizing', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Select a session
    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // Check .session-timeline-container has flex: 1
    const timelineContainer = page.locator('.session-timeline-container');
    const flexValue = await timelineContainer.evaluate((el) =>
      window.getComputedStyle(el).flex
    );

    // Should have flex shorthand with grow > 0 (e.g., "1 1 0%" or "1 0 auto")
    expect(flexValue).toMatch(/^1\s/);
  });

  test('should have min-height:0 on timeline scroll container', async ({ page }) => {
    // Navigate to session console
    const sessionTab = page.getByTestId('tab-session-console');
    if (await sessionTab.isVisible()) {
      await sessionTab.click();
      await page.waitForTimeout(300);
    }

    // Select a session
    const sidebar = page.getByTestId('sessions-sidebar');
    const firstSession = sidebar.locator('[data-testid^="session-item-"]').first();
    if (await firstSession.isVisible()) {
      await firstSession.click();
      await page.waitForTimeout(300);
    }

    // Check .session-timeline-container has min-height: 0 (important for flex children)
    const timelineContainer = page.locator('.session-timeline-container');
    const minHeight = await timelineContainer.evaluate((el) =>
      window.getComputedStyle(el).minHeight
    );

    // Should have min-height: 0px to allow shrinking in flex context
    expect(minHeight).toBe('0px');
  });
});
