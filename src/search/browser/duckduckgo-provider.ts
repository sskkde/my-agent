import type { BrowserSearchResult } from '../types.js'
import { extractDuckDuckGoResults } from './duckduckgo-extractor.js'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { BrowserSessionId } from './browser-session-types.js'
import type { BrowserSessionManager } from './browser-session-manager.js'

// ─── Module-level logger ─────────────────────────────────────────────────────
// Best-effort structured logging for search/handoff errors that previously
// were swallowed by empty catches. Falls back to console when no platform
// logger is wired in.

type DuckDuckGoLogger = {
  warn(message: string, fields?: Record<string, unknown>): void
}

let duckduckgoLogger: DuckDuckGoLogger = {
  warn(message, fields) {
    // eslint-disable-next-line no-console
    console.warn(`[duckduckgo-provider] ${message}`, fields ?? {})
  },
}

/** Inject a platform logger (e.g. pino). When unset, falls back to console. */
export function setDuckDuckGoLogger(logger: DuckDuckGoLogger): void {
  duckduckgoLogger = logger
}

interface DuckDuckGoBrowserSearchParams {
  query: string
  browser?: Browser
  timeoutMs?: number
  sessionId?: BrowserSessionId
  manager?: BrowserSessionManager
}

/**
 * Detect whether the given HTML is a CAPTCHA / blocking interstitial rather
 * than a normal results page. Checks for common CAPTCHA indicators and the
 * DuckDuckGo-specific captcha container used in the blocked fixture.
 */
export function isCaptchaOrBlocked(html: string): boolean {
  const lowerHtml = html.toLowerCase()

  // DuckDuckGo-specific structural marker from the blocked fixture.
  if (lowerHtml.includes('captcha-container') || lowerHtml.includes('captcha-form')) {
    return true
  }

  const captchaIndicators = [
    'captcha',
    'are you a human',
    'unusual traffic',
    'verify you are human',
    'robot check',
    'access denied',
    'ddg-captcha',
  ]

  return captchaIndicators.some((indicator) => lowerHtml.includes(indicator))
}

export async function searchWithDuckDuckGoBrowser(params: DuckDuckGoBrowserSearchParams): Promise<BrowserSearchResult> {
  const { query, browser: injectedBrowser, timeoutMs = 10000, sessionId, manager } = params

  // Managed-session path: use the session's page and support handoff.
  if (manager !== undefined && sessionId !== undefined) {
    return searchWithManagedSession({ query, sessionId, manager, timeoutMs })
  }

  // Throwaway-context path (unchanged behaviour).
  let context: BrowserContext | undefined
  let page: Page | undefined

  try {
    if (!injectedBrowser) {
      return {
        success: false,
        errorCode: 'BROWSER_SEARCH_UNAVAILABLE',
      }
    }

    context = await injectedBrowser.newContext()
    page = await context.newPage()

    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`

    await page.goto(searchUrl, { timeout: timeoutMs })

    const html = await page.content()

    if (isCaptchaOrBlocked(html)) {
      return { success: false, errorCode: 'BROWSER_SEARCH_CAPTCHA' }
    }

    const result = extractDuckDuckGoResults(html)

    if (result.success && result.results) {
      return {
        success: true,
        results: result.results,
        provider: 'duckduckgo-browser',
        endpointHost: 'duckduckgo.com',
        query,
        total: result.results.length,
      }
    }

    return result
  } catch (err) {
    duckduckgoLogger.warn('duckduckgo browser search failed', {
      query,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      success: false,
      errorCode: 'BROWSER_SEARCH_UNAVAILABLE',
    }
  } finally {
    if (page) {
      await page.close().catch((err: unknown) => {
        // best-effort cleanup: page close errors are ignored because the
        // throwaway context is being torn down regardless. Logged so the
        // failure is observable.
        duckduckgoLogger.warn('throwaway page.close failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
    if (context) {
      await context.close().catch((err: unknown) => {
        // best-effort cleanup: context close errors are ignored because the
        // throwaway context is being torn down regardless. Logged so the
        // failure is observable.
        duckduckgoLogger.warn('throwaway context.close failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
    }
  }
}

// ─── Managed-session path ────────────────────────────────────────────────────

interface ManagedSearchParams {
  query: string
  sessionId: BrowserSessionId
  manager: BrowserSessionManager
  timeoutMs: number
}

async function searchWithManagedSession(params: ManagedSearchParams): Promise<BrowserSearchResult> {
  const { query, sessionId, manager, timeoutMs } = params

  const page = manager.getPage(sessionId)
  if (page === null) {
    return { success: false, errorCode: 'BROWSER_SEARCH_UNAVAILABLE' }
  }

  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`

  try {
    await page.goto(searchUrl, { timeout: timeoutMs })
  } catch (err) {
    duckduckgoLogger.warn('managed session page.goto failed', {
      sessionId,
      query,
      error: err instanceof Error ? err.message : String(err),
    })
    return { success: false, errorCode: 'BROWSER_SEARCH_UNAVAILABLE' }
  }

  const html = await page.content().catch((err: unknown) => {
    duckduckgoLogger.warn('managed session page.content failed', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return ''
  })
  if (html === '') {
    return { success: false, errorCode: 'BROWSER_SEARCH_UNAVAILABLE' }
  }

  if (!isCaptchaOrBlocked(html)) {
    return extractFromHtml(html, query)
  }

  // Blocked: request human handoff (without creating a lease) and wait for a
  // human user to call `requestTakeover` to acquire the lease and resolve the
  // challenge.
  const handoff = manager.requestHandoff(sessionId)
  if (!handoff.success) {
    return { success: false, errorCode: 'BROWSER_SEARCH_CAPTCHA' }
  }

  const released = await waitForRelease(sessionId, manager)
  if (!released) {
    return { success: false, errorCode: 'BROWSER_SEARCH_CAPTCHA' }
  }

  // Re-extract from the same page after the human resolved the challenge.
  const retryHtml = await page.content().catch((err: unknown) => {
    duckduckgoLogger.warn('managed session retry page.content failed', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
    return ''
  })
  if (retryHtml === '' || isCaptchaOrBlocked(retryHtml)) {
    return { success: false, errorCode: 'BROWSER_SEARCH_CAPTCHA' }
  }

  return extractFromHtml(retryHtml, query)
}

/**
 * Poll the session manager until ownership returns to `agent_controlled` or
 * the handoff wait timeout elapses. Returns true if released, false on timeout.
 */
async function waitForRelease(sessionId: BrowserSessionId, manager: BrowserSessionManager): Promise<boolean> {
  const timeoutMs = 120_000
  const pollIntervalMs = 500
  const deadline = Date.now() + timeoutMs

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = manager.getStatus(sessionId)
    if (status === null) {
      return false
    }
    if (status.ownership === 'agent_controlled') {
      return true
    }
    if (Date.now() >= deadline) {
      return false
    }
    await sleep(pollIntervalMs)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractFromHtml(html: string, query: string): BrowserSearchResult {
  const result = extractDuckDuckGoResults(html)
  if (result.success && result.results) {
    return {
      success: true,
      results: result.results,
      provider: 'duckduckgo-browser',
      endpointHost: 'duckduckgo.com',
      query,
      total: result.results.length,
    }
  }
  return result
}