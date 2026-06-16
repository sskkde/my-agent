/**
 * Container Page Composition Mapping
 *
 * Maps product sections and TabId values to their corresponding feature tab components.
 * This enables container pages to render child tabs without duplicating rendering logic.
 *
 * All existing feature tab components are reused - no rewrites.
 */

import React from 'react'
import type { TabId } from '../../navigation/navigation-config'
import type { ProductSection } from '../../navigation/product-navigation'

// Reuse existing feature tab components - no rewrites
import DashboardTab from '../dashboard/DashboardTab'
import SessionWorkspace from '../session/SessionWorkspace'
import AgentMonitorTab from '../monitor/AgentMonitorTab'
import StatusTab from '../status/StatusTab'
import SessionsTab from '../sessions/SessionsTab'
import UsageTab from '../usage/UsageTab'
import LogsDebugTab from '../logs/LogsDebugTab'
import ChannelsTab from '../channels/ChannelsTab'
import InstancesTab from '../instances/InstancesTab'
import SkillsTab from '../skills/SkillsTab'
import AgentsTab from '../agents/AgentsTab'
import SettingsTab from '../settings/SettingsTab'
import WorkflowsTab from '../workflows/WorkflowsTab'
import ApprovalsTab from '../approvals/ApprovalsTab'
import TriggersTab from '../triggers/TriggersTab'
import TodosTab from '../todos/TodosTab'
import MemoryTab from '../memory/MemoryTab'
import ObservabilityTab from '../observability/ObservabilityTab'
import ConnectorsTab from '../connectors/ConnectorsTab'
import DLQTab from '../dlq/DLQTab'
import AdminTab from '../admin/AdminTab'

/**
 * Props that may be passed to tab components.
 * Some tabs require special props like onTabChange.
 */
export interface TabComponentProps {
  onTabChange?: (tab: TabId) => void
  sessionId?: string | null
}

/**
 * Union type of all feature tab component types.
 * Using a flexible type to accommodate different component prop requirements.
 */
export type TabComponent =
  | typeof DashboardTab
  | typeof SessionWorkspace
  | typeof AgentMonitorTab
  | typeof StatusTab
  | typeof SessionsTab
  | typeof UsageTab
  | typeof LogsDebugTab
  | typeof ChannelsTab
  | typeof InstancesTab
  | typeof SkillsTab
  | typeof AgentsTab
  | typeof SettingsTab
  | typeof WorkflowsTab
  | typeof ApprovalsTab
  | typeof TriggersTab
  | typeof TodosTab
  | typeof MemoryTab
  | typeof ObservabilityTab
  | typeof ConnectorsTab
  | typeof DLQTab
  | typeof AdminTab

/**
 * Mapping from each TabId to its corresponding feature tab component.
 *
 * This mapping enables container pages to render child tabs dynamically:
 * - Workspace container renders: dashboard, sessions, usage, logs-debug, channels, instances, status, workflows, approvals, triggers, memory, observability
 * - Operations container renders: agent-monitor, skills, agents, connectors, dlq
 * - Admin container renders: settings, admin
 * - Chat container renders: session-console
 */
export const TAB_COMPONENT_MAPPING: Record<TabId, TabComponent> = {
  // Chat section
  'session-console': SessionWorkspace,

  // Workspace section
  dashboard: DashboardTab,
  sessions: SessionsTab,
  usage: UsageTab,
  'logs-debug': LogsDebugTab,
  channels: ChannelsTab,
  instances: InstancesTab,
  status: StatusTab,
  workflows: WorkflowsTab,
  approvals: ApprovalsTab,
  triggers: TriggersTab,
  todos: TodosTab,
  memory: MemoryTab,
  observability: ObservabilityTab,

  // Operations section
  'agent-monitor': AgentMonitorTab,
  skills: SkillsTab,
  agents: AgentsTab,
  connectors: ConnectorsTab,
  dlq: DLQTab,

  // Admin section
  settings: SettingsTab,
  admin: AdminTab,
}

/**
 * Get the component for a given tab ID.
 *
 * @param tabId - The tab ID to look up
 * @returns The React component for the tab
 */
export function getTabComponent(tabId: TabId): TabComponent {
  return TAB_COMPONENT_MAPPING[tabId]
}

/**
 * Container page composition configuration.
 * Defines which tabs belong to each container page.
 */
export interface ContainerPageConfig {
  section: ProductSection
  tabs: TabId[]
  label: string
}

/**
 * Container page configurations for Workspace, Operations, and Admin.
 *
 * These configurations define the composition of each container page:
 * - Workspace: User-facing operations and management tools
 * - Operations: Agent operations and monitoring
 * - Admin: System configuration and administration
 *
 * Note: Chat is handled separately as a special case (single tab).
 */
export const CONTAINER_PAGE_CONFIGS: Record<string, ContainerPageConfig> = {
  workspace: {
    section: 'workspace',
    tabs: [
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
    ],
    label: 'Workspace',
  },
  operations: {
    section: 'operations',
    tabs: ['agent-monitor', 'skills', 'agents', 'connectors', 'dlq'],
    label: 'Operations',
  },
  admin: {
    section: 'admin',
    tabs: ['settings', 'admin'],
    label: 'Admin',
  },
}

/**
 * Get the container page configuration for a product section.
 *
 * @param section - The product section
 * @returns The container page configuration, or undefined if not a container section
 */
export function getContainerPageConfig(section: ProductSection): ContainerPageConfig | undefined {
  // Chat is not a container page (single tab)
  if (section === 'chat') {
    return undefined
  }

  return CONTAINER_PAGE_CONFIGS[section]
}

/**
 * Check if a product section is a container page.
 *
 * @param section - The product section to check
 * @returns True if the section is a container page (Workspace, Operations, or Admin)
 */
export function isContainerPage(section: ProductSection): boolean {
  return section !== 'chat'
}

/**
 * Get all tabs that belong to a container page.
 *
 * @param section - The product section
 * @returns Array of tab IDs for the container, or empty array if not a container
 */
export function getContainerTabs(section: ProductSection): TabId[] {
  const config = getContainerPageConfig(section)
  return config?.tabs ?? []
}

/**
 * Render a tab component with optional props.
 *
 * This helper function provides a consistent interface for rendering tabs
 * within container pages.
 *
 * @param tabId - The tab ID to render
 * @param props - Optional props to pass to the component
 * @returns The rendered component
 */
export function renderTabComponent(tabId: TabId, props?: TabComponentProps): React.ReactElement {
  const Component = getTabComponent(tabId)
  // Type assertion needed because different tabs have different prop requirements
  // Some tabs require onTabChange, others make it optional, others don't use it
  // sessionId is optional and passed through for tabs that need session context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <Component {...(props as any)} />
}
