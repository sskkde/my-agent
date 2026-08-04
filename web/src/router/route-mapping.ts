/**
 * Route Mapping Helpers
 *
 * Provides bidirectional mapping between URL paths and navigation state.
 * Handles validation of tab IDs and provides safe fallback behavior.
 *
 * NOTE (Task 4): workspace/operations/admin are LEGACY routes — they no
 * longer render standalone pages. Navigation targets for non-Chat tabs
 * collapse onto `/chat`, and old deep links are redirected to Chat with a
 * one-shot `modalDestination` location state (see `getLegacyRedirectRoute`).
 */

import type { TabId } from '../navigation/navigation-config'
import type { ProductSection } from '../navigation/product-navigation'
import { getProductSection } from '../navigation/product-navigation'
import { ROUTES, buildPath } from './route-constants'

/**
 * Valid tab IDs for each product section.
 *
 * Extracted from PRODUCT_NAV_MAPPING in product-navigation.ts. The
 * workspace/operations/admin lists are kept for legacy deep-link validation:
 * they describe which tab IDs a legacy URL may carry before it is redirected
 * to Chat (see `getLegacyRedirectRoute` and App's `LegacyRouteRedirect`).
 * No route renders these sections standalone anymore.
 */
export const VALID_TABS: Record<ProductSection, readonly TabId[]> = {
  chat: ['session-console'] as const,
  workspace: [
    'dashboard',
    'sessions',
    'usage',
    'logs-debug',
    'channels',
    'instances',
    'status',
    'workflows',
    'approvals',
    'triggers',
    'todos',
    'memory',
    'observability',
  ] as const,
  operations: ['agent-monitor', 'skills', 'agents', 'connectors', 'dlq'] as const,
  admin: ['settings', 'admin'] as const,
} as const

/**
 * Default tab for each product section.
 *
 * Used as fallback when an invalid tab ID is provided. For the legacy
 * sections the default only matters while parsing an incoming legacy URL;
 * the resulting route is always Chat.
 */
export const DEFAULT_TABS: Record<ProductSection, TabId> = {
  chat: 'session-console',
  workspace: 'dashboard',
  operations: 'agent-monitor',
  admin: 'settings',
}

/**
 * Navigation state extracted from a URL path.
 */
export interface NavigationState {
  /** The tab ID to display */
  tabId: TabId
  /** Optional session ID (only for chat section) */
  sessionId?: string
  taskId?: string
  /** The product section this tab belongs to */
  section: ProductSection
}

/**
 * Check if a tab ID is valid for a given product section.
 *
 * @param tabId - The tab ID to validate
 * @param section - The product section to check against
 * @returns True if the tab ID belongs to the section
 */
export function isValidTabForSection(tabId: string, section: ProductSection): boolean {
  return VALID_TABS[section].includes(tabId as TabId)
}

/**
 * Get the default tab for a product section.
 *
 * @param section - The product section
 * @returns The default tab ID for the section
 */
export function getDefaultTab(section: ProductSection): TabId {
  return DEFAULT_TABS[section]
}

/**
 * Validate a tab ID for a section and return it if valid,
 * otherwise return the section's default tab.
 *
 * @param tabId - The tab ID to validate
 * @param section - The product section
 * @returns The validated tab ID or the section's default
 */
export function validateTabOrFallback(tabId: string | undefined, section: ProductSection): TabId {
  if (!tabId) {
    return getDefaultTab(section)
  }

  if (isValidTabForSection(tabId, section)) {
    return tabId as TabId
  }

  return getDefaultTab(section)
}

/**
 * Parse a URL path into navigation state.
 *
 * Handles the following path patterns:
 * - / → redirects to /chat (returns chat section with default tab)
 * - /chat → chat section with default tab
 * - /chat/:sessionId → chat section with specific session
 * - /workspace/:tabId → workspace section with specific tab (LEGACY)
 * - /operations/:tabId → operations section with specific tab (LEGACY)
 * - /admin/:tabId → admin section with specific tab (LEGACY)
 *
 * The legacy section paths are parsed for deep-link redirect purposes only —
 * App redirects them to Chat via `getLegacyRedirectRoute` and never renders a
 * standalone page for them. Invalid tab IDs are replaced with the section's
 * default tab.
 *
 * @param path - The URL path to parse
 * @returns Navigation state extracted from the path
 */
export function routeToNavigation(path: string): NavigationState {
  // Normalize path: remove trailing slash, ensure leading slash
  const normalizedPath = path.replace(/\/$/, '') || '/'

  // Root path redirects to /chat
  if (normalizedPath === '/') {
    return {
      tabId: DEFAULT_TABS.chat,
      section: 'chat',
    }
  }

  // Parse path segments
  const segments = normalizedPath.split('/').filter(Boolean)
  const [sectionName, ...params] = segments

  switch (sectionName) {
    case 'chat': {
      const sessionId = params[0]
      const taskId = params[1] === 'task' ? params[2] : undefined
      return {
        tabId: DEFAULT_TABS.chat,
        sessionId,
        taskId,
        section: 'chat',
      }
    }

    case 'workspace': {
      const tabId = validateTabOrFallback(params[0], 'workspace')
      return {
        tabId,
        section: 'workspace',
      }
    }

    case 'operations': {
      const tabId = validateTabOrFallback(params[0], 'operations')
      return {
        tabId,
        section: 'operations',
      }
    }

    case 'admin': {
      const tabId = validateTabOrFallback(params[0], 'admin')
      return {
        tabId,
        section: 'admin',
      }
    }

    default:
      // Unknown path - default to chat
      return {
        tabId: DEFAULT_TABS.chat,
        section: 'chat',
      }
  }
}

/**
 * Build the redirect target for a legacy secondary route.
 *
 * All legacy section paths (workspace/operations/admin) collapse onto the
 * Chat surface. The tab id is accepted so callers can validate it against the
 * modal destination registry before attaching a one-shot `modalDestination`
 * location state; the URL target itself is always Chat.
 *
 * @param _tabId - The legacy tab id (kept for call-site symmetry/validation)
 * @returns The Chat route path every legacy URL redirects to
 */
export function getLegacyRedirectRoute(_tabId: TabId): string {
  return ROUTES.CHAT
}

/**
 * Build a URL path from navigation state.
 *
 * Chat tabs map to their own routes; every other tab id (workspace/
 * operations/admin) is a modal destination now, so navigation collapses onto
 * the Chat route.
 *
 * @param tabId - The tab ID
 * @param sessionId - Optional session ID (only used for chat section)
 * @returns The URL path
 */
export function navigationToRoute(tabId: TabId, sessionId?: string, taskId?: string): string {
  const section = getProductSection(tabId)

  switch (section) {
    case 'chat': {
      if (sessionId) {
        if (taskId) return buildPath(ROUTES.CHAT_TASK, { sessionId, taskId })
        return buildPath(ROUTES.CHAT_SESSION, { sessionId })
      }
      return ROUTES.CHAT
    }

    case 'workspace':
    case 'operations':
    case 'admin':
      // Legacy sections no longer have standalone routes; the destination is
      // opened via the secondary modal from the Chat surface.
      return ROUTES.CHAT

    default:
      // Fallback to chat
      return ROUTES.CHAT
  }
}

/**
 * Get the route path for a product section's default tab.
 *
 * For the legacy sections this is now always the Chat route — the section's
 * default tab is only meaningful for validating legacy deep links.
 *
 * @param section - The product section
 * @returns The URL path for the section's default tab
 */
export function getSectionDefaultRoute(section: ProductSection): string {
  const defaultTab = getDefaultTab(section)
  return navigationToRoute(defaultTab)
}
