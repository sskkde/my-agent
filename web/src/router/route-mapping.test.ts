import { describe, it, expect } from 'vitest'
import type { TabId } from '../navigation/navigation-config'
import {
  ROUTES,
  ROUTE_PARAMS,
  buildPath,
} from './route-constants'
import {
  VALID_TABS,
  DEFAULT_TABS,
  isValidTabForSection,
  getDefaultTab,
  validateTabOrFallback,
  routeToNavigation,
  navigationToRoute,
  getSectionDefaultRoute,
  type NavigationState,
} from './route-mapping'

describe('route-constants', () => {
  describe('ROUTES', () => {
    it('defines all required route paths', () => {
      expect(ROUTES.ROOT).toBe('/')
      expect(ROUTES.CHAT).toBe('/chat')
      expect(ROUTES.CHAT_SESSION).toBe('/chat/:sessionId')
      expect(ROUTES.WORKSPACE).toBe('/workspace/:tabId')
      expect(ROUTES.OPERATIONS).toBe('/operations/:tabId')
      expect(ROUTES.ADMIN).toBe('/admin/:tabId')
    })
  })

  describe('ROUTE_PARAMS', () => {
    it('defines parameter names', () => {
      expect(ROUTE_PARAMS.SESSION_ID).toBe('sessionId')
      expect(ROUTE_PARAMS.TAB_ID).toBe('tabId')
    })
  })

  describe('buildPath', () => {
    it('replaces single parameter', () => {
      const result = buildPath('/chat/:sessionId', { sessionId: 'abc123' })
      expect(result).toBe('/chat/abc123')
    })

    it('handles multiple parameters', () => {
      const result = buildPath('/test/:a/:b', { a: 'foo', b: 'bar' })
      expect(result).toBe('/test/foo/bar')
    })

    it('returns original path if no params provided', () => {
      const result = buildPath('/chat', {})
      expect(result).toBe('/chat')
    })

    it('handles special characters in param values', () => {
      const result = buildPath('/chat/:sessionId', { sessionId: 'session-123_abc' })
      expect(result).toBe('/chat/session-123_abc')
    })
  })
})

describe('route-mapping', () => {
  describe('VALID_TABS', () => {
    it('lists all tabs for chat section', () => {
      expect(VALID_TABS.chat).toContain('session-console')
      expect(VALID_TABS.chat.length).toBe(1)
    })

    it('lists all tabs for workspace section', () => {
      const expectedTabs: TabId[] = [
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
      expect(VALID_TABS.workspace.sort()).toEqual(expectedTabs.sort())
    })

    it('lists all tabs for operations section', () => {
      const expectedTabs: TabId[] = ['agent-monitor', 'skills', 'agents', 'connectors', 'dlq']
      expect(VALID_TABS.operations.sort()).toEqual(expectedTabs.sort())
    })

    it('lists all tabs for admin section', () => {
      expect(VALID_TABS.admin.sort()).toEqual(['settings', 'admin'].sort())
    })
  })

  describe('DEFAULT_TABS', () => {
    it('provides default tab for each section', () => {
      expect(DEFAULT_TABS.chat).toBe('session-console')
      expect(DEFAULT_TABS.workspace).toBe('dashboard')
      expect(DEFAULT_TABS.operations).toBe('agent-monitor')
      expect(DEFAULT_TABS.admin).toBe('settings')
    })
  })

  describe('isValidTabForSection', () => {
    it('returns true for valid chat tab', () => {
      expect(isValidTabForSection('session-console', 'chat')).toBe(true)
    })

    it('returns false for invalid chat tab', () => {
      expect(isValidTabForSection('dashboard', 'chat')).toBe(false)
    })

    it('returns true for valid workspace tabs', () => {
      expect(isValidTabForSection('dashboard', 'workspace')).toBe(true)
      expect(isValidTabForSection('sessions', 'workspace')).toBe(true)
      expect(isValidTabForSection('usage', 'workspace')).toBe(true)
    })

    it('returns false for invalid workspace tab', () => {
      expect(isValidTabForSection('session-console', 'workspace')).toBe(false)
      expect(isValidTabForSection('agent-monitor', 'workspace')).toBe(false)
    })

    it('returns true for valid operations tabs', () => {
      expect(isValidTabForSection('agent-monitor', 'operations')).toBe(true)
      expect(isValidTabForSection('skills', 'operations')).toBe(true)
      expect(isValidTabForSection('agents', 'operations')).toBe(true)
    })

    it('returns false for invalid operations tab', () => {
      expect(isValidTabForSection('dashboard', 'operations')).toBe(false)
      expect(isValidTabForSection('session-console', 'operations')).toBe(false)
    })

    it('returns true for valid admin tabs', () => {
      expect(isValidTabForSection('settings', 'admin')).toBe(true)
      expect(isValidTabForSection('admin', 'admin')).toBe(true)
    })

    it('returns false for invalid admin tab', () => {
      expect(isValidTabForSection('dashboard', 'admin')).toBe(false)
      expect(isValidTabForSection('session-console', 'admin')).toBe(false)
    })
  })

  describe('getDefaultTab', () => {
    it('returns correct default for each section', () => {
      expect(getDefaultTab('chat')).toBe('session-console')
      expect(getDefaultTab('workspace')).toBe('dashboard')
      expect(getDefaultTab('operations')).toBe('agent-monitor')
      expect(getDefaultTab('admin')).toBe('settings')
    })
  })

  describe('validateTabOrFallback', () => {
    it('returns valid tab if it belongs to section', () => {
      expect(validateTabOrFallback('dashboard', 'workspace')).toBe('dashboard')
      expect(validateTabOrFallback('agent-monitor', 'operations')).toBe('agent-monitor')
      expect(validateTabOrFallback('settings', 'admin')).toBe('settings')
    })

    it('returns section default if tab is undefined', () => {
      expect(validateTabOrFallback(undefined, 'chat')).toBe('session-console')
      expect(validateTabOrFallback(undefined, 'workspace')).toBe('dashboard')
      expect(validateTabOrFallback(undefined, 'operations')).toBe('agent-monitor')
      expect(validateTabOrFallback(undefined, 'admin')).toBe('settings')
    })

    it('returns section default if tab does not belong to section', () => {
      // Invalid workspace tab
      expect(validateTabOrFallback('session-console', 'workspace')).toBe('dashboard')
      expect(validateTabOrFallback('agent-monitor', 'workspace')).toBe('dashboard')
      
      // Invalid operations tab
      expect(validateTabOrFallback('dashboard', 'operations')).toBe('agent-monitor')
      expect(validateTabOrFallback('session-console', 'operations')).toBe('agent-monitor')
      
      // Invalid admin tab
      expect(validateTabOrFallback('dashboard', 'admin')).toBe('settings')
      expect(validateTabOrFallback('session-console', 'admin')).toBe('settings')
    })

    it('handles completely invalid tab IDs', () => {
      expect(validateTabOrFallback('nonexistent', 'workspace')).toBe('dashboard')
      expect(validateTabOrFallback('invalid-tab', 'operations')).toBe('agent-monitor')
    })
  })

  describe('routeToNavigation', () => {
    describe('valid routes', () => {
      it('maps root path to chat section', () => {
        const result = routeToNavigation('/')
        expect(result).toEqual<NavigationState>({
          tabId: 'session-console',
          section: 'chat',
          sessionId: undefined,
        })
      })

      it('maps /chat to chat section', () => {
        const result = routeToNavigation('/chat')
        expect(result).toEqual<NavigationState>({
          tabId: 'session-console',
          section: 'chat',
          sessionId: undefined,
        })
      })

      it('maps /chat/:sessionId to chat section with session ID', () => {
        const result = routeToNavigation('/chat/abc123')
        expect(result).toEqual<NavigationState>({
          tabId: 'session-console',
          section: 'chat',
          sessionId: 'abc123',
        })
      })

      it('maps /workspace/:tabId to workspace section', () => {
        const result = routeToNavigation('/workspace/dashboard')
        expect(result).toEqual<NavigationState>({
          tabId: 'dashboard',
          section: 'workspace',
          sessionId: undefined,
        })
      })

      it('maps /operations/:tabId to operations section', () => {
        const result = routeToNavigation('/operations/agent-monitor')
        expect(result).toEqual<NavigationState>({
          tabId: 'agent-monitor',
          section: 'operations',
          sessionId: undefined,
        })
      })

      it('maps /admin/:tabId to admin section', () => {
        const result = routeToNavigation('/admin/settings')
        expect(result).toEqual<NavigationState>({
          tabId: 'settings',
          section: 'admin',
          sessionId: undefined,
        })
      })

      it('handles all valid workspace tabs', () => {
        const workspaceTabs = VALID_TABS.workspace
        for (const tabId of workspaceTabs) {
          const result = routeToNavigation(`/workspace/${tabId}`)
          expect(result.tabId).toBe(tabId)
          expect(result.section).toBe('workspace')
        }
      })

      it('handles all valid operations tabs', () => {
        const operationsTabs = VALID_TABS.operations
        for (const tabId of operationsTabs) {
          const result = routeToNavigation(`/operations/${tabId}`)
          expect(result.tabId).toBe(tabId)
          expect(result.section).toBe('operations')
        }
      })

      it('handles all valid admin tabs', () => {
        const adminTabs = VALID_TABS.admin
        for (const tabId of adminTabs) {
          const result = routeToNavigation(`/admin/${tabId}`)
          expect(result.tabId).toBe(tabId)
          expect(result.section).toBe('admin')
        }
      })
    })

    describe('invalid parameters', () => {
      it('returns workspace default for invalid workspace tab ID', () => {
        const result = routeToNavigation('/workspace/invalid-tab')
        expect(result).toEqual<NavigationState>({
          tabId: 'dashboard',
          section: 'workspace',
          sessionId: undefined,
        })
      })

      it('returns operations default for invalid operations tab ID', () => {
        const result = routeToNavigation('/operations/invalid-tab')
        expect(result).toEqual<NavigationState>({
          tabId: 'agent-monitor',
          section: 'operations',
          sessionId: undefined,
        })
      })

      it('returns admin default for invalid admin tab ID', () => {
        const result = routeToNavigation('/admin/invalid-tab')
        expect(result).toEqual<NavigationState>({
          tabId: 'settings',
          section: 'admin',
          sessionId: undefined,
        })
      })

      it('returns chat default for unknown section', () => {
        const result = routeToNavigation('/unknown/path')
        expect(result).toEqual<NavigationState>({
          tabId: 'session-console',
          section: 'chat',
          sessionId: undefined,
        })
      })
    })

    describe('edge cases', () => {
      it('handles trailing slashes', () => {
        expect(routeToNavigation('/chat/')).toEqual<NavigationState>({
          tabId: 'session-console',
          section: 'chat',
          sessionId: undefined,
        })

        expect(routeToNavigation('/workspace/dashboard/')).toEqual<NavigationState>({
          tabId: 'dashboard',
          section: 'workspace',
          sessionId: undefined,
        })
      })

      it('handles empty path as root', () => {
        const result = routeToNavigation('')
        expect(result.section).toBe('chat')
      })

      it('preserves session ID with special characters', () => {
        const result = routeToNavigation('/chat/session-123_abc')
        expect(result.sessionId).toBe('session-123_abc')
      })

      it('handles extra path segments in workspace', () => {
        // Should only use first segment as tabId
        const result = routeToNavigation('/workspace/dashboard/extra')
        expect(result.tabId).toBe('dashboard')
        expect(result.section).toBe('workspace')
      })
    })
  })

  describe('navigationToRoute', () => {
    describe('chat section', () => {
      it('returns /chat for chat tab without session ID', () => {
        const result = navigationToRoute('session-console')
        expect(result).toBe('/chat')
      })

      it('returns /chat/:sessionId for chat tab with session ID', () => {
        const result = navigationToRoute('session-console', 'abc123')
        expect(result).toBe('/chat/abc123')
      })
    })

    describe('workspace section', () => {
      it('returns /workspace/:tabId for workspace tabs', () => {
        expect(navigationToRoute('dashboard')).toBe('/workspace/dashboard')
        expect(navigationToRoute('sessions')).toBe('/workspace/sessions')
        expect(navigationToRoute('usage')).toBe('/workspace/usage')
        expect(navigationToRoute('logs-debug')).toBe('/workspace/logs-debug')
        expect(navigationToRoute('channels')).toBe('/workspace/channels')
        expect(navigationToRoute('instances')).toBe('/workspace/instances')
        expect(navigationToRoute('status')).toBe('/workspace/status')
        expect(navigationToRoute('workflows')).toBe('/workspace/workflows')
        expect(navigationToRoute('approvals')).toBe('/workspace/approvals')
        expect(navigationToRoute('triggers')).toBe('/workspace/triggers')
        expect(navigationToRoute('memory')).toBe('/workspace/memory')
        expect(navigationToRoute('observability')).toBe('/workspace/observability')
      })

      it('ignores session ID for workspace tabs', () => {
        const result = navigationToRoute('dashboard', 'session-123')
        expect(result).toBe('/workspace/dashboard')
      })
    })

    describe('operations section', () => {
      it('returns /operations/:tabId for operations tabs', () => {
        expect(navigationToRoute('agent-monitor')).toBe('/operations/agent-monitor')
        expect(navigationToRoute('skills')).toBe('/operations/skills')
        expect(navigationToRoute('agents')).toBe('/operations/agents')
        expect(navigationToRoute('connectors')).toBe('/operations/connectors')
        expect(navigationToRoute('dlq')).toBe('/operations/dlq')
      })
    })

    describe('admin section', () => {
      it('returns /admin/:tabId for admin tabs', () => {
        expect(navigationToRoute('settings')).toBe('/admin/settings')
        expect(navigationToRoute('admin')).toBe('/admin/admin')
      })
    })
  })

  describe('bidirectional mapping', () => {
    it('round-trips all valid routes correctly', () => {
      // Test all valid routes
      const testCases = [
        { path: '/', expected: { tabId: 'session-console' as TabId, sessionId: undefined } },
        { path: '/chat', expected: { tabId: 'session-console' as TabId, sessionId: undefined } },
        { path: '/chat/abc123', expected: { tabId: 'session-console' as TabId, sessionId: 'abc123' } },
        { path: '/workspace/dashboard', expected: { tabId: 'dashboard' as TabId, sessionId: undefined } },
        { path: '/operations/agent-monitor', expected: { tabId: 'agent-monitor' as TabId, sessionId: undefined } },
        { path: '/admin/settings', expected: { tabId: 'settings' as TabId, sessionId: undefined } },
      ]

      for (const { path, expected } of testCases) {
        const navState = routeToNavigation(path)
        expect(navState.tabId).toBe(expected.tabId)
        expect(navState.sessionId).toBe(expected.sessionId)

        // Round-trip back to path
        const reconstructedPath = navigationToRoute(expected.tabId, expected.sessionId)
        expect(reconstructedPath).toBe(path === '/' ? '/chat' : path)
      }
    })
  })

  describe('getSectionDefaultRoute', () => {
    it('returns correct default route for each section', () => {
      expect(getSectionDefaultRoute('chat')).toBe('/chat')
      expect(getSectionDefaultRoute('workspace')).toBe('/workspace/dashboard')
      expect(getSectionDefaultRoute('operations')).toBe('/operations/agent-monitor')
      expect(getSectionDefaultRoute('admin')).toBe('/admin/settings')
    })
  })

  describe('coverage verification', () => {
    it('ensures all TabIds have valid routes', () => {
      const allTabIds: TabId[] = [
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

      for (const tabId of allTabIds) {
        const path = navigationToRoute(tabId)
        expect(path, `TabId '${tabId}' should produce a valid path`).toBeTruthy()
        expect(path.startsWith('/'), `Path for '${tabId}' should start with /`).toBe(true)

        // Verify round-trip
        const navState = routeToNavigation(path)
        expect(navState.tabId, `Round-trip for '${tabId}' should preserve tabId`).toBe(tabId)
      }
    })
  })
})
