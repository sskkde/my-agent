import { describe, it, expect } from 'vitest'
import type { TabId } from './navigation-config'
import {
  PRODUCT_NAV_MAPPING,
  PRODUCT_SECTIONS,
  PRODUCT_SECTION_LABELS,
  getProductSection,
  getAllTabsForSection,
  getTabsBySection,
} from './product-navigation'

describe('product-navigation', () => {
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
    'memory',
    'observability',
    'connectors',
    'dlq',
    'admin',
  ]

  describe('PRODUCT_NAV_MAPPING', () => {
    it('maps every TabId to exactly one section', () => {
      // Verify all TabIds are mapped
      for (const tabId of ALL_TAB_IDS) {
        expect(tabId in PRODUCT_NAV_MAPPING, `TabId '${tabId}' should be mapped`).toBe(true)
      }

      // Verify no extra tabs in mapping
      const mappedTabs = Object.keys(PRODUCT_NAV_MAPPING)
      expect(mappedTabs.length).toBe(ALL_TAB_IDS.length)
    })

    it('only contains valid product sections', () => {
      const validSections: Set<string> = new Set(PRODUCT_SECTIONS)

      for (const [tabId, section] of Object.entries(PRODUCT_NAV_MAPPING)) {
        expect(validSections.has(section), `TabId '${tabId}' maps to invalid section '${section}'`).toBe(true)
      }
    })
  })

  describe('PRODUCT_SECTIONS', () => {
    it('contains all four product sections', () => {
      expect(PRODUCT_SECTIONS).toContain('chat')
      expect(PRODUCT_SECTIONS).toContain('workspace')
      expect(PRODUCT_SECTIONS).toContain('operations')
      expect(PRODUCT_SECTIONS).toContain('admin')
      expect(PRODUCT_SECTIONS.length).toBe(4)
    })
  })

  describe('PRODUCT_SECTION_LABELS', () => {
    it('has labels for all sections', () => {
      for (const section of PRODUCT_SECTIONS) {
        expect(PRODUCT_SECTION_LABELS[section], `Section '${section}' should have a label`).toBeDefined()
        expect(typeof PRODUCT_SECTION_LABELS[section]).toBe('string')
      }
    })
  })

  describe('getProductSection', () => {
    it('returns correct section for each TabId', () => {
      // Chat section
      expect(getProductSection('session-console')).toBe('chat')

      // Workspace section
      const workspaceTabs: TabId[] = [
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
        'memory',
        'observability',
      ]
      for (const tabId of workspaceTabs) {
        expect(getProductSection(tabId)).toBe('workspace')
      }

      // Operations section
      const operationsTabs: TabId[] = ['agent-monitor', 'skills', 'agents', 'connectors', 'dlq']
      for (const tabId of operationsTabs) {
        expect(getProductSection(tabId)).toBe('operations')
      }

      // Admin section
      const adminTabs: TabId[] = ['settings', 'admin']
      for (const tabId of adminTabs) {
        expect(getProductSection(tabId)).toBe('admin')
      }
    })
  })

  describe('getAllTabsForSection', () => {
    it('returns correct tabs for chat section', () => {
      const tabs = getAllTabsForSection('chat')
      expect(tabs).toEqual(['session-console'])
    })

    it('returns correct tabs for workspace section', () => {
      const tabs = getAllTabsForSection('workspace')
      expect(tabs.sort()).toEqual(
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
          'memory',
          'observability',
        ].sort(),
      )
    })

    it('returns correct tabs for operations section', () => {
      const tabs = getAllTabsForSection('operations')
      expect(tabs.sort()).toEqual(['agent-monitor', 'skills', 'agents', 'connectors', 'dlq'].sort())
    })

    it('returns correct tabs for admin section', () => {
      const tabs = getAllTabsForSection('admin')
      expect(tabs.sort()).toEqual(['settings', 'admin'].sort())
    })

    it('returns arrays that cover all TabIds without overlap', () => {
      const allReturnedTabs = PRODUCT_SECTIONS.flatMap((s) => getAllTabsForSection(s))

      // Check coverage
      expect(allReturnedTabs.length).toBe(ALL_TAB_IDS.length)

      // Check no duplicates
      const uniqueTabs = new Set(allReturnedTabs)
      expect(uniqueTabs.size).toBe(ALL_TAB_IDS.length)

      // Check all tabs present
      for (const tabId of ALL_TAB_IDS) {
        expect(allReturnedTabs).toContain(tabId)
      }
    })
  })

  describe('getTabsBySection', () => {
    it('returns a complete mapping of sections to tabs', () => {
      const mapping = getTabsBySection()

      // All sections present
      expect(mapping.chat).toBeDefined()
      expect(mapping.workspace).toBeDefined()
      expect(mapping.operations).toBeDefined()
      expect(mapping.admin).toBeDefined()

      // Verify counts
      expect(mapping.chat.length).toBe(1)
      expect(mapping.workspace.length).toBe(12)
      expect(mapping.operations.length).toBe(5)
      expect(mapping.admin.length).toBe(2)
    })

    it('returns consistent results with individual functions', () => {
      const mapping = getTabsBySection()

      for (const section of PRODUCT_SECTIONS) {
        expect(mapping[section].sort()).toEqual(getAllTabsForSection(section).sort())
      }
    })
  })

  describe('coverage verification', () => {
    it('ensures no legacy tab is unmapped', () => {
      const unmappedTabs = ALL_TAB_IDS.filter((tabId) => !(tabId in PRODUCT_NAV_MAPPING))

      expect(unmappedTabs, `No TabId should be unmapped. Unmapped: ${unmappedTabs.join(', ')}`).toEqual([])
    })

    it('ensures each TabId maps to exactly one section', () => {
      const tabToSection = new Map<TabId, string>()

      for (const tabId of ALL_TAB_IDS) {
        const section = PRODUCT_NAV_MAPPING[tabId]
        expect(section, `TabId '${tabId}' must have a section`).toBeDefined()
        tabToSection.set(tabId, section)
      }

      // Verify each tab appears exactly once in the grouped structure
      const tabsBySection = getTabsBySection()
      const allGroupedTabs = PRODUCT_SECTIONS.flatMap((s) => tabsBySection[s])

      for (const tabId of ALL_TAB_IDS) {
        const count = allGroupedTabs.filter((t) => t === tabId).length
        expect(count, `TabId '${tabId}' should appear exactly once in grouped structure`).toBe(1)
      }
    })
  })
})
