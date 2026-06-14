import { describe, it, expect } from 'vitest'
import React from 'react'
import type { TabId } from '../../navigation/navigation-config'
import {
  TAB_COMPONENT_MAPPING,
  getTabComponent,
  CONTAINER_PAGE_CONFIGS,
  getContainerPageConfig,
  isContainerPage,
  getContainerTabs,
  renderTabComponent,
} from './container-composition'

describe('container-composition', () => {
  /**
   * All expected TabId values from navigation-config.ts.
   * This list must stay in sync with the TabId type definition.
   */
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
    'todos',
    'memory',
    'observability',
    'connectors',
    'dlq',
    'admin',
  ]

  describe('TAB_COMPONENT_MAPPING', () => {
    it('maps every TabId to exactly one component', () => {
      // Verify all TabIds are mapped
      for (const tabId of ALL_TAB_IDS) {
        expect(tabId in TAB_COMPONENT_MAPPING, `TabId '${tabId}' should be mapped to a component`).toBe(true)
      }

      // Verify no extra tabs in mapping
      const mappedTabs = Object.keys(TAB_COMPONENT_MAPPING)
      expect(mappedTabs.length).toBe(ALL_TAB_IDS.length)
    })

    it('maps each TabId to a valid React component', () => {
      for (const [tabId, Component] of Object.entries(TAB_COMPONENT_MAPPING)) {
        // Check that the component is a function (React component)
        expect(typeof Component, `TabId '${tabId}' should map to a function component`).toBe('function')
      }
    })

    it('preserves all existing feature tab imports', () => {
      // Verify that all expected components are present
      const expectedComponents = [
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
      ]

      for (const tabId of expectedComponents) {
        expect(TAB_COMPONENT_MAPPING[tabId as TabId]).toBeDefined()
      }
    })
  })

  describe('getTabComponent', () => {
    it('returns the correct component for each TabId', () => {
      for (const tabId of ALL_TAB_IDS) {
        const Component = getTabComponent(tabId)
        expect(Component, `getTabComponent('${tabId}') should return a component`).toBeDefined()
        expect(typeof Component).toBe('function')
      }
    })

    it('returns the same component as TAB_COMPONENT_MAPPING', () => {
      for (const tabId of ALL_TAB_IDS) {
        expect(getTabComponent(tabId)).toBe(TAB_COMPONENT_MAPPING[tabId])
      }
    })
  })

  describe('CONTAINER_PAGE_CONFIGS', () => {
    it('defines workspace, operations, and admin containers', () => {
      expect(CONTAINER_PAGE_CONFIGS.workspace).toBeDefined()
      expect(CONTAINER_PAGE_CONFIGS.operations).toBeDefined()
      expect(CONTAINER_PAGE_CONFIGS.admin).toBeDefined()
    })

    it('workspace container has correct tabs', () => {
      const workspaceTabs = CONTAINER_PAGE_CONFIGS.workspace.tabs
      expect(workspaceTabs.sort()).toEqual(
        [
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
        ].sort(),
      )
    })

    it('operations container has correct tabs', () => {
      const operationsTabs = CONTAINER_PAGE_CONFIGS.operations.tabs
      expect(operationsTabs.sort()).toEqual(['agent-monitor', 'skills', 'agents', 'connectors', 'dlq'].sort())
    })

    it('admin container has correct tabs', () => {
      const adminTabs = CONTAINER_PAGE_CONFIGS.admin.tabs
      expect(adminTabs.sort()).toEqual(['settings', 'admin'].sort())
    })

    it('each container has a valid product section', () => {
      for (const [name, config] of Object.entries(CONTAINER_PAGE_CONFIGS)) {
        expect(['workspace', 'operations', 'admin'], `Container '${name}' should have a valid section`).toContain(
          config.section,
        )
      }
    })

    it('each container has a label', () => {
      for (const [name, config] of Object.entries(CONTAINER_PAGE_CONFIGS)) {
        expect(config.label, `Container '${name}' should have a label`).toBeDefined()
        expect(typeof config.label).toBe('string')
        expect(config.label.length).toBeGreaterThan(0)
      }
    })
  })

  describe('getContainerPageConfig', () => {
    it('returns config for workspace section', () => {
      const config = getContainerPageConfig('workspace')
      expect(config).toBeDefined()
      expect(config?.section).toBe('workspace')
    })

    it('returns config for operations section', () => {
      const config = getContainerPageConfig('operations')
      expect(config).toBeDefined()
      expect(config?.section).toBe('operations')
    })

    it('returns config for admin section', () => {
      const config = getContainerPageConfig('admin')
      expect(config).toBeDefined()
      expect(config?.section).toBe('admin')
    })

    it('returns undefined for chat section', () => {
      const config = getContainerPageConfig('chat')
      expect(config).toBeUndefined()
    })
  })

  describe('isContainerPage', () => {
    it('returns true for workspace', () => {
      expect(isContainerPage('workspace')).toBe(true)
    })

    it('returns true for operations', () => {
      expect(isContainerPage('operations')).toBe(true)
    })

    it('returns true for admin', () => {
      expect(isContainerPage('admin')).toBe(true)
    })

    it('returns false for chat', () => {
      expect(isContainerPage('chat')).toBe(false)
    })
  })

  describe('getContainerTabs', () => {
    it('returns tabs for workspace container', () => {
      const tabs = getContainerTabs('workspace')
      expect(tabs.length).toBe(13)
      expect(tabs).toContain('dashboard')
      expect(tabs).toContain('workflows')
      expect(tabs).toContain('approvals')
      expect(tabs).toContain('memory')
      expect(tabs).toContain('observability')
      expect(tabs).toContain('todos')
    })

    it('returns tabs for operations container', () => {
      const tabs = getContainerTabs('operations')
      expect(tabs.length).toBe(5)
      expect(tabs).toContain('agent-monitor')
      expect(tabs).toContain('skills')
      expect(tabs).toContain('agents')
      expect(tabs).toContain('connectors')
      expect(tabs).toContain('dlq')
    })

    it('returns tabs for admin container', () => {
      const tabs = getContainerTabs('admin')
      expect(tabs.length).toBe(2)
      expect(tabs).toContain('settings')
      expect(tabs).toContain('admin')
    })

    it('returns empty array for chat section', () => {
      const tabs = getContainerTabs('chat')
      expect(tabs).toEqual([])
    })
  })

  describe('renderTabComponent', () => {
    it('renders a valid React element for each TabId', () => {
      for (const tabId of ALL_TAB_IDS) {
        const element = renderTabComponent(tabId)
        expect(React.isValidElement(element), `renderTabComponent('${tabId}') should return a valid React element`).toBe(
          true,
        )
      }
    })

    it('passes props to the rendered component', () => {
      const mockOnTabChange = (tab: TabId) => {
        console.log(tab)
      }
      const element = renderTabComponent('dashboard', { onTabChange: mockOnTabChange })
      expect(React.isValidElement(element)).toBe(true)
    })
  })

  describe('coverage verification', () => {
    it('ensures no legacy tab is unmapped', () => {
      const unmappedTabs = ALL_TAB_IDS.filter((tabId) => !(tabId in TAB_COMPONENT_MAPPING))

      expect(unmappedTabs, `No TabId should be unmapped. Unmapped: ${unmappedTabs.join(', ')}`).toEqual([])
    })

    it('ensures each TabId maps to exactly one component', () => {
      const tabToComponent = new Map<TabId, TabComponent>()

      for (const tabId of ALL_TAB_IDS) {
        const Component = TAB_COMPONENT_MAPPING[tabId]
        expect(Component, `TabId '${tabId}' must have a component`).toBeDefined()
        tabToComponent.set(tabId, Component)
      }

      // Verify each tab appears exactly once
      const allComponents = Object.values(TAB_COMPONENT_MAPPING)
      expect(allComponents.length).toBe(ALL_TAB_IDS.length)
    })

    it('ensures all container tabs are renderable', () => {
      const containerTabs = [
        ...CONTAINER_PAGE_CONFIGS.workspace.tabs,
        ...CONTAINER_PAGE_CONFIGS.operations.tabs,
        ...CONTAINER_PAGE_CONFIGS.admin.tabs,
      ]

      for (const tabId of containerTabs) {
        const Component = getTabComponent(tabId)
        expect(Component, `Container tab '${tabId}' must be renderable`).toBeDefined()
        expect(typeof Component).toBe('function')
      }
    })

    it('ensures container tabs cover all non-chat tabs', () => {
      const containerTabs = new Set<TabId>([
        ...CONTAINER_PAGE_CONFIGS.workspace.tabs,
        ...CONTAINER_PAGE_CONFIGS.operations.tabs,
        ...CONTAINER_PAGE_CONFIGS.admin.tabs,
      ])

      const nonChatTabs = ALL_TAB_IDS.filter((tabId) => tabId !== 'session-console')

      for (const tabId of nonChatTabs) {
        expect(
          containerTabs.has(tabId),
          `TabId '${tabId}' should be in a container (workspace, operations, or admin)`,
        ).toBe(true)
      }
    })
  })

  describe('composition integrity', () => {
    it('ensures workspace composition matches product navigation', () => {
      const workspaceTabs = getContainerTabs('workspace')
      // These tabs should be in workspace according to product-navigation.ts
      const expectedWorkspaceTabs: TabId[] = [
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
      ]
      expect(workspaceTabs.sort()).toEqual(expectedWorkspaceTabs.sort())
    })

    it('ensures operations composition matches product navigation', () => {
      const operationsTabs = getContainerTabs('operations')
      const expectedOperationsTabs: TabId[] = ['agent-monitor', 'skills', 'agents', 'connectors', 'dlq']
      expect(operationsTabs.sort()).toEqual(expectedOperationsTabs.sort())
    })

    it('ensures admin composition matches product navigation', () => {
      const adminTabs = getContainerTabs('admin')
      const expectedAdminTabs: TabId[] = ['settings', 'admin']
      expect(adminTabs.sort()).toEqual(expectedAdminTabs.sort())
    })
  })
})
