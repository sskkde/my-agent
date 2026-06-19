import { describe, it, expect } from 'vitest'
import type { AgentType } from '../../../src/context/types.js'
import type { LaunchSource } from '../../../src/taxonomy/launch-source-policy.js'
import {
  assertLaunchAllowed,
  isLaunchAllowed,
  getAllowedLaunchSources,
  isLaunchSource,
  LaunchPolicyError,
} from '../../../src/taxonomy/launch-source-policy.js'

// ── Helpers ─────────────────────────────────────────────────────────

const ALL_LAUNCH_SOURCES: LaunchSource[] = [
  'gateway_intent',
  'planner_execution',
  'workflow_step',
  'subagent_runtime',
  'background_subagent',
  'event_trigger_resume',
  'system',
]

// ── Tests ───────────────────────────────────────────────────────────

describe('LaunchSource type', () => {
  it('should recognize all documented launch source values', () => {
    for (const source of ALL_LAUNCH_SOURCES) {
      expect(isLaunchSource(source)).toBe(true)
    }
  })

  it('should reject unrecognized launch source strings', () => {
    expect(isLaunchSource('workflow_ui')).toBe(false)
    expect(isLaunchSource('remote_callback')).toBe(false)
    expect(isLaunchSource('')).toBe(false)
    expect(isLaunchSource('unknown_source')).toBe(false)
  })
})

describe('getAllowedLaunchSources', () => {
  it('main allows only gateway_intent', () => {
    expect(getAllowedLaunchSources('main')).toEqual(['gateway_intent'])
  })

  it('subagent allows subagent_runtime and planner_execution', () => {
    const sources = getAllowedLaunchSources('subagent')
    expect(sources).toContain('subagent_runtime')
    expect(sources).toContain('planner_execution')
    expect(sources).toHaveLength(2)
  })

  it('background allows background_subagent, event_trigger_resume, and system', () => {
    const sources = getAllowedLaunchSources('background')
    expect(sources).toContain('background_subagent')
    expect(sources).toContain('event_trigger_resume')
    expect(sources).toContain('system')
    expect(sources).toHaveLength(3)
  })

  it('workflow_step allows only workflow_step', () => {
    expect(getAllowedLaunchSources('workflow_step')).toEqual(['workflow_step'])
  })

  it('remote has no allowed launch sources (hard-deny)', () => {
    expect(getAllowedLaunchSources('remote')).toEqual([])
  })
})

describe('assertLaunchAllowed — valid pairs', () => {
  it('main + gateway_intent is allowed', () => {
    expect(() => assertLaunchAllowed('main', 'gateway_intent')).not.toThrow()
  })

  it('subagent + subagent_runtime is allowed', () => {
    expect(() => assertLaunchAllowed('subagent', 'subagent_runtime')).not.toThrow()
  })

  it('subagent + planner_execution is allowed', () => {
    expect(() => assertLaunchAllowed('subagent', 'planner_execution')).not.toThrow()
  })

  it('background + background_subagent is allowed', () => {
    expect(() => assertLaunchAllowed('background', 'background_subagent')).not.toThrow()
  })

  it('background + event_trigger_resume is allowed', () => {
    expect(() => assertLaunchAllowed('background', 'event_trigger_resume')).not.toThrow()
  })

  it('background + system is allowed', () => {
    expect(() => assertLaunchAllowed('background', 'system')).not.toThrow()
  })

  it('workflow_step + workflow_step is allowed', () => {
    expect(() => assertLaunchAllowed('workflow_step', 'workflow_step')).not.toThrow()
  })
})

describe('assertLaunchAllowed — invalid pairs (agentType mismatch)', () => {
  it('subagent + workflow_step is rejected', () => {
    expect(() => assertLaunchAllowed('subagent', 'workflow_step')).toThrow(LaunchPolicyError)
  })

  it('main + planner_execution is rejected', () => {
    expect(() => assertLaunchAllowed('main', 'planner_execution')).toThrow(LaunchPolicyError)
  })

  it('background + gateway_intent is rejected', () => {
    expect(() => assertLaunchAllowed('background', 'gateway_intent')).toThrow(LaunchPolicyError)
  })

  it('workflow_step + subagent_runtime is rejected', () => {
    expect(() => assertLaunchAllowed('workflow_step', 'subagent_runtime')).toThrow(LaunchPolicyError)
  })

  it('main + system is rejected', () => {
    expect(() => assertLaunchAllowed('main', 'system')).toThrow(LaunchPolicyError)
  })
})

describe('assertLaunchAllowed — remote agent type (hard-deny)', () => {
  it('remote + any launch source is rejected with LAUNCH_SOURCE_NOT_ALLOWED', () => {
    for (const source of ALL_LAUNCH_SOURCES) {
      expect(() => assertLaunchAllowed('remote', source)).toThrow(LaunchPolicyError)
      try {
        assertLaunchAllowed('remote', source)
      } catch (err) {
        expect(err).toBeInstanceOf(LaunchPolicyError)
        expect((err as LaunchPolicyError).code).toBe('LAUNCH_SOURCE_NOT_ALLOWED')
      }
    }
  })
})

describe('assertLaunchAllowed — unknown launch source', () => {
  it('workflow_ui is not a recognized LaunchSource', () => {
    expect(() => assertLaunchAllowed('subagent', 'workflow_ui')).toThrow(LaunchPolicyError)
    try {
      assertLaunchAllowed('subagent', 'workflow_ui')
    } catch (err) {
      expect(err).toBeInstanceOf(LaunchPolicyError)
      expect((err as LaunchPolicyError).code).toBe('UNKNOWN_LAUNCH_SOURCE')
    }
  })

  it('planner + workflow_ui scenario from taxonomy doc is rejected', () => {
    // Per AGENT_TAXONOMY_DRAFT.md §5.1:
    // { agentType: 'subagent', agentProfile: 'planner', launchSource: 'workflow_ui' }
    // is invalid — workflow_ui is not a recognized LaunchSource.
    // Correct: { agentType: 'workflow_step', agentProfile: 'planner', launchSource: 'workflow_step' }
    const agentType: AgentType = 'subagent'
    const launchSource = 'workflow_ui'

    expect(() => assertLaunchAllowed(agentType, launchSource)).toThrow(LaunchPolicyError)

    try {
      assertLaunchAllowed(agentType, launchSource)
    } catch (err) {
      const policyError = err as LaunchPolicyError
      expect(policyError.code).toBe('UNKNOWN_LAUNCH_SOURCE')
      expect(policyError.agentType).toBe('subagent')
      expect(policyError.launchSource).toBe('workflow_ui')
    }
  })

  it('empty string is rejected as unknown', () => {
    expect(() => assertLaunchAllowed('main', '')).toThrow(LaunchPolicyError)
    try {
      assertLaunchAllowed('main', '')
    } catch (err) {
      expect((err as LaunchPolicyError).code).toBe('UNKNOWN_LAUNCH_SOURCE')
    }
  })

  it('arbitrary string is rejected as unknown', () => {
    expect(() => assertLaunchAllowed('background', 'cron_trigger')).toThrow(LaunchPolicyError)
    try {
      assertLaunchAllowed('background', 'cron_trigger')
    } catch (err) {
      expect((err as LaunchPolicyError).code).toBe('UNKNOWN_LAUNCH_SOURCE')
    }
  })
})

describe('isLaunchAllowed — no-throw checks', () => {
  it('returns true for valid pairs', () => {
    expect(isLaunchAllowed('main', 'gateway_intent')).toBe(true)
    expect(isLaunchAllowed('subagent', 'planner_execution')).toBe(true)
    expect(isLaunchAllowed('background', 'system')).toBe(true)
    expect(isLaunchAllowed('workflow_step', 'workflow_step')).toBe(true)
  })

  it('returns false for invalid pairs', () => {
    expect(isLaunchAllowed('subagent', 'workflow_step')).toBe(false)
    expect(isLaunchAllowed('main', 'system')).toBe(false)
    expect(isLaunchAllowed('remote', 'gateway_intent')).toBe(false)
  })

  it('returns false for unknown launch sources', () => {
    expect(isLaunchAllowed('subagent', 'workflow_ui')).toBe(false)
    expect(isLaunchAllowed('main', '')).toBe(false)
  })
})

describe('LaunchPolicyError structure', () => {
  it('exposes code, agentType, and launchSource on the error instance', () => {
    try {
      assertLaunchAllowed('subagent', 'workflow_step')
      expect.fail('Expected LaunchPolicyError to be thrown')
    } catch (err) {
      const e = err as LaunchPolicyError
      expect(e.name).toBe('LaunchPolicyError')
      expect(e.code).toBe('LAUNCH_SOURCE_NOT_ALLOWED')
      expect(e.agentType).toBe('subagent')
      expect(e.launchSource).toBe('workflow_step')
      expect(e.message).toContain('workflow_step')
      expect(e.message).toContain('subagent')
    }
  })

  it('is an instance of Error', () => {
    try {
      assertLaunchAllowed('main', 'system')
      expect.fail('Expected LaunchPolicyError to be thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(LaunchPolicyError)
    }
  })
})
