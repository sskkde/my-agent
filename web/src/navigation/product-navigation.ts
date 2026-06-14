/**
 * Product Navigation Mapping
 *
 * Maps legacy TabId values to product sections (Chat, Workspace, Operations, Admin).
 * This enables product-level navigation grouping while preserving the existing
 * navigation-config.ts structure.
 */

import type { TabId } from './navigation-config'

/**
 * Product sections for navigation grouping.
 * These represent the four main product areas of the application.
 */
export type ProductSection = 'chat' | 'workspace' | 'operations' | 'admin'

/**
 * Mapping from each TabId to its corresponding ProductSection.
 */
export type ProductNavMapping = Record<TabId, ProductSection>

/**
 * The complete mapping of all tabs to product sections.
 *
 * Section assignments:
 * - Chat: Real-time conversation interface
 * - Workspace: User-facing operations and management tools
 * - Operations: Agent operations and monitoring
 * - Admin: System configuration and administration
 */
export const PRODUCT_NAV_MAPPING: ProductNavMapping = {
  // Chat section
  'session-console': 'chat',

  // Workspace section
  dashboard: 'workspace',
  sessions: 'workspace',
  usage: 'workspace',
  'logs-debug': 'workspace',
  channels: 'workspace',
  instances: 'workspace',
  status: 'workspace',
  workflows: 'workspace',
  approvals: 'workspace',
  triggers: 'workspace',
  todos: 'workspace',
  memory: 'workspace',
  observability: 'workspace',

  // Operations section
  'agent-monitor': 'operations',
  skills: 'operations',
  agents: 'operations',
  connectors: 'operations',
  dlq: 'operations',

  // Admin section
  settings: 'admin',
  admin: 'admin',
}

/**
 * All available product sections.
 */
export const PRODUCT_SECTIONS: readonly ProductSection[] = ['chat', 'workspace', 'operations', 'admin'] as const

/**
 * Display labels for product sections.
 */
export const PRODUCT_SECTION_LABELS: Record<ProductSection, string> = {
  chat: '会话',
  workspace: '工作区',
  operations: '运维',
  admin: '管理',
}

/**
 * Get the product section for a given tab ID.
 *
 * @param tabId - The tab ID to look up
 * @returns The product section the tab belongs to
 */
export function getProductSection(tabId: TabId): ProductSection {
  return PRODUCT_NAV_MAPPING[tabId]
}

/**
 * Get all tab IDs that belong to a specific product section.
 *
 * @param section - The product section to get tabs for
 * @returns Array of tab IDs belonging to the section
 */
export function getAllTabsForSection(section: ProductSection): TabId[] {
  return Object.entries(PRODUCT_NAV_MAPPING)
    .filter(([, productSection]) => productSection === section)
    .map(([tabId]) => tabId as TabId)
}

/**
 * Get all tab IDs grouped by product section.
 *
 * @returns Record mapping each product section to its array of tab IDs
 */
export function getTabsBySection(): Record<ProductSection, TabId[]> {
  const result: Record<ProductSection, TabId[]> = {
    chat: [],
    workspace: [],
    operations: [],
    admin: [],
  }

  for (const section of PRODUCT_SECTIONS) {
    result[section] = getAllTabsForSection(section)
  }

  return result
}
