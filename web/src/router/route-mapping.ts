/**
 * Route Mapping Helpers
 *
 * Provides bidirectional mapping between URL paths and navigation state.
 * Handles validation of tab IDs and provides safe fallback behavior.
 */

import type { TabId } from '../navigation/navigation-config'
import type { ProductSection } from '../navigation/product-navigation'
import { getProductSection } from '../navigation/product-navigation'
import { ROUTES, buildPath } from './route-constants'

/**
 * Valid tab IDs for each product section.
 * Extracted from PRODUCT_NAV_MAPPING in product-navigation.ts.
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
 * Used as fallback when invalid tab ID is provided.
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
 * - /workspace/:tabId → workspace section with specific tab
 * - /operations/:tabId → operations section with specific tab
 * - /admin/:tabId → admin section with specific tab
 *
 * Invalid tab IDs are replaced with the section's default tab.
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
      return {
        tabId: DEFAULT_TABS.chat,
        sessionId,
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
 * Build a URL path from navigation state.
 *
 * @param tabId - The tab ID
 * @param sessionId - Optional session ID (only used for chat section)
 * @returns The URL path
 */
export function navigationToRoute(tabId: TabId, sessionId?: string): string {
  const section = getProductSection(tabId)

  switch (section) {
    case 'chat': {
      if (sessionId) {
        return buildPath(ROUTES.CHAT_SESSION, { sessionId })
      }
      return ROUTES.CHAT
    }

    case 'workspace': {
      return buildPath(ROUTES.WORKSPACE, { tabId })
    }

    case 'operations': {
      return buildPath(ROUTES.OPERATIONS, { tabId })
    }

    case 'admin': {
      return buildPath(ROUTES.ADMIN, { tabId })
    }

    default:
      // Fallback to chat
      return ROUTES.CHAT
  }
}

/**
 * Get the route path for a product section's default tab.
 *
 * @param section - The product section
 * @returns The URL path for the section's default tab
 */
export function getSectionDefaultRoute(section: ProductSection): string {
  const defaultTab = getDefaultTab(section)
  return navigationToRoute(defaultTab)
}
