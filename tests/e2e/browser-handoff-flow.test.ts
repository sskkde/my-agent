// allow: SIZE_OK — single-file E2E suite required by task spec; the fakes,
// fixture builder, and SSE reader are shared across all three test cases and
// splitting them into a one-caller helper module would be the same smell.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { createApiServer } from '../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'
import type { CloakBrowserProvider } from '../../src/search/browser/cloakbrowser-launcher.js'
import { toBrowserSessionId } from '../../src/search/browser/browser-session-manager.js'
import { searchWithDuckDuckGoBrowser } from '../../src/search/browser/duckduckgo-provider.js'
import type { BrowserSearchResult } from '../../src/search/types.js'
import { generateSessionToken, hashToken, hashPassword } from '../../src/storage/auth-crypto.js'
import { randomUUID } from 'node:crypto'

const FIXTURES_DIR = join(__dirname, '../fixtures/web-search')

async function loadHtmlFixture(filename: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, filename), 'utf-8')
}

// ─── Typed fakes for the Playwright surfaces the manager touches ──────────────
// Same structural-typing pattern as tests/integration/api/browser-sessions.test.ts.
// The fake Page returns fixture HTML from `content()` so the provider's
// `isCaptchaOrBlocked` and `extractDuckDuckGoResults` operate on deterministic
// local data — no real DuckDuckGo network dependency.

interface MouseFake {
  click: ReturnType<typeof vi.fn>
  wheel: ReturnType<typeof vi.fn>
}
interface KeyboardFake {
  press: ReturnType<typeof vi.fn>
  type: ReturnType<typeof vi.fn>
}

interface PageContentPlan {
  /** Sequence of HTML strings returned by successive `page.content()` calls. */
  contents: string[]
  /** Current index into `contents`. */
  index: number
}

function createPageFake(contentPlan: PageContentPlan): Page {
  const mouse: MouseFake = {
    click: vi.fn().mockResolvedValue(undefined),
    wheel: vi.fn().mockResolvedValue(undefined),
  }
  const keyboard: KeyboardFake = {
    press: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
  }
  return {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://duckduckgo.com/?q=test'),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-frame')),
    goto: vi.fn().mockResolvedValue(undefined),
    content: vi.fn().mockImplementation(() => {
      const html = contentPlan.contents[contentPlan.index] ?? ''
      contentPlan.index += 1
      return Promise.resolve(html)
    }),
    mouse: mouse as unknown as Page['mouse'],
    keyboard: keyboard as unknown as Page['keyboard'],
  } as unknown as Page
}

function createContextFake(page: Page): unknown {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createBrowserFake(context: unknown): unknown {
  return {
    newContext: vi.fn().mockResolvedValue(context),
  }
}

function createProviderFake(browser: unknown): CloakBrowserProvider {
  return {
    getBrowser: vi.fn().mockResolvedValue(browser),
    closeBrowser: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Build a fake CloakBrowserProvider stack whose `page.content()` returns the
 * provided content plan in order. The plan lets the happy-path test return the
 * blocked fixture first, then the success fixture after the human releases.
 */
function buildStack(contentPlan: PageContentPlan): {
  page: Page
  provider: CloakBrowserProvider
  contentPlan: PageContentPlan
} {
  const page = createPageFake(contentPlan)
  const context = createContextFake(page)
  const browser = createBrowserFake(context)
  const provider = createProviderFake(browser)
  return { page, provider, contentPlan }
}

// ─── SSE reader helper ────────────────────────────────────────────────────────

async function closeSseReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // Stream may already be closed or aborted.
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Ignore already-released locks.
    }
  }
}

/**
 * Read the SSE stream until `predicate(text)` returns true or the timeout
 * elapses. Returns the accumulated text. Aborts via the provided controller.
 */
async function readSseUntil(
  response: Response,
  predicate: (text: string) => boolean,
  timeoutMs: number,
): Promise<string> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let chunks = ''
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks += decoder.decode(value, { stream: true })
      if (predicate(chunks)) break
    }
  } finally {
    clearTimeout(timeout)
    await closeSseReader(reader)
  }
  return chunks
}

// ─── Test fixture ──────────────────────────────────────────────────────────────

interface HandoffFixture {
  server: FastifyInstance
  baseUrl: string
  context: ApiContext
  page: Page
  contentPlan: PageContentPlan
  authCookie: string
  userId: string
}

async function buildFixture(contentPlan: PageContentPlan): Promise<HandoffFixture> {
  const { page, provider } = buildStack(contentPlan)
  const ctx = createApiContext({ dbPath: ':memory:', webSearchBrowserProvider: provider })
  if (isApiContextError(ctx)) {
    throw new Error(`Failed to create API context: ${ctx.message}`)
  }
  const context = ctx

  const server = await createApiServer(context)
  await server.listen({ port: 0 })
  const address = server.server.address() as AddressInfo | null
  const baseUrl = `http://localhost:${address?.port ?? 0}`

  // Create a user directly via the store. The first user becomes admin.
  const userId = randomUUID()
  context.stores.userStore.create({
    userId,
    username: 'handoff-user',
    passwordHash: await hashPassword('handoffPass123'),
  })

  // Create an auth token for the user.
  const token = generateSessionToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  context.stores.authTokenStore.create({ tokenHash: hashToken(token), userId, expiresAt })

  const authCookie = `agent-platform-session=${token}`

  return { server, baseUrl, context, page, contentPlan, authCookie, userId }
}

async function createSession(fixture: HandoffFixture): Promise<string> {
  const response = await fetch(`${fixture.baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: fixture.authCookie },
    body: JSON.stringify({}),
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { data: { session: { sessionId: string } } }
  return body.data.session.sessionId
}

async function createBrowserSession(fixture: HandoffFixture, sessionId: string): Promise<void> {
  await fixture.context.browserSessionManager?.createSession(toBrowserSessionId(sessionId))
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Browser Handoff Full-Flow E2E', () => {
  let fixture: HandoffFixture

  afterEach(async () => {
    if (fixture) {
      await fixture.context.browserSessionManager?.closeAll()
      await fixture.server.close()
      fixture.context.connection.close()
    }
  })

  // ─── Happy path: blocked → handoff → takeover → input → release → resume ────
  describe('happy path: agent detects block, user takes over and releases, agent resumes', () => {
    it('completes the full handoff flow and returns search results', async () => {
      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')
      const successHtml = await loadHtmlFixture('duckduckgo-browser-success.html')

      // The page returns the blocked fixture first (agent's initial search),
      // then the success fixture after the human releases (agent re-extracts).
      const contentPlan: PageContentPlan = {
        contents: [blockedHtml, successHtml],
        index: 0,
      }

      fixture = await buildFixture(contentPlan)
      const sessionId = await createSession(fixture)
      await createBrowserSession(fixture, sessionId)

      const bsId = toBrowserSessionId(sessionId)
      const manager = fixture.context.browserSessionManager!

      // Step 3: Simulate browser search hitting a blocked page. The provider
      // detects the block via `isCaptchaOrBlocked` and calls
      // `manager.requestHandoff(sessionId)`, which transitions the session to
      // `handoff_requested` WITHOUT creating a lease. A human user then calls
      // POST /takeover to acquire the lease.
      //
      // We run the search in the background; it polls `manager.getStatus()`
      // every 500ms waiting for ownership to return to `agent_controlled`.
      const searchPromise: Promise<BrowserSearchResult> = searchWithDuckDuckGoBrowser({
        query: 'test query',
        sessionId: bsId,
        manager,
        timeoutMs: 5000,
      })

      // Allow the provider to reach the `requestHandoff` call and the first
      // poll iteration. A microtask flush is enough because the fake page's
      // `goto` and `content` are synchronous resolves.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // Step 4: Verify the session transitioned to `handoff_requested` (the
      // manager does only this one transition in `requestHandoff`; the
      // subsequent transition to `human_controlled` happens when the human
      // calls /takeover). The API status should be `handoff_requested`.
      const statusResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/status`,
        { headers: { Cookie: fixture.authCookie } },
      )
      expect(statusResponse.status).toBe(200)
      const statusBody = (await statusResponse.json()) as {
        ok: boolean
        data: { state: string; sessionId: string }
      }
      expect(statusBody.ok).toBe(true)
      expect(statusBody.data.state).toBe('handoff_requested')

      // Step 5: Verify the frame stream SSE is accessible and returns a
      // snapshot event as the first SSE message.
      const sseResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/frame/stream`,
        { headers: { Cookie: fixture.authCookie } },
      )
      expect(sseResponse.status).toBe(200)
      expect(sseResponse.headers.get('content-type')).toContain('text/event-stream')

      const sseText = await readSseUntil(
        sseResponse,
        (text) => text.includes('"type":"snapshot"'),
        3000,
      )
      expect(sseText).toContain('"type":"snapshot"')
      expect(sseText).toContain('data:')

      // Step 6: The agent's `requestHandoff` left the session in
      // `handoff_requested` without a lease. The real user now takes over via
      // POST /takeover, which transitions to `human_controlled` and grants the
      // lease to the user.
      const takeoverResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/takeover`,
        { method: 'POST', headers: { Cookie: fixture.authCookie } },
      )
      expect(takeoverResponse.status).toBe(200)
      const takeoverBody = (await takeoverResponse.json()) as {
        ok: boolean
        data: { state: string; previousState: string; sessionId: string }
      }
      expect(takeoverBody.ok).toBe(true)
      expect(takeoverBody.data.state).toBe('user_controlled')
      expect(takeoverBody.data.previousState).toBe('handoff_requested')

      // Step 7: User sends input via POST /input (click) → 200 success.
      const inputResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/input`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: fixture.authCookie },
          body: JSON.stringify({ action: 'click', payload: { x: 0.5, y: 0.5 } }),
        },
      )
      expect(inputResponse.status).toBe(200)
      const inputBody = (await inputResponse.json()) as {
        ok: boolean
        data: { success: boolean }
      }
      expect(inputBody.ok).toBe(true)
      expect(inputBody.data.success).toBe(true)

      // Step 8: User releases via POST /release → state becomes agent_controlled.
      const releaseResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/release`,
        { method: 'POST', headers: { Cookie: fixture.authCookie } },
      )
      expect(releaseResponse.status).toBe(200)
      const releaseBody = (await releaseResponse.json()) as {
        ok: boolean
        data: { state: string; previousState: string; sessionId: string }
      }
      expect(releaseBody.ok).toBe(true)
      expect(releaseBody.data.state).toBe('agent_controlled')
      expect(releaseBody.data.previousState).toBe('user_controlled')

      // Step 9: The agent's poll loop detects ownership back to
      // `agent_controlled` and re-extracts from the page. The page's
      // `content()` now returns the success fixture (second entry in the plan).
      const searchResult = await searchPromise

      // Step 10: Verify the agent search resumed and returned results.
      expect(searchResult.success).toBe(true)
      expect(searchResult.results).toHaveLength(2)
      expect(searchResult.results?.[0].title).toBe(
        'SearXNG: A privacy-respecting metasearch engine',
      )
      expect(searchResult.provider).toBe('duckduckgo-browser')
    })
  })

  // ─── Error path: handoff timeout ─────────────────────────────────────────────
  describe('error path: handoff timeout when user never releases', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns BROWSER_SEARCH_CAPTCHA after the 2-minute handoff timeout', async () => {
      const blockedHtml = await loadHtmlFixture('duckduckgo-browser-blocked.html')

      // The page only ever returns the blocked fixture — the human never
      // resolves the CAPTCHA, so the poll loop times out.
      const contentPlan: PageContentPlan = {
        contents: [blockedHtml],
        index: 0,
      }

      fixture = await buildFixture(contentPlan)
      const sessionId = await createSession(fixture)
      await createBrowserSession(fixture, sessionId)

      const bsId = toBrowserSessionId(sessionId)
      const manager = fixture.context.browserSessionManager!

      // Start the browser search. The provider detects the block, calls
      // `manager.requestHandoff(sessionId)`, then polls every 500ms for up to
      // 120s. Since the human never takes over/release, the poll loop hits the
      // deadline.
      const searchPromise: Promise<BrowserSearchResult> = searchWithDuckDuckGoBrowser({
        query: 'test query',
        sessionId: bsId,
        manager,
        timeoutMs: 5000,
      })

      // Let the provider reach the poll loop.
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      // Verify the session is in handoff_requested state while waiting.
      const status = manager.getStatus(bsId)
      expect(status).not.toBeNull()
      expect(status?.ownership).toBe('handoff_requested')

      // Advance fake timers past the 120s handoff wait deadline.
      await vi.advanceTimersByTimeAsync(130_000)

      const result = await searchPromise

      // Verify the error code is BROWSER_SEARCH_CAPTCHA.
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('BROWSER_SEARCH_CAPTCHA')
    })
  })

  // ─── Error path: denied input without takeover ──────────────────────────────
  describe('error path: denied input without takeover lease', () => {
    it('returns 403 when user sends input without holding a takeover lease', async () => {
      const successHtml = await loadHtmlFixture('duckduckgo-browser-success.html')
      const contentPlan: PageContentPlan = {
        contents: [successHtml],
        index: 0,
      }

      fixture = await buildFixture(contentPlan)
      const sessionId = await createSession(fixture)
      await createBrowserSession(fixture, sessionId)

      // User tries to send input without a takeover → 403.
      const inputResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/input`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: fixture.authCookie },
          body: JSON.stringify({ action: 'click', payload: { x: 0.5, y: 0.5 } }),
        },
      )
      expect(inputResponse.status).toBe(403)
      const inputBody = (await inputResponse.json()) as {
        ok: boolean
        error: { code: string; message: string }
      }
      expect(inputBody.ok).toBe(false)
      expect(inputBody.error.code).toBe('FORBIDDEN')

      // Verify the chat/session is not broken by the denied input: the
      // session status endpoint still works and the browser session is still
      // in `agent_controlled` state.
      const statusResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/status`,
        { headers: { Cookie: fixture.authCookie } },
      )
      expect(statusResponse.status).toBe(200)
      const statusBody = (await statusResponse.json()) as {
        ok: boolean
        data: { state: string; sessionId: string }
      }
      expect(statusBody.ok).toBe(true)
      expect(statusBody.data.state).toBe('agent_controlled')

      // Verify a subsequent takeover still works — the denied input did not
      // corrupt the lease state machine.
      const takeoverResponse = await fetch(
        `${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/takeover`,
        { method: 'POST', headers: { Cookie: fixture.authCookie } },
      )
      expect(takeoverResponse.status).toBe(200)
      const takeoverBody = (await takeoverResponse.json()) as {
        ok: boolean
        data: { state: string }
      }
      expect(takeoverBody.ok).toBe(true)
      expect(takeoverBody.data.state).toBe('user_controlled')
    })
  })
})