import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  LifecycleScorer,
  applyLifecyclePolicy,
  isLifecyclePolicyEnabled,
  getLifecyclePolicyPhase,
} from '../../../src/memory/memory-lifecycle-scoring.js'
import type { LongTermMemoryRecord } from '../../../src/storage/long-term-memory-store.js'

function makeMemory(overrides: Partial<LongTermMemoryRecord> = {}): LongTermMemoryRecord {
  const now = new Date().toISOString()
  return {
    memoryId: 'mem-1',
    userId: 'user-1',
    memoryType: 'user_preference',
    content: { text: 'test' },
    sourceRefs: { transcriptRefs: ['t-1'] },
    scope: { visibility: 'private_user' },
    confidence: 0.9,
    importance: 'medium',
    sensitivity: 'low',
    lifecycle: { status: 'active', createdAt: now, updatedAt: now },
    retrieval: { keywords: ['test'], recallCount: 0 },
    ...overrides,
  }
}

describe('getLifecyclePolicyPhase', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.LIFECYCLE_POLICY_PHASE
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LIFECYCLE_POLICY_PHASE
    } else {
      process.env.LIFECYCLE_POLICY_PHASE = originalEnv
    }
  })

  it('default phase is score_only', () => {
    delete process.env.LIFECYCLE_POLICY_PHASE
    expect(getLifecyclePolicyPhase()).toBe('score_only')
  })

  it('returns low_priority_only when set', () => {
    process.env.LIFECYCLE_POLICY_PHASE = 'low_priority_only'
    expect(getLifecyclePolicyPhase()).toBe('low_priority_only')
  })

  it('returns full_rollout when set', () => {
    process.env.LIFECYCLE_POLICY_PHASE = 'full_rollout'
    expect(getLifecyclePolicyPhase()).toBe('full_rollout')
  })

  it('returns score_only for invalid values', () => {
    process.env.LIFECYCLE_POLICY_PHASE = 'invalid'
    expect(getLifecyclePolicyPhase()).toBe('score_only')
  })
})

describe('isLifecyclePolicyEnabled', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.LIFECYCLE_POLICY_ENABLED
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LIFECYCLE_POLICY_ENABLED
    } else {
      process.env.LIFECYCLE_POLICY_ENABLED = originalEnv
    }
  })

  it('returns false by default', () => {
    delete process.env.LIFECYCLE_POLICY_ENABLED
    expect(isLifecyclePolicyEnabled()).toBe(false)
  })

  it('returns true when set to "true"', () => {
    process.env.LIFECYCLE_POLICY_ENABLED = 'true'
    expect(isLifecyclePolicyEnabled()).toBe(true)
  })

  it('returns false for other values', () => {
    process.env.LIFECYCLE_POLICY_ENABLED = 'false'
    expect(isLifecyclePolicyEnabled()).toBe(false)

    process.env.LIFECYCLE_POLICY_ENABLED = '1'
    expect(isLifecyclePolicyEnabled()).toBe(false)
  })
})

describe('applyLifecyclePolicy', () => {
  let originalEnabledEnv: string | undefined
  let originalPhaseEnv: string | undefined

  beforeEach(() => {
    originalEnabledEnv = process.env.LIFECYCLE_POLICY_ENABLED
    originalPhaseEnv = process.env.LIFECYCLE_POLICY_PHASE
  })

  afterEach(() => {
    if (originalEnabledEnv === undefined) {
      delete process.env.LIFECYCLE_POLICY_ENABLED
    } else {
      process.env.LIFECYCLE_POLICY_ENABLED = originalEnabledEnv
    }
    if (originalPhaseEnv === undefined) {
      delete process.env.LIFECYCLE_POLICY_PHASE
    } else {
      process.env.LIFECYCLE_POLICY_PHASE = originalPhaseEnv
    }
  })

  describe('score_only phase', () => {
    it('score_only never transitions', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.2,
        recommendation: 'archive_candidate' as const,
        breakdown: { recency: 0.1, frequency: 0.1, importance: 0.25, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'score_only')

      expect(result.transitioned).toBe(false)
      expect(result.newStatus).toBe('active')
    })
  })

  describe('low_priority_only phase', () => {
    it('low_priority_only transitions archive_candidate to low_priority', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.2,
        recommendation: 'archive_candidate' as const,
        breakdown: { recency: 0.1, frequency: 0.1, importance: 0.25, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'low_priority_only')

      expect(result.transitioned).toBe(true)
      expect(result.newStatus).toBe('low_priority')
    })

    it('low_priority_only does not touch active memories', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.8,
        recommendation: 'active' as const,
        breakdown: { recency: 1.0, frequency: 0.9, importance: 1.0, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'low_priority_only')

      expect(result.transitioned).toBe(false)
      expect(result.newStatus).toBe('active')
    })

    it('low_priority_only does not touch low_priority recommendation', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.4,
        recommendation: 'low_priority' as const,
        breakdown: { recency: 0.5, frequency: 0.5, importance: 0.5, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'low_priority_only')

      expect(result.transitioned).toBe(false)
      expect(result.newStatus).toBe('active')
    })

    it('low_priority_only requires score < 0.3 for archive_candidate transition', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.299,
        recommendation: 'archive_candidate' as const,
        breakdown: { recency: 0.1, frequency: 0.1, importance: 0.25, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'low_priority_only')

      expect(result.transitioned).toBe(true)
      expect(result.newStatus).toBe('low_priority')
    })

    it('low_priority_only does not transition archive_candidate with score >= 0.3', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.3,
        recommendation: 'archive_candidate' as const,
        breakdown: { recency: 0.3, frequency: 0.3, importance: 0.3, relevance: 0.3 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'low_priority_only')

      expect(result.transitioned).toBe(false)
      expect(result.newStatus).toBe('active')
    })
  })

  describe('full_rollout phase', () => {
    it('full_rollout archives archive_candidate', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.2,
        recommendation: 'archive_candidate' as const,
        breakdown: { recency: 0.1, frequency: 0.1, importance: 0.25, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'full_rollout')

      expect(result.transitioned).toBe(true)
      expect(result.newStatus).toBe('archived')
    })

    it('full_rollout sets low_priority', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.4,
        recommendation: 'low_priority' as const,
        breakdown: { recency: 0.5, frequency: 0.5, importance: 0.5, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'full_rollout')

      expect(result.transitioned).toBe(true)
      expect(result.newStatus).toBe('low_priority')
    })

    it('full_rollout leaves active unchanged', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.8,
        recommendation: 'active' as const,
        breakdown: { recency: 1.0, frequency: 0.9, importance: 1.0, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      const result = applyLifecyclePolicy(score, memory, 'full_rollout')

      expect(result.transitioned).toBe(false)
      expect(result.newStatus).toBe('active')
    })
  })

  describe('policy disabled', () => {
    it('does not transition when policy disabled even in full_rollout', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.2,
        recommendation: 'archive_candidate' as const,
        breakdown: { recency: 0.1, frequency: 0.1, importance: 0.25, relevance: 0.5 },
      }

      delete process.env.LIFECYCLE_POLICY_ENABLED
      const result = applyLifecyclePolicy(score, memory, 'full_rollout')

      expect(result.transitioned).toBe(false)
      expect(result.newStatus).toBe('active')
    })
  })

  describe('phase defaults to env var', () => {
    it('uses env var phase when not provided', () => {
      const memory = makeMemory({
        lifecycle: { status: 'active', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      })
      const score = {
        score: 0.2,
        recommendation: 'archive_candidate' as const,
        breakdown: { recency: 0.1, frequency: 0.1, importance: 0.25, relevance: 0.5 },
      }

      process.env.LIFECYCLE_POLICY_ENABLED = 'true'
      process.env.LIFECYCLE_POLICY_PHASE = 'full_rollout'
      const result = applyLifecyclePolicy(score, memory)

      expect(result.transitioned).toBe(true)
      expect(result.newStatus).toBe('archived')
    })
  })
})

describe('LifecycleScorer integration', () => {
  it('import from existing LifecycleScorer works', () => {
    const scorer = new LifecycleScorer()
    const memory = makeMemory()
    const result = scorer.score(memory)

    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
    expect(['active', 'low_priority', 'archive_candidate']).toContain(result.recommendation)
  })
})
