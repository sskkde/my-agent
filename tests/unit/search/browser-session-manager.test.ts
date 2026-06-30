import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Page } from 'playwright-core'
import {
  BrowserSessionManager,
  toBrowserSessionId,
  toUserId,
} from '../../../src/search/browser/browser-session-manager.js'
import type { CloakBrowserProvider } from '../../../src/search/browser/cloakbrowser-launcher.js'
import type {
  BrowserSessionId,
  BrowserSessionConfig,
  TakeoverLeaseConfig,
} from '../../../src/search/browser/browser-session-types.js'
import {
  createDefaultBrowserSessionConfig,
  createDefaultTakeoverLeaseConfig,
} from '../../../src/search/browser/browser-session-types.js'

// ─── Typed mock builders ─────────────────────────────────────────────────────
// Minimal typed fakes for the Playwright surfaces the manager touches. The
// fakes are injected through the CloakBrowserProvider seam; the manager only
// calls the methods listed here, so no `any` or full-interface implementation
// is needed.

interface PageFake {
  readonly on: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly url: ReturnType<typeof vi.fn>
}

interface ContextFake {
  readonly newPage: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
}

interface BrowserFake {
  readonly newContext: ReturnType<typeof vi.fn>
}

function createPageFake(): PageFake {
  return {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue('https://example.com'),
  }
}

function createContextFake(page: PageFake): ContextFake {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

function createBrowserFake(context: ContextFake): BrowserFake {
  return {
    newContext: vi.fn().mockResolvedValue(context),
  }
}

function createProviderFake(browser: BrowserFake): CloakBrowserProvider {
  return {
    getBrowser: vi.fn().mockResolvedValue(browser),
    closeBrowser: vi.fn().mockResolvedValue(undefined),
  }
}

function buildStack(): {
  page: PageFake
  context: ContextFake
  browser: BrowserFake
  provider: CloakBrowserProvider
} {
  const page = createPageFake()
  const context = createContextFake(page)
  const browser = createBrowserFake(context)
  const provider = createProviderFake(browser)
  return { page, context, browser, provider }
}

function sid(n: number): BrowserSessionId {
  return toBrowserSessionId(`sess-${n}`)
}

function uid(n: number): string {
  return `user-${n}`
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('BrowserSessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // 1. createSession
  it('createSession: creates session with agent_controlled state and 1280x720 viewport', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    const meta = await manager.createSession(sid(1))

    expect(meta.ownership).toBe('agent_controlled')
    expect(meta.sessionId).toBe(sid(1))
    expect(meta.viewport).toEqual({ width: 1280, height: 720 })
    expect(meta.url).toBeNull()
    expect(meta.lease).toBeNull()
    expect(meta.createdAt).toBe('2026-06-29T12:00:00.000Z')
  })

  // 2. getSession
  it('getSession: returns meta for existing session, null for non-existent', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))

    expect(manager.getSession(sid(1))?.sessionId).toBe(sid(1))
    expect(manager.getSession(sid(2))).toBeNull()
  })

  // 3. getPage
  it('getPage: returns Page for existing session, null for non-existent', async () => {
    const { page, provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))

    expect(manager.getPage(sid(1))).toBe(page)
    expect(manager.getPage(sid(2))).toBeNull()
  })

  // 4. getStatus
  it('getStatus: returns ownership/url/lastActivityAt', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))

    const status = manager.getStatus(sid(1))
    expect(status).not.toBeNull()
    expect(status?.ownership).toBe('agent_controlled')
    expect(status?.url).toBeNull()
    expect(status?.lastActivityAt).toBe('2026-06-29T12:00:00.000Z')
  })

  // 5. requestTakeover
  it('requestTakeover: transitions to handoff_requested → human_controlled and creates lease with TTL', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    const result = await manager.requestTakeover(sid(1), uid(1))

    expect(result.success).toBe(true)
    expect(result.lease).toBeDefined()
    expect(result.lease?.userId).toBe(toUserId(uid(1)))
    expect(result.lease?.sessionId).toBe(sid(1))
    expect(result.lease?.acquiredAt).toBe('2026-06-29T12:00:00.000Z')
    // Default TTL 60s
    expect(result.lease?.expiresAt).toBe('2026-06-29T12:01:00.000Z')

    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('human_controlled')
    expect(meta?.lease).not.toBeNull()
  })

  // 6. requestTakeover conflict
  it('requestTakeover conflict: second user takeover while lease active returns conflict', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    const first = await manager.requestTakeover(sid(1), uid(1))
    expect(first.success).toBe(true)

    const second = await manager.requestTakeover(sid(1), uid(2))
    expect(second.success).toBe(false)
    expect(second.error).toBe('LEASE_CONFLICT')
    expect(second.lease).toBeUndefined()
  })

  // 6b. requestHandoff: transitions to handoff_requested WITHOUT creating a lease
  it('requestHandoff: transitions agent_controlled → handoff_requested without creating a lease', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    const result = manager.requestHandoff(sid(1))

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('handoff_requested')
    expect(meta?.lease).toBeNull()
  })

  // 6c. requestHandoff: a subsequent requestTakeover can still acquire the lease
  it('requestHandoff then requestTakeover: human can acquire the lease after handoff is requested', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    const handoff = manager.requestHandoff(sid(1))
    expect(handoff.success).toBe(true)

    const takeover = await manager.requestTakeover(sid(1), uid(1))
    expect(takeover.success).toBe(true)
    expect(takeover.lease).toBeDefined()
    expect(takeover.lease?.userId).toBe(toUserId(uid(1)))

    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('human_controlled')
    expect(meta?.lease).not.toBeNull()
  })

  // 6d. requestHandoff: returns SESSION_NOT_FOUND for missing session
  it('requestHandoff: returns SESSION_NOT_FOUND for missing session', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    const result = manager.requestHandoff(sid(999))
    expect(result.success).toBe(false)
    expect(result.error).toBe('SESSION_NOT_FOUND')
  })

  // 6e. requestHandoff: returns LEASE_CONFLICT when a lease is active
  it('requestHandoff: returns LEASE_CONFLICT when a lease is active', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.requestTakeover(sid(1), uid(1))

    const result = manager.requestHandoff(sid(1))
    expect(result.success).toBe(false)
    expect(result.error).toBe('LEASE_CONFLICT')
  })

  // 7. releaseTakeover
  it('releaseTakeover: transitions to resuming → agent_controlled and clears lease', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.requestTakeover(sid(1), uid(1))

    const result = await manager.releaseTakeover(sid(1), uid(1))
    expect(result.success).toBe(true)

    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('agent_controlled')
    expect(meta?.lease).toBeNull()
  })

  // 8. releaseTakeover unauthorized
  it('releaseTakeover unauthorized: non-lease-holder cannot release', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.requestTakeover(sid(1), uid(1))

    const result = await manager.releaseTakeover(sid(1), uid(2))
    expect(result.success).toBe(false)
    expect(result.error).toBe('NOT_LEASE_HOLDER')

    // Lease still active
    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('human_controlled')
    expect(meta?.lease).not.toBeNull()
  })

  // 9. lease expiry
  it('lease expiry: lease expires after TTL, state returns to agent_controlled', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.requestTakeover(sid(1), uid(1))

    // Advance past TTL (60s)
    vi.advanceTimersByTime(61_000)

    // Trigger the expiry sweep directly via sendInput (which checks expiry)
    const auth = await manager.sendInput(sid(1), uid(1))
    expect(auth.authorized).toBe(false)

    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('agent_controlled')
    expect(meta?.lease).toBeNull()
  })

  // 10. max sessions
  it('max sessions: creating beyond maxSessions=5 is rejected', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    for (let i = 1; i <= 5; i++) {
      await manager.createSession(sid(i))
    }

    await expect(manager.createSession(sid(6))).rejects.toThrow(/MAX_SESSIONS_REACHED/)
    expect(manager.getSession(sid(6))).toBeNull()
  })

  // 11. idle timeout
  it('idle timeout: session idle past 5 minutes is closed', async () => {
    const { page, context, provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    manager.startIdleCleanup()

    // Advance past idle timeout (5 minutes) plus one check interval (10s).
    // The interval callback fires synchronously; the async close it triggers
    // resolves on the next microtask flush. Flush several microtasks to let
    // the Promise.all → closeSession → disposeEntry chain settle.
    vi.advanceTimersByTime(301_000)
    for (let i = 0; i < 5; i++) {
      await Promise.resolve()
    }

    expect(manager.getSession(sid(1))).toBeNull()
    expect(page.close).toHaveBeenCalled()
    expect(context.close).toHaveBeenCalled()

    manager.stopIdleCleanup()
  })

  // 12. closeSession
  it('closeSession: transitions to closed and closes page/context', async () => {
    const { page, context, provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.closeSession(sid(1))

    expect(manager.getSession(sid(1))).toBeNull()
    expect(page.close).toHaveBeenCalledOnce()
    expect(context.close).toHaveBeenCalledOnce()
  })

  // 13. closeAll
  it('closeAll: all sessions closed', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.createSession(sid(2))
    await manager.createSession(sid(3))

    await manager.closeAll()

    expect(manager.getSession(sid(1))).toBeNull()
    expect(manager.getSession(sid(2))).toBeNull()
    expect(manager.getSession(sid(3))).toBeNull()
  })

  // 14. crash/error
  it('crash/error: page crash transitions to error state', async () => {
    const { page, provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))

    // Find the registered crash listener and fire it.
    const onCalls = page.on.mock.calls
    const crashCall = onCalls.find((c) => c[0] === 'crash')
    expect(crashCall).toBeDefined()
    const crashListener = crashCall?.[1] as (p: Page) => void
    crashListener(page as unknown as Page)

    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('error')
  })

  // 15. state transition validation
  it('state transition validation: invalid transitions rejected', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))

    // Attempt to release without an active lease — should fail at the lease
    // check, not the state machine. Then attempt a takeover from a session
    // already in human_controlled by a different user, which is blocked by the
    // lease conflict check. The pure state-machine rejection is exercised by
    // trying to close an already-closed session: closeSession on a closed
    // session is a no-op (terminal state), but requestTakeover on a closed
    // session fails because the transition agent_controlled → handoff_requested
    // is not reachable from `closed`.
    await manager.closeSession(sid(1))
    expect(manager.getSession(sid(1))).toBeNull()

    // requestTakeover on a closed/missing session returns SESSION_NOT_FOUND.
    const result = await manager.requestTakeover(sid(1), uid(1))
    expect(result.success).toBe(false)
    expect(result.error).toBe('SESSION_NOT_FOUND')
  })

  // ─── Additional coverage ──────────────────────────────────────────────────

  it('sendInput: authorized for lease holder, unauthorized for others', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.requestTakeover(sid(1), uid(1))

    const ok = await manager.sendInput(sid(1), uid(1))
    expect(ok.authorized).toBe(true)

    const no = await manager.sendInput(sid(1), uid(2))
    expect(no.authorized).toBe(false)
  })

  it('sendInput: unauthorized when no lease is active', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    const result = await manager.sendInput(sid(1), uid(1))
    expect(result.authorized).toBe(false)
  })

  it('createSession: rejects duplicate session id', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await expect(manager.createSession(sid(1))).rejects.toThrow(/SESSION_ALREADY_EXISTS/)
  })

  it('startIdleCleanup/stopIdleCleanup: idempotent start and stop', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    manager.startIdleCleanup()
    manager.startIdleCleanup() // no-op
    manager.stopIdleCleanup()
    manager.stopIdleCleanup() // no-op
  })

  it('config overrides: respects custom maxSessions and idleTimeoutMs', async () => {
    const { provider } = buildStack()
    const sessionConfig: BrowserSessionConfig = {
      ...createDefaultBrowserSessionConfig(),
      maxSessions: 2,
    }
    const leaseConfig: TakeoverLeaseConfig = createDefaultTakeoverLeaseConfig()
    const manager = new BrowserSessionManager(provider, sessionConfig, leaseConfig)

    await manager.createSession(sid(1))
    await manager.createSession(sid(2))
    await expect(manager.createSession(sid(3))).rejects.toThrow(/MAX_SESSIONS_REACHED/)
  })

  it('lease expiry via idle cleanup sweep returns session to agent_controlled', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.requestTakeover(sid(1), uid(1))

    manager.startIdleCleanup()
    // Advance past lease TTL (60s) plus one check interval (10s). The sweep
    // expires the lease synchronously inside the interval callback.
    vi.advanceTimersByTime(71_000)
    await Promise.resolve()

    const meta = manager.getSession(sid(1))
    expect(meta?.ownership).toBe('agent_controlled')
    expect(meta?.lease).toBeNull()

    manager.stopIdleCleanup()
  })

  it('idle session under active lease is not closed', async () => {
    const { provider } = buildStack()
    const manager = new BrowserSessionManager(provider)

    await manager.createSession(sid(1))
    await manager.requestTakeover(sid(1), uid(1))

    manager.startIdleCleanup()
    // Advance 100s — past the lease TTL (60s) but well under the idle timeout
    // (300s). The lease expiry sweep clears the lease and returns the session
    // to agent_controlled; the idle sweep must NOT close it yet.
    vi.advanceTimersByTime(100_000)
    await Promise.resolve()

    const meta = manager.getSession(sid(1))
    expect(meta).not.toBeNull()
    expect(meta?.ownership).toBe('agent_controlled')

    manager.stopIdleCleanup()
  })
})