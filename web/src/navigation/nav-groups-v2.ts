/**
 * Nav Groups V2 - function-domain grouping for the unified FloatingSettingsMenu.
 *
 * Replaces the legacy 4-section (chat/workspace/operations/admin) split with
 * 4 function-domain groups, excluding items already provided by the Chat layout:
 *   - session-console (Chat itself)
 *   - sessions (ChatSessionList sidebar)
 *   - settings (FloatingSettingsMenu settings tab)
 *   - agents (SubagentConfig in settings)
 *   - todos (TodoWorkPlanCard in right panel)
 *   - approvals (in-chat approval popup)
 *   - admin (overlaps settings)
 */

import type { TabId, NavItem } from './navigation-config'
import { getNavItemById } from './navigation-config'

export interface NavFunctionGroup {
  id: string
  label: string
  iconKey: string
  items: NavItem[]
}

function buildGroup(
  id: string,
  label: string,
  iconKey: string,
  tabIds: TabId[],
): NavFunctionGroup {
  const items = tabIds
    .map((t) => getNavItemById(t))
    .filter((item): item is NavItem => item !== undefined)
  return { id, label, iconKey, items }
}

export const NAV_FUNCTION_GROUPS: NavFunctionGroup[] = [
  buildGroup('monitor', '监控运维', 'activity', [
    'dashboard',
    'status',
    'agent-monitor',
    'observability',
    'logs-debug',
  ]),
  buildGroup('resource', '资源管理', 'database', ['usage', 'memory', 'instances']),
  buildGroup('automation', '自动化', 'gitBranch', ['workflows', 'triggers', 'channels']),
  buildGroup('extension', '扩展集成', 'plug', ['skills', 'connectors', 'dlq']),
]
