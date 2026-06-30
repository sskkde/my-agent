// allow: SIZE_OK — single-file deliverable required by task spec; the class is
// cohesive (one responsibility: browser session lifecycle) and splitting would
// scatter the branded-id helpers, result types, and error class across files
// that have no second caller.

import { randomUUID } from 'node:crypto'
import type { BrowserContext, Page } from 'playwright-core'
import type { CloakBrowserProvider } from './cloakbrowser-launcher.js'
import type {
  BrowserSessionId,
  BrowserSessionConfig,
  BrowserSessionMeta,
  LeaseId,
  OwnershipState,
  TakeoverLease,
  TakeoverLeaseConfig,
  UserId,
  Viewport,
} from './browser-session-types.js'
import {
  createDefaultBrowserSessionConfig,
  createDefaultTakeoverLeaseConfig,
  isTerminalOwnershipState,
  validateBrowserSessionTransition,
} from './browser-session-types.js'

// ─── Branded type constructors ──────────────────────────────────────────────
// The branded types in browser-session-types.ts are nominal; the only safe way
// to produce one is to cast through the branded boundary at the trust edge
// (here, where we generate or accept a session/lease/user id).

function asSessionId(value: string): BrowserSessionId {
  return value as BrowserSessionId
}

function asLeaseId(value: string): LeaseId {
  return value as LeaseId
}

function asUserId(value: string): UserId {
  return value as UserId
}

// ─── Internal session entry ──────────────────────────────────────────────────
// Mutable internally; the public `BrowserSessionMeta` returned to callers is
// always a fresh readonly snapshot built from this entry.

interface SessionEntry {
  readonly sessionId: BrowserSessionId
  ownership: OwnershipState
  url: string | null
  readonly viewport: Viewport
  readonly createdAt: string
  lastActivityAt: string
  lease: TakeoverLease | null
  readonly page: Page
  readonly context: BrowserContext
}

// ─── Result shapes ──────────────────────────────────────────────────────────

export interface TakeoverResult {
  readonly success: boolean
  readonly lease?: TakeoverLease
  readonly error?: string
}

export interface ReleaseResult {
  readonly success: boolean
  readonly error?: string
}

export interface HandoffResult {
  readonly success: boolean
  readonly error?: string
}

export interface InputAuthorizationResult {
  readonly authorized: boolean
}

export interface SessionStatus {
  readonly ownership: OwnershipState
  readonly url: string | null
  readonly lastActivityAt: string
}

// ─── Errors ──────────────────────────────────────────────────────────────────

class BrowserSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    // Include the code in the message so callers matching on the code via
    // regex (e.g. `/MAX_SESSIONS_REACHED/`) succeed without inspecting the
    // non-standard `code` property.
    super(`[${code}] ${message}`)
    this.name = 'BrowserSessionError'
  }
}

// ─── Module-level logger ─────────────────────────────────────────────────────
// Best-effort structured logging for transition/dispose errors that previously
// were swallowed by empty catches. Falls back to console when no platform
// logger is wired in.

type SessionManagerLogger = {
  warn(message: string, fields?: Record<string, unknown>): void
}

let sessionManagerLogger: SessionManagerLogger = {
  warn(message, fields) {
    // eslint-disable-next-line no-console
    console.warn(`[BrowserSessionManager] ${message}`, fields ?? {})
  },
}

/** Inject a platform logger (e.g. pino). When unset, falls back to console. */
export function setSessionManagerLogger(logger: SessionManagerLogger): void {
  sessionManagerLogger = logger
}

// ─── Manager ─────────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of isolated browser sessions backed by a shared
 * `CloakBrowserProvider`. Each session gets its own `BrowserContext` and
 * `Page`. The manager enforces a max-session cap, an idle-timeout cleanup
 * loop, and exclusive takeover leases with a TTL.
 *
 * The manager stores only metadata and live Playwright handles. It never
 * persists frame bytes and never exposes CDP/debug handles.
 */
export class BrowserSessionManager {
  private readonly provider: CloakBrowserProvider
  private readonly sessionConfig: BrowserSessionConfig
  private readonly leaseConfig: TakeoverLeaseConfig
  private readonly sessions: Map<BrowserSessionId, SessionEntry> = new Map()
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private static readonly IDLE_CHECK_INTERVAL_MS = 10_000

  constructor(
    provider: CloakBrowserProvider,
    sessionConfig: BrowserSessionConfig = createDefaultBrowserSessionConfig(),
    leaseConfig: TakeoverLeaseConfig = createDefaultTakeoverLeaseConfig(),
  ) {
    this.provider = provider
    this.sessionConfig = sessionConfig
    this.leaseConfig = leaseConfig
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Create a new isolated browser session. Rejects if the max-session cap has
   * been reached. The session starts in the `agent_controlled` ownership state.
   */
  async createSession(sessionId: BrowserSessionId): Promise<BrowserSessionMeta> {
    this.enforceMaxSessions()

    if (this.sessions.has(sessionId)) {
      throw new BrowserSessionError('SESSION_ALREADY_EXISTS', `Session ${sessionId} already exists`)
    }

    const browser = await this.provider.getBrowser()
    const context = await browser.newContext({ viewport: this.sessionConfig.viewport })
    const page = await context.newPage()

    const now = new Date().toISOString()
    const entry: SessionEntry = {
      sessionId,
      ownership: 'agent_controlled',
      url: null,
      viewport: this.sessionConfig.viewport,
      createdAt: now,
      lastActivityAt: now,
      lease: null,
      page,
      context,
    }
    this.sessions.set(sessionId, entry)

    // Surface page crashes as terminal `error` state.
    page.on('crash', () => {
      this.handlePageCrash(sessionId)
    })

    return this.snapshotMeta(entry)
  }

  /**
   * Return metadata for a session, or `null` if it does not exist.
   */
  getSession(sessionId: BrowserSessionId): BrowserSessionMeta | null {
    const entry = this.sessions.get(sessionId)
    return entry ? this.snapshotMeta(entry) : null
  }

  /**
   * Return the live Playwright `Page` for a session, or `null` if it does not
   * exist. The page is the same instance stored internally; callers must not
   * close it.
   */
  getPage(sessionId: BrowserSessionId): Page | null {
    return this.sessions.get(sessionId)?.page ?? null
  }

  /**
   * Return a compact status snapshot for a session, or `null` if it does not
   * exist.
   */
  getStatus(sessionId: BrowserSessionId): SessionStatus | null {
    const entry = this.sessions.get(sessionId)
    if (!entry) return null
    return {
      ownership: entry.ownership,
      url: entry.url,
      lastActivityAt: entry.lastActivityAt,
    }
  }

  /**
   * Request a human takeover of a session. Transitions the session to
   * `human_controlled` and grants an exclusive lease with a TTL to the
   * requesting user. A second takeover while a lease is active is rejected as
   * a conflict.
   *
   * Supports two entry states: `agent_controlled` (transitions through
   * `handoff_requested` → `human_controlled`) and `handoff_requested`
   * (transitions directly to `human_controlled`, the path used after an agent
   * has called {@link requestHandoff}).
   */
  async requestTakeover(sessionId: BrowserSessionId, userId: string): Promise<TakeoverResult> {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return { success: false, error: 'SESSION_NOT_FOUND' }
    }

    if (entry.lease !== null) {
      return { success: false, error: 'LEASE_CONFLICT' }
    }

    try {
      if (entry.ownership !== 'handoff_requested') {
        this.transitionState(sessionId, 'handoff_requested')
      }
      this.transitionState(sessionId, 'human_controlled')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TRANSITION_FAILED'
      return { success: false, error: message }
    }

    const now = Date.now()
    const acquiredAt = new Date(now).toISOString()
    const expiresAt = new Date(now + this.leaseConfig.defaultTtlMs).toISOString()
    const lease: TakeoverLease = {
      leaseId: asLeaseId(randomUUID()),
      userId: asUserId(userId),
      sessionId,
      acquiredAt,
      expiresAt,
    }
    entry.lease = lease
    this.touchSession(sessionId)

    return { success: true, lease }
  }

  /**
   * Request a human handoff for a session WITHOUT creating a lease. Transitions
   * `agent_controlled → handoff_requested` and leaves the session in that state
   * so a human user can subsequently call {@link requestTakeover} to acquire
   * the lease. This is the agent-side signal that human help is needed; the
   * actual lease grant happens on the user-side takeover.
   */
  requestHandoff(sessionId: BrowserSessionId): HandoffResult {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return { success: false, error: 'SESSION_NOT_FOUND' }
    }

    if (entry.lease !== null) {
      return { success: false, error: 'LEASE_CONFLICT' }
    }

    try {
      this.transitionState(sessionId, 'handoff_requested')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TRANSITION_FAILED'
      return { success: false, error: message }
    }

    this.touchSession(sessionId)
    return { success: true }
  }

  /**
   * Release a takeover lease. Only the current lease holder may release.
   * Transitions the session through `resuming` → `agent_controlled` and
   * clears the lease.
   */
  async releaseTakeover(sessionId: BrowserSessionId, userId: string): Promise<ReleaseResult> {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return { success: false, error: 'SESSION_NOT_FOUND' }
    }

    if (entry.lease === null) {
      return { success: false, error: 'NO_ACTIVE_LEASE' }
    }

    if (entry.lease.userId !== asUserId(userId)) {
      return { success: false, error: 'NOT_LEASE_HOLDER' }
    }

    try {
      this.transitionState(sessionId, 'resuming')
      this.transitionState(sessionId, 'agent_controlled')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'TRANSITION_FAILED'
      return { success: false, error: message }
    }

    entry.lease = null
    this.touchSession(sessionId)

    return { success: true }
  }

  /**
   * Check whether a user is authorized to send input to a session (i.e. they
   * hold the active lease and the lease has not expired).
   */
  async sendInput(sessionId: BrowserSessionId, userId: string): Promise<InputAuthorizationResult> {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      return { authorized: false }
    }

    if (entry.lease === null) {
      return { authorized: false }
    }

    if (entry.lease.userId !== asUserId(userId)) {
      return { authorized: false }
    }

    if (Date.parse(entry.lease.expiresAt) <= Date.now()) {
      // Expired lease — clean up and deny.
      this.expireLease(sessionId)
      return { authorized: false }
    }

    this.touchSession(sessionId)
    return { authorized: true }
  }

  /**
   * Close a single session. Transitions to `closed` and releases the page and
   * context. Safe to call on an already-closed or missing session.
   */
  async closeSession(sessionId: BrowserSessionId): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    if (!isTerminalOwnershipState(entry.ownership)) {
      this.transitionState(sessionId, 'closed')
    }

    await this.disposeEntry(entry)
    this.sessions.delete(sessionId)
  }

  /**
   * Close every active session. Also stops the idle-cleanup interval so the
   * timer does not fire against the empty session map after teardown.
   */
  async closeAll(): Promise<void> {
    this.stopIdleCleanup()
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map((id) => this.closeSession(id)))
  }

  /**
   * Start the idle-cleanup interval. Sessions whose `lastActivityAt` is older
   * than `idleTimeoutMs` and which are not under an active takeover lease are
   * closed. Also expires leases past their TTL on each tick.
   */
  startIdleCleanup(): void {
    if (this.idleTimer !== null) return
    this.idleTimer = setInterval(() => {
      void this.checkLeaseExpiry()
      void this.closeIdleSessions()
    }, BrowserSessionManager.IDLE_CHECK_INTERVAL_MS)
  }

  /**
   * Stop the idle-cleanup interval.
   */
  stopIdleCleanup(): void {
    if (this.idleTimer !== null) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Build a readonly `BrowserSessionMeta` snapshot from an internal entry.
   */
  private snapshotMeta(entry: SessionEntry): BrowserSessionMeta {
    return {
      sessionId: entry.sessionId,
      ownership: entry.ownership,
      url: entry.url,
      viewport: entry.viewport,
      createdAt: entry.createdAt,
      lastActivityAt: entry.lastActivityAt,
      lease: entry.lease,
    }
  }

  /**
   * Reject if the number of sessions has reached the configured maximum.
   */
  private enforceMaxSessions(): void {
    if (this.sessions.size >= this.sessionConfig.maxSessions) {
      throw new BrowserSessionError(
        'MAX_SESSIONS_REACHED',
        `Cannot create session: max ${this.sessionConfig.maxSessions} sessions reached`,
      )
    }
  }

  /**
   * Validate and apply a state transition. Throws `BrowserSessionError` if the
   * transition is not allowed by the ownership state machine.
   */
  private transitionState(sessionId: BrowserSessionId, to: OwnershipState): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      throw new BrowserSessionError('SESSION_NOT_FOUND', `Session ${sessionId} not found`)
    }

    const from = entry.ownership
    const result = validateBrowserSessionTransition(from, to)
    if (!result.valid) {
      throw new BrowserSessionError(
        result.error?.code ?? 'TRANSITION_FAILED',
        result.error?.message ?? `Transition ${from} → ${to} not allowed`,
      )
    }

    entry.ownership = to
  }

  /**
   * Update `lastActivityAt` for a session to the current time.
   */
  private touchSession(sessionId: BrowserSessionId): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    entry.lastActivityAt = new Date().toISOString()
  }

  /**
   * Expire a lease whose TTL has elapsed. Transitions the session back through
   * `resuming` → `agent_controlled` and clears the lease.
   */
  private expireLease(sessionId: BrowserSessionId): void {
    const entry = this.sessions.get(sessionId)
    if (!entry || entry.lease === null) return

    try {
      this.transitionState(sessionId, 'resuming')
      this.transitionState(sessionId, 'agent_controlled')
    } catch (err) {
      // If the transition fails (e.g. session already terminal), just drop the
      // lease. The error is accounted so it is not silently swallowed.
      sessionManagerLogger.warn('expireLease transition failed; dropping lease', {
        sessionId,
        ownership: entry.ownership,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    entry.lease = null
  }

  /**
   * Sweep all sessions and expire any lease past its TTL.
   */
  private async checkLeaseExpiry(): Promise<void> {
    const now = Date.now()
    for (const [sessionId, entry] of this.sessions) {
      if (entry.lease === null) continue
      if (Date.parse(entry.lease.expiresAt) <= now) {
        this.expireLease(sessionId)
      }
    }
  }

  /**
   * Sweep all sessions and close any whose idle timeout has elapsed and which
   * are not under an active (non-expired) lease.
   */
  private async closeIdleSessions(): Promise<void> {
    const now = Date.now()
    const toClose: BrowserSessionId[] = []
    for (const [sessionId, entry] of this.sessions) {
      if (isTerminalOwnershipState(entry.ownership)) continue
      if (entry.lease !== null && Date.parse(entry.lease.expiresAt) > now) continue
      const lastActivity = Date.parse(entry.lastActivityAt)
      if (now - lastActivity >= this.sessionConfig.idleTimeoutMs) {
        toClose.push(sessionId)
      }
    }
    await Promise.all(toClose.map((id) => this.closeSession(id)))
  }

  /**
   * Handle a Playwright `page.on('crash')` event by transitioning the session
   * to the terminal `error` state.
   */
  private handlePageCrash(sessionId: BrowserSessionId): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    if (isTerminalOwnershipState(entry.ownership)) return
    try {
      this.transitionState(sessionId, 'error')
    } catch (err) {
      // Already terminal — nothing to do, but account the error.
      sessionManagerLogger.warn('handlePageCrash transition failed; already terminal', {
        sessionId,
        ownership: entry.ownership,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Close the page and context backing a session entry. Errors are accounted
   * via the module logger; the session is being torn down regardless.
   */
  private async disposeEntry(entry: SessionEntry): Promise<void> {
    await entry.page.close().catch((err: unknown) => {
      // best-effort cleanup: page close errors are ignored because the session
      // is being torn down regardless. Logged so the failure is observable.
      sessionManagerLogger.warn('page.close failed during dispose', {
        sessionId: entry.sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    await entry.context.close().catch((err: unknown) => {
      // best-effort cleanup: context close errors are ignored because the
      // session is being torn down regardless. Logged so the failure is
      // observable.
      sessionManagerLogger.warn('context.close failed during dispose', {
        sessionId: entry.sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  }
}

// ─── Public helpers for callers that need to construct branded ids ───────────

/**
 * Construct a `BrowserSessionId` from a plain string. Use only at the trust
 * boundary (e.g. when receiving a session id from an authenticated API route).
 */
export function toBrowserSessionId(value: string): BrowserSessionId {
  return asSessionId(value)
}

/**
 * Construct a `UserId` from a plain string. Use only at the trust boundary.
 */
export function toUserId(value: string): UserId {
  return asUserId(value)
}

export type { Viewport }