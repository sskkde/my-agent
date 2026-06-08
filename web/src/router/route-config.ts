/**
 * Route Configuration
 *
 * Defines route configuration structures used by production app integration.
 * These configurations provide metadata and validation helpers for each route,
 * enabling safe routing with fallback behavior.
 *
 * This module is additive - it does not activate BrowserRouter.
 * Production routing activation happens in Task 10.
 */

import type { TabId } from '../navigation/navigation-config'
import type { ProductSection } from '../navigation/product-navigation'
import { ROUTES } from './route-constants'
import {
  DEFAULT_TABS,
  isValidTabForSection,
  validateTabOrFallback,
} from './route-mapping'

/**
 * Route metadata including section, validation, and defaults.
 */
export interface RouteMetadata {
  /** The product section this route belongs to */
  section: ProductSection
  /** Human-readable label for the route */
  label: string
  /** Whether this route has a dynamic tab parameter */
  hasTabParam: boolean
  /** Whether this route has a session ID parameter */
  hasSessionParam: boolean
  /** Default tab for this route (if applicable) */
  defaultTab?: TabId
  /** Description of the route's purpose */
  description: string
}

/**
 * Route configuration structure for production app integration.
 * Combines route path with metadata and validation helpers.
 */
export interface RouteConfig {
  /** Route path pattern (e.g., '/workspace/:tabId') */
  path: string
  /** Route metadata */
  metadata: RouteMetadata
  /** Validate a tab ID for this route */
  validateTab?: (tabId: string) => boolean
  /** Get the validated tab or fallback to default */
  getValidatedTab: (tabId: string | undefined) => TabId
}

/**
 * Route configurations for all product sections.
 * These configurations can be used to generate Route components in production.
 */
export const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  root: {
    path: ROUTES.ROOT,
    metadata: {
      section: 'chat',
      label: 'Root',
      hasTabParam: false,
      hasSessionParam: false,
      defaultTab: DEFAULT_TABS.chat,
      description: 'Root path that redirects to chat section',
    },
    getValidatedTab: () => DEFAULT_TABS.chat,
  },

  chat: {
    path: ROUTES.CHAT,
    metadata: {
      section: 'chat',
      label: 'Chat',
      hasTabParam: false,
      hasSessionParam: false,
      defaultTab: DEFAULT_TABS.chat,
      description: 'Chat section with default session',
    },
    getValidatedTab: () => DEFAULT_TABS.chat,
  },

  chatSession: {
    path: ROUTES.CHAT_SESSION,
    metadata: {
      section: 'chat',
      label: 'Chat Session',
      hasTabParam: false,
      hasSessionParam: true,
      defaultTab: DEFAULT_TABS.chat,
      description: 'Chat section with specific session',
    },
    getValidatedTab: () => DEFAULT_TABS.chat,
  },

  workspace: {
    path: ROUTES.WORKSPACE,
    metadata: {
      section: 'workspace',
      label: 'Workspace',
      hasTabParam: true,
      hasSessionParam: false,
      defaultTab: DEFAULT_TABS.workspace,
      description: 'Workspace section with tab-based navigation',
    },
    validateTab: (tabId: string) => isValidTabForSection(tabId, 'workspace'),
    getValidatedTab: (tabId: string | undefined) => validateTabOrFallback(tabId, 'workspace'),
  },

  operations: {
    path: ROUTES.OPERATIONS,
    metadata: {
      section: 'operations',
      label: 'Operations',
      hasTabParam: true,
      hasSessionParam: false,
      defaultTab: DEFAULT_TABS.operations,
      description: 'Operations section with tab-based navigation',
    },
    validateTab: (tabId: string) => isValidTabForSection(tabId, 'operations'),
    getValidatedTab: (tabId: string | undefined) => validateTabOrFallback(tabId, 'operations'),
  },

  admin: {
    path: ROUTES.ADMIN,
    metadata: {
      section: 'admin',
      label: 'Admin',
      hasTabParam: true,
      hasSessionParam: false,
      defaultTab: DEFAULT_TABS.admin,
      description: 'Admin section with tab-based navigation',
    },
    validateTab: (tabId: string) => isValidTabForSection(tabId, 'admin'),
    getValidatedTab: (tabId: string | undefined) => validateTabOrFallback(tabId, 'admin'),
  },
}

/**
 * Get route configuration by path.
 *
 * @param path - Route path pattern
 * @returns Route configuration, or undefined if not found
 */
export function getRouteConfig(path: string): RouteConfig | undefined {
  return Object.values(ROUTE_CONFIGS).find(config => config.path === path)
}

/**
 * Get all route configurations for a product section.
 *
 * @param section - The product section
 * @returns Array of route configurations for the section
 */
export function getRouteConfigsBySection(section: ProductSection): RouteConfig[] {
  return Object.values(ROUTE_CONFIGS).filter(config => config.metadata.section === section)
}

/**
 * Validate a route parameter (tab or session) for a given route.
 *
 * @param routePath - Route path pattern
 * @param param - Parameter name ('tabId' or 'sessionId')
 * @param value - Parameter value to validate
 * @returns True if valid, false otherwise
 */
export function validateRouteParam(
  routePath: string,
  param: 'tabId' | 'sessionId',
  value: string
): boolean {
  const config = getRouteConfig(routePath)
  if (!config) return false

  if (param === 'tabId' && config.validateTab) {
    return config.validateTab(value)
  }

  if (param === 'sessionId') {
    // Session IDs are always valid if present (non-empty string)
    return value.length > 0
  }

  return false
}

/**
 * Get validated route parameter with fallback.
 * Returns the validated parameter or the route's default.
 *
 * @param routePath - Route path pattern
 * @param param - Parameter name ('tabId' or 'sessionId')
 * @param value - Parameter value (may be undefined)
 * @returns Validated parameter value or default
 */
export function getValidatedRouteParam(
  routePath: string,
  param: 'tabId',
  value: string | undefined
): TabId {
  const config = getRouteConfig(routePath)
  if (!config) return DEFAULT_TABS.chat

  if (param === 'tabId') {
    return config.getValidatedTab(value)
  }

  return DEFAULT_TABS.chat
}

/**
 * Route configuration summary for debugging and inspection.
 */
export interface RouteConfigSummary {
  totalRoutes: number
  sections: ProductSection[]
  routesBySection: Record<ProductSection, number>
  routesWithTabParam: number
  routesWithSessionParam: number
}

/**
 * Get a summary of all route configurations.
 * Useful for debugging and verification.
 *
 * @returns Summary of route configurations
 */
export function getRouteConfigSummary(): RouteConfigSummary {
  const configs = Object.values(ROUTE_CONFIGS)
  const sections = new Set<ProductSection>()
  const routesBySection: Record<ProductSection, number> = {
    chat: 0,
    workspace: 0,
    operations: 0,
    admin: 0,
  }
  let routesWithTabParam = 0
  let routesWithSessionParam = 0

  for (const config of configs) {
    sections.add(config.metadata.section)
    routesBySection[config.metadata.section]++
    if (config.metadata.hasTabParam) routesWithTabParam++
    if (config.metadata.hasSessionParam) routesWithSessionParam++
  }

  return {
    totalRoutes: configs.length,
    sections: Array.from(sections),
    routesBySection,
    routesWithTabParam,
    routesWithSessionParam,
  }
}

/**
 * Verify that route configurations cover all product sections.
 * Used by tests to ensure complete coverage.
 *
 * @returns True if all sections are covered
 */
export function verifyRouteConfigCoverage(): boolean {
  const summary = getRouteConfigSummary()
  const expectedSections: ProductSection[] = ['chat', 'workspace', 'operations', 'admin']
  
  return expectedSections.every(section => summary.routesBySection[section] > 0)
}
