import { describe, it, expect } from 'vitest'
import type { TabId } from '../navigation/navigation-config'
import type { ProductSection } from '../navigation/product-navigation'
import { ROUTES } from './route-constants'
import { VALID_TABS, DEFAULT_TABS } from './route-mapping'
import {
  ROUTE_CONFIGS,
  getRouteConfig,
  getRouteConfigsBySection,
  validateRouteParam,
  getValidatedRouteParam,
  getRouteConfigSummary,
  verifyRouteConfigCoverage,
  type RouteConfig,
  type RouteMetadata,
} from './route-config'

describe('route-config', () => {
  describe('ROUTE_CONFIGS', () => {
    it('defines configurations for all routes', () => {
      expect(ROUTE_CONFIGS.root).toBeDefined()
      expect(ROUTE_CONFIGS.chat).toBeDefined()
      expect(ROUTE_CONFIGS.chatSession).toBeDefined()
      expect(ROUTE_CONFIGS.workspace).toBeDefined()
      expect(ROUTE_CONFIGS.operations).toBeDefined()
      expect(ROUTE_CONFIGS.admin).toBeDefined()
    })

    it('maps each config to correct path', () => {
      expect(ROUTE_CONFIGS.root.path).toBe(ROUTES.ROOT)
      expect(ROUTE_CONFIGS.chat.path).toBe(ROUTES.CHAT)
      expect(ROUTE_CONFIGS.chatSession.path).toBe(ROUTES.CHAT_SESSION)
      expect(ROUTE_CONFIGS.workspace.path).toBe(ROUTES.WORKSPACE)
      expect(ROUTE_CONFIGS.operations.path).toBe(ROUTES.OPERATIONS)
      expect(ROUTE_CONFIGS.admin.path).toBe(ROUTES.ADMIN)
    })

    it('provides metadata for each route', () => {
      Object.values(ROUTE_CONFIGS).forEach(config => {
        expect(config.metadata.section).toBeDefined()
        expect(config.metadata.label).toBeDefined()
        expect(config.metadata.hasTabParam).toBeDefined()
        expect(config.metadata.hasSessionParam).toBeDefined()
        expect(config.metadata.description).toBeDefined()
      })
    })

    it('provides getValidatedTab for each route', () => {
      Object.values(ROUTE_CONFIGS).forEach(config => {
        expect(typeof config.getValidatedTab).toBe('function')
      })
    })
  })

  describe('Route metadata', () => {
    it('root route has chat section metadata', () => {
      const config = ROUTE_CONFIGS.root
      expect(config.metadata.section).toBe('chat')
      expect(config.metadata.hasTabParam).toBe(false)
      expect(config.metadata.hasSessionParam).toBe(false)
      expect(config.metadata.defaultTab).toBe('session-console')
    })

    it('chat routes have chat section metadata', () => {
      const chatConfig = ROUTE_CONFIGS.chat
      const chatSessionConfig = ROUTE_CONFIGS.chatSession

      expect(chatConfig.metadata.section).toBe('chat')
      expect(chatConfig.metadata.hasTabParam).toBe(false)
      expect(chatConfig.metadata.hasSessionParam).toBe(false)

      expect(chatSessionConfig.metadata.section).toBe('chat')
      expect(chatSessionConfig.metadata.hasTabParam).toBe(false)
      expect(chatSessionConfig.metadata.hasSessionParam).toBe(true)
    })

    it('workspace route has workspace section metadata with tab param', () => {
      const config = ROUTE_CONFIGS.workspace
      expect(config.metadata.section).toBe('workspace')
      expect(config.metadata.hasTabParam).toBe(true)
      expect(config.metadata.hasSessionParam).toBe(false)
      expect(config.metadata.defaultTab).toBe('dashboard')
    })

    it('operations route has operations section metadata with tab param', () => {
      const config = ROUTE_CONFIGS.operations
      expect(config.metadata.section).toBe('operations')
      expect(config.metadata.hasTabParam).toBe(true)
      expect(config.metadata.hasSessionParam).toBe(false)
      expect(config.metadata.defaultTab).toBe('agent-monitor')
    })

    it('admin route has admin section metadata with tab param', () => {
      const config = ROUTE_CONFIGS.admin
      expect(config.metadata.section).toBe('admin')
      expect(config.metadata.hasTabParam).toBe(true)
      expect(config.metadata.hasSessionParam).toBe(false)
      expect(config.metadata.defaultTab).toBe('settings')
    })
  })

  describe('Route validation', () => {
    describe('workspace route', () => {
      it('validates correct workspace tabs', () => {
        const config = ROUTE_CONFIGS.workspace
        expect(config.validateTab).toBeDefined()
        
        VALID_TABS.workspace.forEach(tabId => {
          expect(config.validateTab!(tabId)).toBe(true)
        })
      })

      it('rejects invalid workspace tabs', () => {
        const config = ROUTE_CONFIGS.workspace
        expect(config.validateTab!('session-console')).toBe(false)
        expect(config.validateTab!('agent-monitor')).toBe(false)
        expect(config.validateTab!('settings')).toBe(false)
        expect(config.validateTab!('invalid-tab')).toBe(false)
      })

      it('returns safe default for invalid tabs', () => {
        const config = ROUTE_CONFIGS.workspace
        expect(config.getValidatedTab(undefined)).toBe('dashboard')
        expect(config.getValidatedTab('invalid-tab')).toBe('dashboard')
        expect(config.getValidatedTab('session-console')).toBe('dashboard')
        expect(config.getValidatedTab('dashboard')).toBe('dashboard')
      })
    })

    describe('operations route', () => {
      it('validates correct operations tabs', () => {
        const config = ROUTE_CONFIGS.operations
        expect(config.validateTab).toBeDefined()
        
        VALID_TABS.operations.forEach(tabId => {
          expect(config.validateTab!(tabId)).toBe(true)
        })
      })

      it('rejects invalid operations tabs', () => {
        const config = ROUTE_CONFIGS.operations
        expect(config.validateTab!('dashboard')).toBe(false)
        expect(config.validateTab!('session-console')).toBe(false)
        expect(config.validateTab!('invalid-tab')).toBe(false)
      })

      it('returns safe default for invalid tabs', () => {
        const config = ROUTE_CONFIGS.operations
        expect(config.getValidatedTab(undefined)).toBe('agent-monitor')
        expect(config.getValidatedTab('invalid-tab')).toBe('agent-monitor')
        expect(config.getValidatedTab('dashboard')).toBe('agent-monitor')
        expect(config.getValidatedTab('agent-monitor')).toBe('agent-monitor')
      })
    })

    describe('admin route', () => {
      it('validates correct admin tabs', () => {
        const config = ROUTE_CONFIGS.admin
        expect(config.validateTab).toBeDefined()
        
        VALID_TABS.admin.forEach(tabId => {
          expect(config.validateTab!(tabId)).toBe(true)
        })
      })

      it('rejects invalid admin tabs', () => {
        const config = ROUTE_CONFIGS.admin
        expect(config.validateTab!('dashboard')).toBe(false)
        expect(config.validateTab!('session-console')).toBe(false)
        expect(config.validateTab!('invalid-tab')).toBe(false)
      })

      it('returns safe default for invalid tabs', () => {
        const config = ROUTE_CONFIGS.admin
        expect(config.getValidatedTab(undefined)).toBe('settings')
        expect(config.getValidatedTab('invalid-tab')).toBe('settings')
        expect(config.getValidatedTab('dashboard')).toBe('settings')
        expect(config.getValidatedTab('settings')).toBe('settings')
      })
    })

    describe('chat routes', () => {
      it('always returns session-console tab', () => {
        expect(ROUTE_CONFIGS.chat.getValidatedTab(undefined)).toBe('session-console')
        expect(ROUTE_CONFIGS.chatSession.getValidatedTab(undefined)).toBe('session-console')
        expect(ROUTE_CONFIGS.root.getValidatedTab(undefined)).toBe('session-console')
      })
    })
  })

  describe('getRouteConfig', () => {
    it('returns config for valid path', () => {
      expect(getRouteConfig(ROUTES.ROOT)).toBe(ROUTE_CONFIGS.root)
      expect(getRouteConfig(ROUTES.CHAT)).toBe(ROUTE_CONFIGS.chat)
      expect(getRouteConfig(ROUTES.CHAT_SESSION)).toBe(ROUTE_CONFIGS.chatSession)
      expect(getRouteConfig(ROUTES.WORKSPACE)).toBe(ROUTE_CONFIGS.workspace)
      expect(getRouteConfig(ROUTES.OPERATIONS)).toBe(ROUTE_CONFIGS.operations)
      expect(getRouteConfig(ROUTES.ADMIN)).toBe(ROUTE_CONFIGS.admin)
    })

    it('returns undefined for invalid path', () => {
      expect(getRouteConfig('/invalid')).toBeUndefined()
      expect(getRouteConfig('/nonexistent')).toBeUndefined()
    })
  })

  describe('getRouteConfigsBySection', () => {
    it('returns configs for chat section', () => {
      const configs = getRouteConfigsBySection('chat')
      expect(configs.length).toBeGreaterThan(0)
      expect(configs.every(c => c.metadata.section === 'chat')).toBe(true)
    })

    it('returns configs for workspace section', () => {
      const configs = getRouteConfigsBySection('workspace')
      expect(configs.length).toBeGreaterThan(0)
      expect(configs.every(c => c.metadata.section === 'workspace')).toBe(true)
    })

    it('returns configs for operations section', () => {
      const configs = getRouteConfigsBySection('operations')
      expect(configs.length).toBeGreaterThan(0)
      expect(configs.every(c => c.metadata.section === 'operations')).toBe(true)
    })

    it('returns configs for admin section', () => {
      const configs = getRouteConfigsBySection('admin')
      expect(configs.length).toBeGreaterThan(0)
      expect(configs.every(c => c.metadata.section === 'admin')).toBe(true)
    })
  })

  describe('validateRouteParam', () => {
    it('validates tabId for workspace route', () => {
      expect(validateRouteParam(ROUTES.WORKSPACE, 'tabId', 'dashboard')).toBe(true)
      expect(validateRouteParam(ROUTES.WORKSPACE, 'tabId', 'sessions')).toBe(true)
      expect(validateRouteParam(ROUTES.WORKSPACE, 'tabId', 'invalid')).toBe(false)
      expect(validateRouteParam(ROUTES.WORKSPACE, 'tabId', 'session-console')).toBe(false)
    })

    it('validates tabId for operations route', () => {
      expect(validateRouteParam(ROUTES.OPERATIONS, 'tabId', 'agent-monitor')).toBe(true)
      expect(validateRouteParam(ROUTES.OPERATIONS, 'tabId', 'skills')).toBe(true)
      expect(validateRouteParam(ROUTES.OPERATIONS, 'tabId', 'invalid')).toBe(false)
      expect(validateRouteParam(ROUTES.OPERATIONS, 'tabId', 'dashboard')).toBe(false)
    })

    it('validates tabId for admin route', () => {
      expect(validateRouteParam(ROUTES.ADMIN, 'tabId', 'settings')).toBe(true)
      expect(validateRouteParam(ROUTES.ADMIN, 'tabId', 'admin')).toBe(true)
      expect(validateRouteParam(ROUTES.ADMIN, 'tabId', 'invalid')).toBe(false)
      expect(validateRouteParam(ROUTES.ADMIN, 'tabId', 'dashboard')).toBe(false)
    })

    it('validates sessionId for chat session route', () => {
      expect(validateRouteParam(ROUTES.CHAT_SESSION, 'sessionId', 'abc123')).toBe(true)
      expect(validateRouteParam(ROUTES.CHAT_SESSION, 'sessionId', 'session-id')).toBe(true)
      expect(validateRouteParam(ROUTES.CHAT_SESSION, 'sessionId', '')).toBe(false)
    })

    it('returns false for invalid route path', () => {
      expect(validateRouteParam('/invalid', 'tabId', 'dashboard')).toBe(false)
    })

    it('returns false for routes without tab validation', () => {
      expect(validateRouteParam(ROUTES.CHAT, 'tabId', 'any')).toBe(false)
      expect(validateRouteParam(ROUTES.ROOT, 'tabId', 'any')).toBe(false)
    })
  })

  describe('getValidatedRouteParam', () => {
    it('returns validated tab for workspace route', () => {
      expect(getValidatedRouteParam(ROUTES.WORKSPACE, 'tabId', 'dashboard')).toBe('dashboard')
      expect(getValidatedRouteParam(ROUTES.WORKSPACE, 'tabId', 'invalid')).toBe('dashboard')
      expect(getValidatedRouteParam(ROUTES.WORKSPACE, 'tabId', undefined)).toBe('dashboard')
    })

    it('returns validated tab for operations route', () => {
      expect(getValidatedRouteParam(ROUTES.OPERATIONS, 'tabId', 'agent-monitor')).toBe('agent-monitor')
      expect(getValidatedRouteParam(ROUTES.OPERATIONS, 'tabId', 'invalid')).toBe('agent-monitor')
      expect(getValidatedRouteParam(ROUTES.OPERATIONS, 'tabId', undefined)).toBe('agent-monitor')
    })

    it('returns validated tab for admin route', () => {
      expect(getValidatedRouteParam(ROUTES.ADMIN, 'tabId', 'settings')).toBe('settings')
      expect(getValidatedRouteParam(ROUTES.ADMIN, 'tabId', 'invalid')).toBe('settings')
      expect(getValidatedRouteParam(ROUTES.ADMIN, 'tabId', undefined)).toBe('settings')
    })

    it('returns default for invalid route path', () => {
      expect(getValidatedRouteParam('/invalid', 'tabId', 'dashboard')).toBe('session-console')
    })
  })

  describe('getRouteConfigSummary', () => {
    it('provides summary of all route configs', () => {
      const summary = getRouteConfigSummary()
      
      expect(summary.totalRoutes).toBeGreaterThan(0)
      expect(summary.sections).toContain('chat')
      expect(summary.sections).toContain('workspace')
      expect(summary.sections).toContain('operations')
      expect(summary.sections).toContain('admin')
      expect(summary.routesWithTabParam).toBeGreaterThan(0)
      expect(summary.routesWithSessionParam).toBeGreaterThan(0)
    })

    it('counts routes correctly', () => {
      const summary = getRouteConfigSummary()
      
      expect(summary.totalRoutes).toBe(6) // root, chat, chatSession, workspace, operations, admin
      expect(summary.routesWithTabParam).toBe(3) // workspace, operations, admin
      expect(summary.routesWithSessionParam).toBe(1) // chatSession
    })

    it('counts routes by section correctly', () => {
      const summary = getRouteConfigSummary()
      
      expect(summary.routesBySection.chat).toBe(3) // root, chat, chatSession
      expect(summary.routesBySection.workspace).toBe(1) // workspace
      expect(summary.routesBySection.operations).toBe(1) // operations
      expect(summary.routesBySection.admin).toBe(1) // admin
    })
  })

  describe('verifyRouteConfigCoverage', () => {
    it('verifies all product sections are covered', () => {
      expect(verifyRouteConfigCoverage()).toBe(true)
    })

    it('returns true when all sections have routes', () => {
      const summary = getRouteConfigSummary()
      const allSections: ProductSection[] = ['chat', 'workspace', 'operations', 'admin']
      
      allSections.forEach(section => {
        expect(summary.routesBySection[section]).toBeGreaterThan(0)
      })
    })
  })

  describe('coverage verification', () => {
    it('ensures route configs cover all product sections', () => {
      const sections: ProductSection[] = ['chat', 'workspace', 'operations', 'admin']
      
      sections.forEach(section => {
        const configs = getRouteConfigsBySection(section)
        expect(configs.length, `Section ${section} should have route configs`).toBeGreaterThan(0)
      })
    })

    it('ensures all valid tabs are covered by route configs', () => {
      // Workspace tabs
      VALID_TABS.workspace.forEach(tabId => {
        const config = ROUTE_CONFIGS.workspace
        expect(config.getValidatedTab(tabId)).toBe(tabId)
      })

      // Operations tabs
      VALID_TABS.operations.forEach(tabId => {
        const config = ROUTE_CONFIGS.operations
        expect(config.getValidatedTab(tabId)).toBe(tabId)
      })

      // Admin tabs
      VALID_TABS.admin.forEach(tabId => {
        const config = ROUTE_CONFIGS.admin
        expect(config.getValidatedTab(tabId)).toBe(tabId)
      })
    })

    it('ensures invalid tabs return safe defaults', () => {
      const invalidTabs = ['invalid', 'nonexistent', 'bad-tab', '']
      
      // Workspace
      invalidTabs.forEach(tab => {
        expect(ROUTE_CONFIGS.workspace.getValidatedTab(tab)).toBe('dashboard')
      })

      // Operations
      invalidTabs.forEach(tab => {
        expect(ROUTE_CONFIGS.operations.getValidatedTab(tab)).toBe('agent-monitor')
      })

      // Admin
      invalidTabs.forEach(tab => {
        expect(ROUTE_CONFIGS.admin.getValidatedTab(tab)).toBe('settings')
      })
    })
  })
})
