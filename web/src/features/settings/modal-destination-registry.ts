/**
 * Modal Destination Registry
 *
 * The exhaustive, typed contract for every destination the app-level secondary
 * modal can open. Every non-Chat `TabId` (including the route-only destinations
 * omitted by `NAV_FUNCTION_GROUPS`: sessions, approvals, todos, agents, admin)
 * plus the four settings categories resolves to exactly one entry.
 *
 * Component resolution delegates to `TAB_COMPONENT_MAPPING` in
 * `container-composition.tsx` — the single source of truth — so this file never
 * imports feature components directly.
 */

import type { TabId, SettingsCategoryId } from '../../navigation/navigation-config'
import { TAB_COMPONENT_MAPPING, type TabComponent } from '../common/container-composition'

/**
 * Every destination the secondary modal can open: all `TabId`s except
 * `session-console` (Chat navigation only) plus the four settings categories.
 */
export type ModalDestination = Exclude<TabId, 'session-console'> | SettingsCategoryId

/**
 * Grouping key used by the modal navigation (function-domain groups from
 * `NAV_FUNCTION_GROUPS` plus explicit groups for the previously omitted
 * route-only destinations and the settings surface).
 */
export type ModalDestinationGroup =
  | 'monitor'
  | 'resource'
  | 'automation'
  | 'extension'
  | 'sessions'
  | 'approvals'
  | 'todos'
  | 'agents'
  | 'admin'
  | 'settings'
  | 'settings-categories'

/**
 * One registry entry: display metadata plus the stable test id and group.
 */
export interface ModalDestinationEntry {
  id: ModalDestination
  label: string
  iconKey: string
  group: ModalDestinationGroup
  testId: string
  /**
   * True for the four settings-* categories; false for every `TabId`
   * destination, including the legacy `settings` overview (which stays a
   * distinct destination and is never aliased to `settings-general`).
   */
  isSettingsCategory: boolean
}

/**
 * The exhaustive registry. Typed as `Record<ModalDestination, ...>` so the
 * compiler rejects a missing, extra, or duplicated destination.
 */
export const MODAL_DESTINATION_MAP: Record<ModalDestination, ModalDestinationEntry> = {
  // Function-domain groups (mirrors NAV_FUNCTION_GROUPS)
  dashboard: { id: 'dashboard', label: '概览', iconKey: 'layoutDashboard', group: 'monitor', testId: 'tab-dashboard', isSettingsCategory: false },
  status: { id: 'status', label: '状态', iconKey: 'info', group: 'monitor', testId: 'tab-status', isSettingsCategory: false },
  'agent-monitor': { id: 'agent-monitor', label: '监控', iconKey: 'activity', group: 'monitor', testId: 'tab-agent-monitor', isSettingsCategory: false },
  observability: { id: 'observability', label: '可观测', iconKey: 'eye', group: 'monitor', testId: 'tab-observability', isSettingsCategory: false },
  'logs-debug': { id: 'logs-debug', label: '日志调试', iconKey: 'fileText', group: 'monitor', testId: 'tab-logs-debug', isSettingsCategory: false },
  usage: { id: 'usage', label: '用量统计', iconKey: 'barChart', group: 'resource', testId: 'tab-usage', isSettingsCategory: false },
  memory: { id: 'memory', label: '记忆', iconKey: 'database', group: 'resource', testId: 'tab-memory', isSettingsCategory: false },
  instances: { id: 'instances', label: '实例', iconKey: 'server', group: 'resource', testId: 'tab-instances', isSettingsCategory: false },
  workflows: { id: 'workflows', label: '工作流', iconKey: 'gitBranch', group: 'automation', testId: 'tab-workflows', isSettingsCategory: false },
  triggers: { id: 'triggers', label: '触发器', iconKey: 'zap', group: 'automation', testId: 'tab-triggers', isSettingsCategory: false },
  channels: { id: 'channels', label: '通道', iconKey: 'radio', group: 'automation', testId: 'tab-channels', isSettingsCategory: false },
  skills: { id: 'skills', label: '技能', iconKey: 'zap', group: 'extension', testId: 'tab-skills', isSettingsCategory: false },
  connectors: { id: 'connectors', label: '连接器', iconKey: 'plug', group: 'extension', testId: 'tab-connectors', isSettingsCategory: false },
  dlq: { id: 'dlq', label: '死信队列', iconKey: 'alertTriangle', group: 'extension', testId: 'tab-dlq', isSettingsCategory: false },

  // Route-only destinations omitted by NAV_FUNCTION_GROUPS (each gets its own group)
  sessions: { id: 'sessions', label: '会话列表', iconKey: 'list', group: 'sessions', testId: 'tab-sessions', isSettingsCategory: false },
  approvals: { id: 'approvals', label: '审批', iconKey: 'checkCircle', group: 'approvals', testId: 'tab-approvals', isSettingsCategory: false },
  todos: { id: 'todos', label: '待办', iconKey: 'checkSquare', group: 'todos', testId: 'tab-todos', isSettingsCategory: false },
  agents: { id: 'agents', label: '代理配置', iconKey: 'settings', group: 'agents', testId: 'tab-agents', isSettingsCategory: false },
  admin: { id: 'admin', label: '管理', iconKey: 'shield', group: 'admin', testId: 'tab-admin', isSettingsCategory: false },

  // Legacy settings destination: the System Settings overview (SettingsTab),
  // explicitly distinct from the settings-general category.
  settings: { id: 'settings', label: '设置', iconKey: 'settings', group: 'settings', testId: 'tab-settings', isSettingsCategory: false },

  // Settings categories (modal-only, no routed page)
  'settings-general': { id: 'settings-general', label: '通用', iconKey: 'settings', group: 'settings-categories', testId: 'settings-tab-settings-general', isSettingsCategory: true },
  'settings-appearance': { id: 'settings-appearance', label: '外观', iconKey: 'info', group: 'settings-categories', testId: 'settings-tab-settings-appearance', isSettingsCategory: true },
  'settings-provider': { id: 'settings-provider', label: 'Provider', iconKey: 'server', group: 'settings-categories', testId: 'settings-tab-settings-provider', isSettingsCategory: true },
  'settings-agent': { id: 'settings-agent', label: '代理', iconKey: 'activity', group: 'settings-categories', testId: 'settings-tab-settings-agent', isSettingsCategory: true },
}

/**
 * All modal destinations in map-insertion order (no duplicates).
 */
export const MODAL_DESTINATIONS: readonly ModalDestination[] = Object.keys(
  MODAL_DESTINATION_MAP,
) as ModalDestination[]

/**
 * The four settings categories only (never includes the legacy `settings` overview).
 */
export const MODAL_SETTINGS_CATEGORIES: readonly SettingsCategoryId[] = [
  'settings-general',
  'settings-appearance',
  'settings-provider',
  'settings-agent',
]

/**
 * Type guard: true only for registered modal destinations. Unknown ids
 * (including `session-console`) never resolve, so callers can never open an
 * unrelated tab.
 */
export function isValidModalDestination(id: string): id is ModalDestination {
  return id in MODAL_DESTINATION_MAP
}

/**
 * Look up a registry entry by id; returns null for unknown ids.
 */
export function getModalDestination(id: string): ModalDestinationEntry | null {
  return isValidModalDestination(id) ? MODAL_DESTINATION_MAP[id] : null
}

/**
 * Resolve the feature component for a destination from the single composition
 * source of truth (`TAB_COMPONENT_MAPPING`).
 */
export function getModalComponent(destination: ModalDestination): TabComponent {
  return TAB_COMPONENT_MAPPING[destination]
}
