import type { TransitionResult, TransitionError } from '../../shared/transitions.js'

// ─── Branded types ───────────────────────────────────────────────────────────

declare const BRAND: unique symbol

/** Branded browser session identifier. */
export type BrowserSessionId = string & { readonly [BRAND]: 'BrowserSessionId' }

/** Branded takeover lease identifier. */
export type LeaseId = string & { readonly [BRAND]: 'LeaseId' }

/** Branded user identifier. */
export type UserId = string & { readonly [BRAND]: 'UserId' }

// ─── Ownership state machine ─────────────────────────────────────────────────

export const OWNERSHIP_STATES = [
  'agent_controlled',
  'handoff_requested',
  'human_controlled',
  'resuming',
  'closed',
  'error',
] as const

export type OwnershipState = (typeof OWNERSHIP_STATES)[number]

const TERMINAL_OWNERSHIP_STATES: readonly OwnershipState[] = ['closed', 'error']

/**
 * Pure transition table mapping each ownership state to its valid next states.
 *
 * Flow: agent_controlled → handoff_requested → human_controlled → resuming → agent_controlled
 * Terminal: closed, error (no outgoing transitions)
 */
export const OWNERSHIP_TRANSITIONS: Readonly<
  Record<OwnershipState, readonly OwnershipState[]>
> = {
  agent_controlled: ['handoff_requested', 'closed', 'error'],
  handoff_requested: ['human_controlled', 'agent_controlled', 'closed', 'error'],
  human_controlled: ['resuming', 'closed', 'error'],
  resuming: ['agent_controlled', 'closed', 'error'],
  closed: [],
  error: [],
}

// ─── Browser input events ────────────────────────────────────────────────────

export const BROWSER_INPUT_KINDS = ['click', 'key', 'text', 'scroll', 'navigate'] as const

export type BrowserInputKind = (typeof BROWSER_INPUT_KINDS)[number]

export interface BrowserClickEvent {
  readonly kind: 'click'
  readonly x: number
  readonly y: number
  readonly button: 'left' | 'middle' | 'right'
  readonly clickCount: number
}

export interface BrowserKeyEvent {
  readonly kind: 'key'
  readonly key: string
  readonly modifiers: readonly string[]
}

export interface BrowserTextEvent {
  readonly kind: 'text'
  readonly text: string
}

export interface BrowserScrollEvent {
  readonly kind: 'scroll'
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
}

export interface BrowserNavigateEvent {
  readonly kind: 'navigate'
  readonly url: string
}

export type BrowserInputEvent =
  | BrowserClickEvent
  | BrowserKeyEvent
  | BrowserTextEvent
  | BrowserScrollEvent
  | BrowserNavigateEvent

// ─── Frame metadata ──────────────────────────────────────────────────────────

export interface FrameMeta {
  readonly width: number
  readonly height: number
  readonly capturedAt: string
  readonly format: 'jpeg' | 'png'
  readonly quality: number
}

// ─── Configuration types ─────────────────────────────────────────────────────

export interface Viewport {
  readonly width: number
  readonly height: number
}

export interface BrowserSessionConfig {
  readonly maxSessions: number
  readonly idleTimeoutMs: number
  readonly viewport: Viewport
}

export interface TakeoverLeaseConfig {
  readonly defaultTtlMs: number
}

export interface HandoffWaitConfig {
  readonly timeoutMs: number
  readonly pollIntervalMs: number
}

// ─── Runtime domain objects ──────────────────────────────────────────────────

export interface TakeoverLease {
  readonly leaseId: LeaseId
  readonly userId: UserId
  readonly sessionId: BrowserSessionId
  readonly acquiredAt: string
  readonly expiresAt: string
}

export interface BrowserSessionMeta {
  readonly sessionId: BrowserSessionId
  readonly ownership: OwnershipState
  readonly url: string | null
  readonly viewport: Viewport
  readonly createdAt: string
  readonly lastActivityAt: string
  readonly lease: TakeoverLease | null
}

// ─── Transition validation ──────────────────────────────────────────────────

function createError(code: string, message: string): TransitionError {
  return { code, message }
}

function createSuccess(): TransitionResult {
  return { valid: true, error: null }
}

function createFailure(error: TransitionError): TransitionResult {
  return { valid: false, error }
}

/**
 * Validate a browser session ownership state transition.
 *
 * Uses the pure transition table {@link OWNERSHIP_TRANSITIONS} to determine
 * whether `to` is a valid next state from `from`.
 */
export function validateBrowserSessionTransition(
  from: OwnershipState,
  to: OwnershipState,
): TransitionResult {
  if (!OWNERSHIP_STATES.includes(from)) {
    return createFailure(
      createError('INVALID_SOURCE_STATE', `Invalid source state: ${from}`),
    )
  }
  if (!OWNERSHIP_STATES.includes(to)) {
    return createFailure(
      createError('INVALID_TARGET_STATE', `Invalid target state: ${to}`),
    )
  }

  if (TERMINAL_OWNERSHIP_STATES.includes(from)) {
    return createFailure(
      createError(
        'INVALID_FROM_TERMINAL',
        `Cannot transition from terminal state ${from}`,
      ),
    )
  }

  const allowed = OWNERSHIP_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return createFailure(
      createError(
        'TRANSITION_NOT_ALLOWED',
        `Transition from ${from} to ${to} is not allowed`,
      ),
    )
  }

  return createSuccess()
}

// ─── State classification helpers ───────────────────────────────────────────

/**
 * Returns `true` if the ownership state is terminal (closed or error).
 */
export function isTerminalOwnershipState(state: OwnershipState): boolean {
  return TERMINAL_OWNERSHIP_STATES.includes(state)
}

// ─── Default factory functions ───────────────────────────────────────────────

export function createDefaultBrowserSessionConfig(): BrowserSessionConfig {
  return {
    maxSessions: 5,
    idleTimeoutMs: 300_000,
    viewport: { width: 1280, height: 720 },
  }
}

export function createDefaultTakeoverLeaseConfig(): TakeoverLeaseConfig {
  return { defaultTtlMs: 60_000 }
}

export function createDefaultHandoffWaitConfig(): HandoffWaitConfig {
  return { timeoutMs: 120_000, pollIntervalMs: 500 }
}
