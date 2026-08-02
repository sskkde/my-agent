import { describe, it, expect } from 'vitest'
import {
  MODAL_DESTINATIONS,
  MODAL_DESTINATION_MAP,
  MODAL_SETTINGS_CATEGORIES,
  getModalDestination,
  getModalComponent,
  isValidModalDestination,
  type ModalDestination,
} from './modal-destination-registry'
import { TAB_COMPONENT_MAPPING } from '../common/container-composition'
import type { TabId } from '../../navigation/navigation-config'
import SettingsTab from './SettingsTab'
import AdminTab from '../admin/AdminTab'
import SessionsTab from '../sessions/SessionsTab'
import ApprovalsTab from '../approvals/ApprovalsTab'
import TodosTab from '../todos/TodosTab'
import AgentsTab from '../agents/AgentsTab'
import GeneralTab from './GeneralTab'
import AppearanceTab from './AppearanceTab'
import ProviderTab from './ProviderTab'
import AgentTab from './AgentTab'

const ALL_TAB_IDS: TabId[] = [
  'dashboard',
  'session-console',
  'agent-monitor',
  'status',
  'sessions',
  'usage',
  'logs-debug',
  'channels',
  'instances',
  'skills',
  'agents',
  'settings',
  'workflows',
  'approvals',
  'triggers',
  'memory',
  'observability',
  'connectors',
  'dlq',
  'admin',
  'todos',
]

const NON_CHAT_TAB_IDS = ALL_TAB_IDS.filter((id) => id !== 'session-console')

const SETTINGS_CATEGORIES: ModalDestination[] = [
  'settings-general',
  'settings-appearance',
  'settings-provider',
  'settings-agent',
]

describe('modal destination registry', () => {
  it('resolves every non-Chat TabId to exactly one modal destination', () => {
    for (const tabId of NON_CHAT_TAB_IDS) {
      expect(MODAL_DESTINATIONS.filter((d) => d === tabId)).toHaveLength(1)
      const entry = getModalDestination(tabId)
      expect(entry).not.toBeNull()
      expect(entry?.id).toBe(tabId)
      expect(getModalComponent(tabId)).toBe(TAB_COMPONENT_MAPPING[tabId])
    }
  })

  it('keeps session-console out of the modal registry (Chat navigation only)', () => {
    expect(MODAL_DESTINATIONS).not.toContain('session-console')
    expect(getModalDestination('session-console')).toBeNull()
    expect(isValidModalDestination('session-console')).toBe(false)
  })

  it('maps legacy settings explicitly to SettingsTab (never aliased to General)', () => {
    const entry = getModalDestination('settings')
    expect(entry).not.toBeNull()
    expect(entry?.isSettingsCategory).toBe(false)
    expect(getModalComponent('settings')).toBe(SettingsTab)
    expect(TAB_COMPONENT_MAPPING['settings']).toBe(SettingsTab)
    expect(getModalComponent('settings-general')).not.toBe(SettingsTab)
  })

  it('resolves all four settings categories to their components', () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(MODAL_DESTINATIONS.filter((d) => d === category)).toHaveLength(1)
      const entry = getModalDestination(category)
      expect(entry).not.toBeNull()
      expect(entry?.isSettingsCategory).toBe(true)
    }
    expect(getModalComponent('settings-general')).toBe(GeneralTab)
    expect(getModalComponent('settings-appearance')).toBe(AppearanceTab)
    expect(getModalComponent('settings-provider')).toBe(ProviderTab)
    expect(getModalComponent('settings-agent')).toBe(AgentTab)
  })

  it('makes all five route-only destinations reachable (omitted by NAV_FUNCTION_GROUPS)', () => {
    for (const tabId of ['sessions', 'approvals', 'todos', 'agents', 'admin'] as const) {
      expect(getModalDestination(tabId)).not.toBeNull()
    }
    expect(getModalComponent('sessions')).toBe(SessionsTab)
    expect(getModalComponent('approvals')).toBe(ApprovalsTab)
    expect(getModalComponent('todos')).toBe(TodosTab)
    expect(getModalComponent('agents')).toBe(AgentsTab)
    expect(getModalComponent('admin')).toBe(AdminTab)
  })

  it('rejects unknown ids without resolving an unrelated tab', () => {
    for (const unknown of ['not-a-tab', '', 'settings-general-extra', 'session-console-2', 'admin-extra']) {
      expect(isValidModalDestination(unknown)).toBe(false)
      expect(getModalDestination(unknown)).toBeNull()
    }
  })

  it('has no duplicate destinations', () => {
    expect(new Set(MODAL_DESTINATIONS).size).toBe(MODAL_DESTINATIONS.length)
  })

  it('covers every composable id exactly once (TabIds + settings categories)', () => {
    expect(MODAL_DESTINATIONS.length).toBe(NON_CHAT_TAB_IDS.length + SETTINGS_CATEGORIES.length)
    expect(MODAL_SETTINGS_CATEGORIES.sort()).toEqual([...SETTINGS_CATEGORIES].sort())
    expect(Object.keys(MODAL_DESTINATION_MAP).sort()).toEqual(
      [...NON_CHAT_TAB_IDS, ...SETTINGS_CATEGORIES].sort(),
    )
  })
})
