import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { BrowserSessionId, OwnershipState } from '../../../src/search/browser/browser-session-types.js'
import type { BrowserSessionManager } from '../../../src/search/browser/browser-session-manager.js'
import type { BrowserSearchResult } from '../../../src/search/types.js'

const FIXTURES_DIR = join(__dirname, '../../fixtures/web-search')

async function loadHtmlFixture(filename: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, filename), 'utf-8')
}

// ─── Fake manager ────────────────────────────────────────────────────────────
// A minimal fake of BrowserSessionManager that lets tests drive the ownership
// state machine and capture takeover requests. We avoid mocking the real class
// because the handoff flow only depends on three seams: getPage, getStatus,
// and requestTakeover.

interface FakeManagerOptions {
  initialOwnership?: OwnershipState
  takeoverResult?: { success: boolean; error?: string }
  handoffResult?: { success: boolean; error?: string }
  pageContent?: string
  retryPageContent?: string
}

// Test-side accessor for the fake manager's internal state setter. The fake
// is cast to BrowserSessionManager for injection; this helper recovers the
// `_setOwnership` method without leaking `as any` across the test file.
interface FakeManagerInternals {
  _setOwnership: (state: OwnershipState) => void
  requestTakeover: ReturnType<typeof vi.fn>
  requestHandoff: ReturnType<typeof vi.fn>
}

function asFakeInternals(manager: BrowserSessionManager): FakeManagerInternals {
  return manager as unknown as FakeManagerInternals
}

function createFakeManager(opts: FakeManagerOptions = {}): BrowserSessionManager {
  let ownership: OwnershipState = opts.initialOwnership ?? 'agent_controlled'
  let pageContent = opts.pageContent ?? ''
  const retryContent = opts.retryPageContent ?? ''
  let contentCallCount = 0

  const fakePage = {
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockImplementation(() => {
      contentCallCount += 1
      // First content call returns the initial pageContent; subsequent calls
      // (after release) return the retry content if provided.
      return Promise.resolve(contentCallCount === 1 ? pageContent : (retryContent || pageContent))
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }

  const manager = {
    getPage: vi.fn().mockReturnValue(fakePage),
    getStatus: vi.fn().mockImplementation(() => ({
      ownership,
      url: null,
      lastActivityAt: new Date().toISOString(),
    })),
    requestTakeover: vi.fn().mockResolvedValue(
      opts.takeoverResult ?? { success: true, lease: undefined },
    ),
    requestHandoff: vi.fn().mockImplementation(() => {
      // Default: succeed and transition to handoff_requested. Tests that need
      // to drive the poll loop set ownership to human_controlled here.
      ownership = 'handoff_requested'
      return opts.handoffResult ?? { success: true }
    }),
    releaseTakeover: vi.fn().mockResolvedValue({ success: true }),
    _setOwnership: (state: OwnershipState) => {
      ownership = state
    },
  }

  return manager as unknown as BrowserSessionManager
}

function asSessionId(value: string): BrowserSessionId {
  return value as BrowserSessionId
}

describe('web-search-browser-handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  // ─── isCaptchaOrBlocked detection ──────────────────────────────────────────

  describe('isCaptchaOrBlocked', () => {
    it('returns true for the blocked fixture', async () => {
      const html = await loadHtmlFixture('duckduckgo-browser-blocked.html')
      const { isCaptchaOrBlocked } = await import('../../../src/search/browser/duckduckgo-provider.js')

      expect(isCaptchaOrBlocked(html)).toBe(true)
    })

    it('returns false for the success fixture', async () => {
      const html = await loadHtmlFixture('duckduckgo-browser-success.html')
      const { isCaptchaOrBlocked } = await import('../../../src/search/browser/duckduckgo-provider.js')

      expect(isCaptchaOrBlocked(html)).toBe(false)
    })

    it('detects common CAPTCHA indicators', async () => {
      const { isCaptchaOrBlocked } = await import('../../../src/search/browser/duckduckgo-provider.js')

      expect(isCaptchaOrBlocked('<html>captcha</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>Are you a human</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>unusual traffic</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>verify you are human</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>robot check</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>access denied</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>ddg-captcha</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>captcha-container</html>')).toBe(true)
      expect(isCaptchaOrBlocked('<html>captcha-form</html>')).toBe(true)
    })

    it('returns false for normal page content', async () => {
      const { isCaptchaOrBlocked } = await import('../../../src/search/browser/duckduckgo-provider.js')

      expect(isCaptchaOrBlocked('<html><body>normal results page</body></html>')).toBe(false)
      expect(isCaptchaOrBlocked('<html><body>search results here</body></html>')).toBe(false)
    })
  })

  // ─── Managed session handoff flow ─────────────────────────────────────────

  describe('managed session handoff', () => {
    it('unblocked browser search returns results without handoff', async () => {
      const successHtml = await loadHtmlFixture('duckduckgo-browser-success.html')
      const manager = createFakeManager({ pageContent: successHtml })

      const { searchWithDuckDuckGoBrowser } = await import(
        '../../../src/search/browser/duckduckgo-provider.js'
      )

      const result: BrowserSearchResult = await searchWithDuckDuckGoBrowser({
        query: 'test query',
        sessionId: asSessionId('sess-1'),
        manager,
        timeoutMs: 5000,
      })

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)
      expect(result.provider).toBe('duckduckgo-browser')
      expect(manager.requestHandoff).not.toHaveBeenCalled()
    })

    it('blocked page requests handoff and transitions to handoff_requested', async () => {
      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')
      const successHtml = await loadHtmlFixture('duckduckgo-browser-success.html')

      const manager = createFakeManager({
        pageContent: blockedHtml,
        retryPageContent: successHtml,
        initialOwnership: 'agent_controlled',
      })

      const { searchWithDuckDuckGoBrowser } = await import(
        '../../../src/search/browser/duckduckgo-provider.js'
      )

      // Drive the poll: after requestHandoff, simulate the human taking over
      // (via requestTakeover on the API) then releasing back to
      // agent_controlled on the first poll tick.
      asFakeInternals(manager).requestHandoff.mockImplementation(() => {
        // After handoff is requested, the session is in handoff_requested.
        // Simulate the human taking over then releasing after 500ms.
        asFakeInternals(manager)._setOwnership('human_controlled')
        setTimeout(() => {
          asFakeInternals(manager)._setOwnership('agent_controlled')
        }, 500)
        return { success: true }
      })

      const resultPromise = searchWithDuckDuckGoBrowser({
        query: 'test query',
        sessionId: asSessionId('sess-1'),
        manager,
        timeoutMs: 5000,
      })

      await vi.advanceTimersByTimeAsync(600)
      const result = await resultPromise

      expect(manager.requestHandoff).toHaveBeenCalledTimes(1)
      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)
    })

    it('release resumes extraction and returns success fixture results', async () => {
      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')
      const successHtml = await loadHtmlFixture('duckduckgo-browser-success.html')

      const manager = createFakeManager({
        pageContent: blockedHtml,
        retryPageContent: successHtml,
      })

      asFakeInternals(manager).requestHandoff.mockImplementation(() => {
        asFakeInternals(manager)._setOwnership('human_controlled')
        // Human solves CAPTCHA and releases after 1000ms.
        setTimeout(() => {
          asFakeInternals(manager)._setOwnership('agent_controlled')
        }, 1000)
        return { success: true }
      })

      const { searchWithDuckDuckGoBrowser } = await import(
        '../../../src/search/browser/duckduckgo-provider.js'
      )

      const resultPromise = searchWithDuckDuckGoBrowser({
        query: 'test query',
        sessionId: asSessionId('sess-1'),
        manager,
        timeoutMs: 5000,
      })

      await vi.advanceTimersByTimeAsync(1100)
      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.results).toHaveLength(2)
      expect(result.results?.[0].title).toBe('SearXNG: A privacy-respecting metasearch engine')
    })

    it('timeout returns BROWSER_SEARCH_CAPTCHA error', async () => {
      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')
      const manager = createFakeManager({
        pageContent: blockedHtml,
        initialOwnership: 'agent_controlled',
      })

      // Handoff succeeds but the human never takes over/release — ownership
      // stays at handoff_requested forever, so the poll loop hits the 2-minute
      // deadline.
      asFakeInternals(manager).requestHandoff.mockImplementation(() => {
        asFakeInternals(manager)._setOwnership('handoff_requested')
        return { success: true }
      })

      const { searchWithDuckDuckGoBrowser } = await import(
        '../../../src/search/browser/duckduckgo-provider.js'
      )

      const resultPromise = searchWithDuckDuckGoBrowser({
        query: 'test query',
        sessionId: asSessionId('sess-1'),
        manager,
        timeoutMs: 5000,
      })

      // Advance past the 120s handoff wait deadline.
      await vi.advanceTimersByTimeAsync(130_000)
      const result = await resultPromise

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('BROWSER_SEARCH_CAPTCHA')
    })

    it('no manager returns BROWSER_SEARCH_CAPTCHA directly for blocked page', async () => {
      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        content: vi.fn().mockResolvedValue(blockedHtml),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const { searchWithDuckDuckGoBrowser } = await import(
        '../../../src/search/browser/duckduckgo-provider.js'
      )

      const result = await searchWithDuckDuckGoBrowser({
        query: 'test query',
        browser: mockBrowser as unknown as import('playwright-core').Browser,
        timeoutMs: 5000,
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('BROWSER_SEARCH_CAPTCHA')
    })

    it('handoff failure returns BROWSER_SEARCH_CAPTCHA', async () => {
      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')
      const manager = createFakeManager({
        pageContent: blockedHtml,
        handoffResult: { success: false, error: 'LEASE_CONFLICT' },
      })

      const { searchWithDuckDuckGoBrowser } = await import(
        '../../../src/search/browser/duckduckgo-provider.js'
      )

      const result = await searchWithDuckDuckGoBrowser({
        query: 'test query',
        sessionId: asSessionId('sess-1'),
        manager,
        timeoutMs: 5000,
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('BROWSER_SEARCH_CAPTCHA')
    })
  })

  // ─── Non-browser backends unaffected ───────────────────────────────────────

  describe('non-browser backends unaffected', () => {
    it('SearXNG backend does not call isCaptchaOrBlocked', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'searxng')
      vi.stubEnv('SEARXNG_BASE_URL', 'http://localhost:8080')

      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      }) as unknown as typeof fetch

      const { createWebSearchTool } = await import('../../../src/tools/builtins/web-search.js')
      const tool = createWebSearchTool({ fetchImpl })

      const result = await tool.handler(
        { query: 'test query' },
        {
          toolCallId: 'tc-1',
          toolName: 'web_search',
          userId: 'user-1',
          sessionId: 'session-1',
          permissionContext: {
            userId: 'user-1',
            sessionId: 'session-1',
            mode: 'ask_on_write',
            grants: [],
          },
          executionStartTime: new Date().toISOString(),
          stores: {
            toolExecutionStore: {
              updateStatus: () => {},
              saveResult: () => {},
            },
          },
        },
      )

      // SearXNG never produces a BROWSER_SEARCH_CAPTCHA error code.
      if (!result.success && result.error) {
        expect(result.error.code).not.toBe('BROWSER_SEARCH_CAPTCHA')
      } else {
        expect(result.success).toBe(true)
      }
      expect(fetchImpl).toHaveBeenCalled()
    })

    it('Tavily backend does not call isCaptchaOrBlocked', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'tavily')
      vi.stubEnv('TAVILY_API_KEY', 'test-key')

      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      }) as unknown as typeof fetch

      const { createWebSearchTool } = await import('../../../src/tools/builtins/web-search.js')
      const tool = createWebSearchTool({ fetchImpl })

      const result = await tool.handler(
        { query: 'test query' },
        {
          toolCallId: 'tc-1',
          toolName: 'web_search',
          userId: 'user-1',
          sessionId: 'session-1',
          permissionContext: {
            userId: 'user-1',
            sessionId: 'session-1',
            mode: 'ask_on_write',
            grants: [],
          },
          executionStartTime: new Date().toISOString(),
          stores: {
            toolExecutionStore: {
              updateStatus: () => {},
              saveResult: () => {},
            },
          },
        },
      )

      if (!result.success && result.error) {
        expect(result.error.code).not.toBe('BROWSER_SEARCH_CAPTCHA')
      } else {
        expect(result.success).toBe(true)
      }
      expect(fetchImpl).toHaveBeenCalled()
    })

    it('remote backend does not call isCaptchaOrBlocked', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'remote')
      vi.stubEnv('WEB_SEARCH_API_URL', 'http://localhost:9999/search')

      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      }) as unknown as typeof fetch

      const { createWebSearchTool } = await import('../../../src/tools/builtins/web-search.js')
      const tool = createWebSearchTool({ fetchImpl })

      const result = await tool.handler(
        { query: 'test query' },
        {
          toolCallId: 'tc-1',
          toolName: 'web_search',
          userId: 'user-1',
          sessionId: 'session-1',
          permissionContext: {
            userId: 'user-1',
            sessionId: 'session-1',
            mode: 'ask_on_write',
            grants: [],
          },
          executionStartTime: new Date().toISOString(),
          stores: {
            toolExecutionStore: {
              updateStatus: () => {},
              saveResult: () => {},
            },
          },
        },
      )

      if (!result.success && result.error) {
        expect(result.error.code).not.toBe('BROWSER_SEARCH_CAPTCHA')
      } else {
        expect(result.success).toBe(true)
      }
      expect(fetchImpl).toHaveBeenCalled()
    })
  })

  // ─── Managed session via web-search tool config ────────────────────────────

  describe('web-search tool with managed session config', () => {
    it('uses browserSessionManager and browserSessionId for playwright backend', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'playwright')

      const successHtml = await loadHtmlFixture('duckduckgo-browser-success.html')
      const manager = createFakeManager({ pageContent: successHtml })

      const { createWebSearchTool } = await import('../../../src/tools/builtins/web-search.js')
      const tool = createWebSearchTool({
        browserSessionManager: manager,
        browserSessionId: asSessionId('sess-tool-1'),
      })

      const result = await tool.handler(
        { query: 'test query', limit: 5 },
        {
          toolCallId: 'tc-1',
          toolName: 'web_search',
          userId: 'user-1',
          sessionId: 'session-1',
          permissionContext: {
            userId: 'user-1',
            sessionId: 'session-1',
            mode: 'ask_on_write',
            grants: [],
          },
          executionStartTime: new Date().toISOString(),
          stores: {
            toolExecutionStore: {
              updateStatus: () => {},
              saveResult: () => {},
            },
          },
        },
      )

      expect(result.success).toBe(true)
      expect(manager.getPage).toHaveBeenCalledWith(asSessionId('sess-tool-1'))
      expect(manager.requestHandoff).not.toHaveBeenCalled()
    })

    it('blocked page with manager triggers handoff and returns CAPTCHA on timeout', async () => {
      vi.stubEnv('WEB_SEARCH_BACKEND', 'playwright')

      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')
      const manager = createFakeManager({ pageContent: blockedHtml })

      asFakeInternals(manager).requestHandoff.mockImplementation(() => {
        asFakeInternals(manager)._setOwnership('handoff_requested')
        return { success: true }
      })

      const { createWebSearchTool } = await import('../../../src/tools/builtins/web-search.js')
      const tool = createWebSearchTool({
        browserSessionManager: manager,
        browserSessionId: asSessionId('sess-tool-2'),
      })

      const resultPromise = tool.handler(
        { query: 'test query', limit: 5 },
        {
          toolCallId: 'tc-1',
          toolName: 'web_search',
          userId: 'user-1',
          sessionId: 'session-1',
          permissionContext: {
            userId: 'user-1',
            sessionId: 'session-1',
            mode: 'ask_on_write',
            grants: [],
          },
          executionStartTime: new Date().toISOString(),
          stores: {
            toolExecutionStore: {
              updateStatus: () => {},
              saveResult: () => {},
            },
          },
        },
      )

      await vi.advanceTimersByTimeAsync(130_000)
      const result = await resultPromise

      expect(result.success).toBe(false)
      if (!result.success && result.error) {
        expect(result.error.code).toBe('BROWSER_SEARCH_CAPTCHA')
      }
    })
  })
})