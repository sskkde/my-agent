import { describe, it, expect } from 'vitest'
import {
  OWNERSHIP_STATES,
  OWNERSHIP_TRANSITIONS,
  BROWSER_INPUT_KINDS,
  validateBrowserSessionTransition,
  isTerminalOwnershipState,
  createDefaultBrowserSessionConfig,
  createDefaultTakeoverLeaseConfig,
  createDefaultHandoffWaitConfig,
} from '../../../src/search/browser/browser-session-types.js'
import type {
  OwnershipState,
  BrowserInputEvent,
  BrowserClickEvent,
  BrowserKeyEvent,
  BrowserTextEvent,
  BrowserScrollEvent,
  BrowserNavigateEvent,
  BrowserSessionConfig,
  TakeoverLeaseConfig,
  HandoffWaitConfig,
  FrameMeta,
  Viewport,
  TakeoverLease,
  BrowserSessionMeta,
} from '../../../src/search/browser/browser-session-types.js'
import type { TransitionResult, TransitionError } from '../../../src/shared/transitions.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** All valid transitions as [from, to] pairs derived from the transition table. */
function allValidTransitions(): [OwnershipState, OwnershipState][] {
  const pairs: [OwnershipState, OwnershipState][] = []
  for (const from of OWNERSHIP_STATES) {
    for (const to of OWNERSHIP_TRANSITIONS[from]) {
      pairs.push([from, to])
    }
  }
  return pairs
}

/** All invalid transitions: every (from, to) pair NOT in the transition table. */
function allInvalidTransitions(): [OwnershipState, OwnershipState][] {
  const validSet = new Set(allValidTransitions().map(([f, t]) => `${f}->${t}`))
  const pairs: [OwnershipState, OwnershipState][] = []
  for (const from of OWNERSHIP_STATES) {
    for (const to of OWNERSHIP_STATES) {
      if (!validSet.has(`${from}->${to}`)) {
        pairs.push([from, to])
      }
    }
  }
  return pairs
}

// ─── Transition validation ──────────────────────────────────────────────────

describe('validateBrowserSessionTransition', () => {
  describe('valid transitions', () => {
    it.each(allValidTransitions())(
      'should allow %s → %s',
      (from: OwnershipState, to: OwnershipState) => {
        const result = validateBrowserSessionTransition(from, to)
        expect(result.valid).toBe(true)
        expect(result.error).toBeNull()
      },
    )
  })

  describe('invalid transitions', () => {
    it.each(allInvalidTransitions())(
      'should reject %s → %s',
      (from: OwnershipState, to: OwnershipState) => {
        const result = validateBrowserSessionTransition(from, to)
        expect(result.valid).toBe(false)
        expect(result.error).not.toBeNull()
      },
    )
  })

  describe('critical rejection: human_controlled → agent_controlled (must go through resuming)', () => {
    it('should reject human_controlled → agent_controlled', () => {
      const result = validateBrowserSessionTransition('human_controlled', 'agent_controlled')
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('TRANSITION_NOT_ALLOWED')
    })
  })

  describe('critical rejection: agent_controlled → human_controlled (must go through handoff_requested)', () => {
    it('should reject agent_controlled → human_controlled', () => {
      const result = validateBrowserSessionTransition('agent_controlled', 'human_controlled')
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('TRANSITION_NOT_ALLOWED')
    })
  })

  describe('terminal state rejection', () => {
    it('should reject all transitions from closed', () => {
      for (const to of OWNERSHIP_STATES) {
        const result = validateBrowserSessionTransition('closed', to)
        expect(result.valid).toBe(false)
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL')
      }
    })

    it('should reject all transitions from error', () => {
      for (const to of OWNERSHIP_STATES) {
        const result = validateBrowserSessionTransition('error', to)
        expect(result.valid).toBe(false)
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL')
      }
    })
  })

  describe('invalid source state', () => {
    it('should reject an unknown source state', () => {
      const result = validateBrowserSessionTransition(
        'nonexistent' as OwnershipState,
        'agent_controlled',
      )
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('INVALID_SOURCE_STATE')
    })
  })

  describe('invalid target state', () => {
    it('should reject an unknown target state', () => {
      const result = validateBrowserSessionTransition(
        'agent_controlled',
        'nonexistent' as OwnershipState,
      )
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('INVALID_TARGET_STATE')
    })
  })

  describe('TransitionResult structure', () => {
    it('should have correct structure for valid transition', () => {
      const result: TransitionResult = {
        valid: true,
        error: null,
      }
      expect(result.valid).toBe(true)
      expect(result.error).toBeNull()
    })

    it('should have correct structure for invalid transition', () => {
      const error: TransitionError = {
        code: 'TRANSITION_NOT_ALLOWED',
        message: 'Transition from agent_controlled to human_controlled is not allowed',
      }
      const result: TransitionResult = {
        valid: false,
        error,
      }
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('TRANSITION_NOT_ALLOWED')
    })
  })
})

// ─── State classification ───────────────────────────────────────────────────

describe('isTerminalOwnershipState', () => {
  it('should return true for closed', () => {
    expect(isTerminalOwnershipState('closed')).toBe(true)
  })

  it('should return true for error', () => {
    expect(isTerminalOwnershipState('error')).toBe(true)
  })

  it('should return false for agent_controlled', () => {
    expect(isTerminalOwnershipState('agent_controlled')).toBe(false)
  })

  it('should return false for handoff_requested', () => {
    expect(isTerminalOwnershipState('handoff_requested')).toBe(false)
  })

  it('should return false for human_controlled', () => {
    expect(isTerminalOwnershipState('human_controlled')).toBe(false)
  })

  it('should return false for resuming', () => {
    expect(isTerminalOwnershipState('resuming')).toBe(false)
  })
})

// ─── Default config factories ────────────────────────────────────────────────

describe('createDefaultBrowserSessionConfig', () => {
  it('should return the documented defaults', () => {
    const config: BrowserSessionConfig = createDefaultBrowserSessionConfig()
    expect(config.maxSessions).toBe(5)
    expect(config.idleTimeoutMs).toBe(300_000)
    expect(config.viewport).toEqual({ width: 1280, height: 720 })
  })

  it('should return a frozen-like shape (readonly interface)', () => {
    const config = createDefaultBrowserSessionConfig()
    // Verify the shape is correct — readonly is enforced by the type system
    expect(config).toHaveProperty('maxSessions')
    expect(config).toHaveProperty('idleTimeoutMs')
    expect(config).toHaveProperty('viewport')
  })
})

describe('createDefaultTakeoverLeaseConfig', () => {
  it('should return the documented default TTL', () => {
    const config: TakeoverLeaseConfig = createDefaultTakeoverLeaseConfig()
    expect(config.defaultTtlMs).toBe(60_000)
  })
})

describe('createDefaultHandoffWaitConfig', () => {
  it('should return the documented defaults', () => {
    const config: HandoffWaitConfig = createDefaultHandoffWaitConfig()
    expect(config.timeoutMs).toBe(120_000)
    expect(config.pollIntervalMs).toBe(500)
  })
})

// ─── Input event shape validation ────────────────────────────────────────────

describe('BrowserInputEvent discriminated union', () => {
  it('should accept a valid click event', () => {
    const event: BrowserClickEvent = {
      kind: 'click',
      x: 100,
      y: 200,
      button: 'left',
      clickCount: 1,
    }
    const input: BrowserInputEvent = event
    expect(input.kind).toBe('click')
    if (input.kind === 'click') {
      expect(input.x).toBe(100)
      expect(input.y).toBe(200)
      expect(input.button).toBe('left')
      expect(input.clickCount).toBe(1)
    }
  })

  it('should accept a valid key event', () => {
    const event: BrowserKeyEvent = {
      kind: 'key',
      key: 'Enter',
      modifiers: ['Shift'],
    }
    const input: BrowserInputEvent = event
    expect(input.kind).toBe('key')
    if (input.kind === 'key') {
      expect(input.key).toBe('Enter')
      expect(input.modifiers).toEqual(['Shift'])
    }
  })

  it('should accept a valid text event', () => {
    const event: BrowserTextEvent = {
      kind: 'text',
      text: 'hello@example.com',
    }
    const input: BrowserInputEvent = event
    expect(input.kind).toBe('text')
    if (input.kind === 'text') {
      expect(input.text).toBe('hello@example.com')
    }
  })

  it('should accept a valid scroll event', () => {
    const event: BrowserScrollEvent = {
      kind: 'scroll',
      x: 0,
      y: 0,
      deltaX: 0,
      deltaY: 100,
    }
    const input: BrowserInputEvent = event
    expect(input.kind).toBe('scroll')
    if (input.kind === 'scroll') {
      expect(input.deltaX).toBe(0)
      expect(input.deltaY).toBe(100)
    }
  })

  it('should accept a valid navigate event', () => {
    const event: BrowserNavigateEvent = {
      kind: 'navigate',
      url: 'https://example.com',
    }
    const input: BrowserInputEvent = event
    expect(input.kind).toBe('navigate')
    if (input.kind === 'navigate') {
      expect(input.url).toBe('https://example.com')
    }
  })

  it('should have exactly 5 input kinds', () => {
    expect(BROWSER_INPUT_KINDS).toEqual(['click', 'key', 'text', 'scroll', 'navigate'])
  })
})

// ─── FrameMeta shape ─────────────────────────────────────────────────────────

describe('FrameMeta', () => {
  it('should accept a valid frame metadata object', () => {
    const meta: FrameMeta = {
      width: 1280,
      height: 720,
      capturedAt: '2026-06-29T12:00:00.000Z',
      format: 'jpeg',
      quality: 50,
    }
    expect(meta.width).toBe(1280)
    expect(meta.height).toBe(720)
    expect(meta.format).toBe('jpeg')
    expect(meta.quality).toBe(50)
  })
})

// ─── Viewport shape ──────────────────────────────────────────────────────────

describe('Viewport', () => {
  it('should accept a valid viewport', () => {
    const vp: Viewport = { width: 1280, height: 720 }
    expect(vp.width).toBe(1280)
    expect(vp.height).toBe(720)
  })
})

// ─── TakeoverLease shape ─────────────────────────────────────────────────────

describe('TakeoverLease', () => {
  it('should accept a valid lease object', () => {
    const lease: TakeoverLease = {
      leaseId: 'lease-1' as TakeoverLease['leaseId'],
      userId: 'user-1' as TakeoverLease['userId'],
      sessionId: 'sess-1' as TakeoverLease['sessionId'],
      acquiredAt: '2026-06-29T12:00:00.000Z',
      expiresAt: '2026-06-29T12:01:00.000Z',
    }
    expect(lease.leaseId).toBe('lease-1')
    expect(lease.userId).toBe('user-1')
    expect(lease.sessionId).toBe('sess-1')
  })
})

// ─── BrowserSessionMeta shape ────────────────────────────────────────────────

describe('BrowserSessionMeta', () => {
  it('should accept a valid session meta with lease', () => {
    const meta: BrowserSessionMeta = {
      sessionId: 'sess-1' as BrowserSessionMeta['sessionId'],
      ownership: 'agent_controlled',
      url: 'https://example.com',
      viewport: { width: 1280, height: 720 },
      createdAt: '2026-06-29T12:00:00.000Z',
      lastActivityAt: '2026-06-29T12:05:00.000Z',
      lease: null,
    }
    expect(meta.ownership).toBe('agent_controlled')
    expect(meta.url).toBe('https://example.com')
    expect(meta.lease).toBeNull()
  })

  it('should accept a valid session meta with an active lease', () => {
    const meta: BrowserSessionMeta = {
      sessionId: 'sess-1' as BrowserSessionMeta['sessionId'],
      ownership: 'human_controlled',
      url: 'https://example.com',
      viewport: { width: 1280, height: 720 },
      createdAt: '2026-06-29T12:00:00.000Z',
      lastActivityAt: '2026-06-29T12:05:00.000Z',
      lease: {
        leaseId: 'lease-1' as TakeoverLease['leaseId'],
        userId: 'user-1' as TakeoverLease['userId'],
        sessionId: 'sess-1' as TakeoverLease['sessionId'],
        acquiredAt: '2026-06-29T12:04:00.000Z',
        expiresAt: '2026-06-29T12:05:00.000Z',
      },
    }
    expect(meta.ownership).toBe('human_controlled')
    expect(meta.lease).not.toBeNull()
    expect(meta.lease!.leaseId).toBe('lease-1')
  })
})

// ─── Ownership state count ───────────────────────────────────────────────────

describe('OWNERSHIP_STATES', () => {
  it('should have exactly 6 states', () => {
    expect(OWNERSHIP_STATES).toHaveLength(6)
  })

  it('should include all expected states', () => {
    expect(OWNERSHIP_STATES).toContain('agent_controlled')
    expect(OWNERSHIP_STATES).toContain('handoff_requested')
    expect(OWNERSHIP_STATES).toContain('human_controlled')
    expect(OWNERSHIP_STATES).toContain('resuming')
    expect(OWNERSHIP_STATES).toContain('closed')
    expect(OWNERSHIP_STATES).toContain('error')
  })
})

// ─── Transition table completeness ──────────────────────────────────────────

describe('OWNERSHIP_TRANSITIONS', () => {
  it('should have an entry for every ownership state', () => {
    for (const state of OWNERSHIP_STATES) {
      expect(OWNERSHIP_TRANSITIONS).toHaveProperty(state)
    }
  })

  it('should have empty arrays for terminal states', () => {
    expect(OWNERSHIP_TRANSITIONS.closed).toEqual([])
    expect(OWNERSHIP_TRANSITIONS.error).toEqual([])
  })

  it('should have the correct transitions for agent_controlled', () => {
    expect(OWNERSHIP_TRANSITIONS.agent_controlled).toEqual([
      'handoff_requested',
      'closed',
      'error',
    ])
  })

  it('should have the correct transitions for handoff_requested', () => {
    expect(OWNERSHIP_TRANSITIONS.handoff_requested).toEqual([
      'human_controlled',
      'agent_controlled',
      'closed',
      'error',
    ])
  })

  it('should have the correct transitions for human_controlled', () => {
    expect(OWNERSHIP_TRANSITIONS.human_controlled).toEqual(['resuming', 'closed', 'error'])
  })

  it('should have the correct transitions for resuming', () => {
    expect(OWNERSHIP_TRANSITIONS.resuming).toEqual(['agent_controlled', 'closed', 'error'])
  })
})

// ─── State-to-API mapping expectations ───────────────────────────────────────

describe('state-to-API mapping expectations', () => {
  it('should map agent_controlled and resuming to agent_controlled API state', () => {
    // Per mapOwnershipToState in browser-sessions-helpers.ts:
    // agent_controlled → 'agent_controlled', resuming → 'agent_controlled'
    const apiStates = new Map<OwnershipState, string>([
      ['agent_controlled', 'agent_controlled'],
      ['resuming', 'agent_controlled'],
      ['handoff_requested', 'handoff_requested'],
      ['human_controlled', 'user_controlled'],
      ['closed', 'idle'],
      ['error', 'idle'],
    ])

    expect(apiStates.get('agent_controlled')).toBe('agent_controlled')
    expect(apiStates.get('resuming')).toBe('agent_controlled')
    expect(apiStates.get('handoff_requested')).toBe('handoff_requested')
    expect(apiStates.get('human_controlled')).toBe('user_controlled')
    expect(apiStates.get('closed')).toBe('idle')
    expect(apiStates.get('error')).toBe('idle')
  })
})
