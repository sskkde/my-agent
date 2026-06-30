import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { AddressInfo } from 'node:net'
import type { Page } from 'playwright-core'
import type { CloakBrowserProvider } from '../../../src/search/browser/cloakbrowser-launcher.js'
import { toBrowserSessionId } from '../../../src/search/browser/browser-session-manager.js'
import { generateSessionToken, hashToken, hashPassword } from '../../../src/storage/auth-crypto.js'
import { randomUUID } from 'node:crypto'

// ─── Typed fakes for the Playwright surfaces the manager touches ──────────────
// Minimal typed fakes injected through the CloakBrowserProvider seam. The
// manager only calls the methods listed here, so no `any` or full-interface
// implementation is needed. The fakes are typed to satisfy `Page` /
// `BrowserContext` / `Browser` structurally.

interface MouseFake {
  click: ReturnType<typeof vi.fn>
  wheel: ReturnType<typeof vi.fn>
}
interface KeyboardFake {
  press: ReturnType<typeof vi.fn>
  type: ReturnType<typeof vi.fn>
}

function createPageFake(): Page {
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
    url: vi.fn().mockReturnValue('https://example.com'),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-frame')),
    goto: vi.fn().mockResolvedValue(undefined),
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

function buildStack(): { page: Page; provider: CloakBrowserProvider } {
  const page = createPageFake()
  const context = createContextFake(page)
  const browser = createBrowserFake(context)
  const provider = createProviderFake(browser)
  return { page, provider }
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

// ─── Test fixture ──────────────────────────────────────────────────────────────

interface TestFixture {
  server: FastifyInstance
  baseUrl: string
  context: ApiContext
  page: Page
  authCookieA: string
  authCookieB: string
  userIdA: string
  userIdB: string
}

async function buildFixture(): Promise<TestFixture> {
  const { page, provider } = buildStack()
  const ctx = createApiContext({ dbPath: ':memory:', webSearchBrowserProvider: provider })
  if (isApiContextError(ctx)) {
    throw new Error(`Failed to create API context: ${ctx.message}`)
  }
  const context = ctx

  const server = await createApiServer(context)
  await server.listen({ port: 0 })
  const address = server.server.address() as AddressInfo | null
  const baseUrl = `http://localhost:${address?.port ?? 0}`

  // Create two users directly via the store. The first user becomes admin
  // (per UserStoreImpl.create), the second becomes a regular user.
  const userIdA = randomUUID()
  const userIdB = randomUUID()
  context.stores.userStore.create({
    userId: userIdA,
    username: 'userA',
    passwordHash: await hashPassword('passwordA123'),
  })
  context.stores.userStore.create({
    userId: userIdB,
    username: 'userB',
    passwordHash: await hashPassword('passwordB123'),
  })

  // Create auth tokens for both users.
  const tokenA = generateSessionToken()
  const tokenB = generateSessionToken()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  context.stores.authTokenStore.create({ tokenHash: hashToken(tokenA), userId: userIdA, expiresAt })
  context.stores.authTokenStore.create({ tokenHash: hashToken(tokenB), userId: userIdB, expiresAt })

  const authCookieA = `agent-platform-session=${tokenA}`
  const authCookieB = `agent-platform-session=${tokenB}`

  return { server, baseUrl, context, page, authCookieA, authCookieB, userIdA, userIdB }
}

async function createSession(fixture: TestFixture, cookie: string): Promise<string> {
  const response = await fetch(`${fixture.baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({}),
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { data: { session: { sessionId: string } } }
  return body.data.session.sessionId
}

async function createBrowserSession(fixture: TestFixture, sessionId: string): Promise<void> {
  await fixture.context.browserSessionManager?.createSession(toBrowserSessionId(sessionId))
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Browser Sessions API Integration', () => {
  let fixture: TestFixture

  beforeAll(async () => {
    fixture = await buildFixture()
  })

  afterAll(async () => {
    await fixture.server.close()
    fixture.context.connection.close()
  })

  // The BrowserSessionManager enforces a max-sessions cap (default 5). Each
  // test that calls createBrowserSession consumes a slot; without cleanup the
  // 6th creation throws MAX_SESSIONS_REACHED. Close all browser sessions after
  // each test to keep the manager empty for the next one.
  afterEach(async () => {
    await fixture.context.browserSessionManager?.closeAll()
  })

  // ─── 1. 404 missing session ─────────────────────────────────────────────────
  it('GET /browser/status returns 404 for non-existent session', async () => {
    const response = await fixture.server.inject({
      method: 'GET',
      url: '/api/v1/sessions/non-existent-session/browser/status',
      headers: { Cookie: fixture.authCookieA },
    })
    expect(response.statusCode).toBe(404)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  // ─── 2. 403 unauthorized session ─────────────────────────────────────────────
  it('GET /browser/status returns 403 when User B accesses User A session', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)

    const response = await fixture.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/browser/status`,
      headers: { Cookie: fixture.authCookieB },
    })
    expect(response.statusCode).toBe(403)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('FORBIDDEN')
  })

  // ─── 3. status idle / no active browser session ──────────────────────────────
  it('GET /browser/status returns 200 with idle state when no browser session exists', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)

    const response = await fixture.server.inject({
      method: 'GET',
      url: `/api/v1/sessions/${sessionId}/browser/status`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.data.state).toBe('idle')
    expect(body.data.url).toBeNull()
    expect(body.data.viewport).toBeNull()
    expect(body.data.lastActivityAt).toBeNull()
  })

  // ─── 4. takeover success ─────────────────────────────────────────────────────
  it('POST /browser/takeover returns 200 with user_controlled state', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    const response = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/takeover`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.data.sessionId).toBe(sessionId)
    expect(body.data.state).toBe('user_controlled')
    expect(body.data.previousState).toBe('agent_controlled')
  })

  // ─── 5. release success ─────────────────────────────────────────────────────
  it('POST /browser/release returns 200 with agent_controlled state after takeover', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    // Takeover first
    const takeoverResponse = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/takeover`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(takeoverResponse.statusCode).toBe(200)

    // Then release
    const response = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/release`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.data.sessionId).toBe(sessionId)
    expect(body.data.state).toBe('agent_controlled')
    expect(body.data.previousState).toBe('user_controlled')
  })

  // ─── 6. 409 competing takeover ───────────────────────────────────────────────
  it('POST /browser/takeover returns 409 when another user already holds the lease', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    // User A takes over
    const takeoverA = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/takeover`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(takeoverA.statusCode).toBe(200)

    // User B (admin) tries to take over the same session — but User B cannot
    // access User A's session (403). To test the 409 conflict we need User A
    // to attempt a second takeover. The lease is already held by User A, so a
    // second takeover by the same user is also a LEASE_CONFLICT.
    const secondTakeover = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/takeover`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(secondTakeover.statusCode).toBe(409)
    const body = JSON.parse(secondTakeover.body)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('LEASE_CONFLICT')
  })

  // ─── 7. 403 input without lease ─────────────────────────────────────────────
  it('POST /browser/input returns 403 when no takeover lease is held', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    const response = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/input`,
      headers: { Cookie: fixture.authCookieA, 'Content-Type': 'application/json' },
      payload: { action: 'click', payload: { x: 0.5, y: 0.5 } },
    })
    expect(response.statusCode).toBe(403)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('FORBIDDEN')
  })

  // ─── 8. input with lease ─────────────────────────────────────────────────────
  it('POST /browser/input returns 200 success after takeover', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    // Takeover first to acquire the lease
    const takeover = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/takeover`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(takeover.statusCode).toBe(200)

    const response = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/input`,
      headers: { Cookie: fixture.authCookieA, 'Content-Type': 'application/json' },
      payload: { action: 'click', payload: { x: 0.5, y: 0.5 } },
    })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.data.success).toBe(true)
  })

  // ─── 9. 400 invalid input (out-of-range coordinates) ─────────────────────────
  it('POST /browser/input returns 400 for out-of-range coordinates (x=2)', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    // Takeover first so we get past the lease check
    const takeover = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/takeover`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(takeover.statusCode).toBe(200)

    const response = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/input`,
      headers: { Cookie: fixture.authCookieA, 'Content-Type': 'application/json' },
      payload: { action: 'click', payload: { x: 2, y: 0.5 } },
    })
    expect(response.statusCode).toBe(400)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('INVALID_INPUT')
  })

  // ─── 10. SSE snapshot ────────────────────────────────────────────────────────
  it('GET /browser/frame/stream emits snapshot as first event with text/event-stream content-type', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    try {
      const response = await fetch(`${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/frame/stream`, {
        headers: { Cookie: fixture.authCookieA },
        signal: controller.signal,
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let chunks = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks += decoder.decode(value, { stream: true })
        if (chunks.includes('"type":"snapshot"')) break
      }

      expect(chunks).toContain('"type":"snapshot"')
      expect(chunks).toContain('data:')

      await closeSseReader(reader)
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  // ─── 11. SSE heartbeat ───────────────────────────────────────────────────────
  it('GET /browser/frame/stream emits heartbeat event', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    const controller = new AbortController()
    // Heartbeat interval is 5000ms; allow 5500ms to receive it.
    const timeout = setTimeout(() => controller.abort(), 8000)

    try {
      const response = await fetch(`${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/frame/stream`, {
        headers: { Cookie: fixture.authCookieA },
        signal: controller.signal,
      })

      expect(response.status).toBe(200)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let chunks = ''
      let receivedHeartbeat = false

      const readPromise = (async () => {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          if (chunks.includes('"type":"heartbeat"')) {
            receivedHeartbeat = true
            break
          }
        }
      })()

      await Promise.race([
        readPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout waiting for heartbeat')), 7000)),
      ])

      expect(receivedHeartbeat).toBe(true)
      expect(chunks).toContain('"type":"heartbeat"')

      await closeSseReader(reader)
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  // ─── 12. SSE cleanup ─────────────────────────────────────────────────────────
  it('closing SSE connection cleans up the frame stream subscription', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    // Wrap the real subscribe to capture the per-subscriber cleanup function
    // returned to writeFrameSseStream. The cleanup function is what the SSE
    // handler invokes on disconnect (the legacy unsubscribe(sessionId) path is
    // no longer used for per-connection teardown).
    const frameStream = fixture.context.browserFrameStream!
    const realSubscribe = frameStream.subscribe.bind(frameStream)
    let capturedCleanup: (() => void) | null = null
    const subscribeSpy = vi.spyOn(frameStream, 'subscribe').mockImplementation((sid, callback) => {
      const cleanup = realSubscribe(sid, callback)
      // Wrap the cleanup so the test can observe whether it was invoked.
      const wrapped = vi.fn(cleanup)
      capturedCleanup = wrapped
      return wrapped
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    try {
      const response = await fetch(`${fixture.baseUrl}/api/v1/sessions/${sessionId}/browser/frame/stream`, {
        headers: { Cookie: fixture.authCookieA },
        signal: controller.signal,
      })

      expect(response.status).toBe(200)

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      // Read the snapshot first so the connection is established.
      const { value } = await reader.read()
      const text = decoder.decode(value)
      expect(text).toContain('"type":"snapshot"')

      // Close the connection by aborting the controller.
      await closeSseReader(reader)
      controller.abort()

      // Give the server a moment to process the 'close' event and invoke the
      // per-subscriber cleanup function returned by subscribe.
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(capturedCleanup).not.toBeNull()
      expect(capturedCleanup).toHaveBeenCalled()
      subscribeSpy.mockRestore()
    } finally {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  // ─── 13. agent-request-takeover ──────────────────────────────────────────────
  it('POST /browser/agent-request-takeover returns 200 with handoff_requested state', async () => {
    const sessionId = await createSession(fixture, fixture.authCookieA)
    await createBrowserSession(fixture, sessionId)

    const response = await fixture.server.inject({
      method: 'POST',
      url: `/api/v1/sessions/${sessionId}/browser/agent-request-takeover`,
      headers: { Cookie: fixture.authCookieA },
    })
    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.ok).toBe(true)
    expect(body.data.sessionId).toBe(sessionId)
    // The endpoint transitions the session to handoff_requested (without
    // creating a lease) so a human user can subsequently call /takeover.
    expect(body.data.state).toBe('handoff_requested')
  })
})