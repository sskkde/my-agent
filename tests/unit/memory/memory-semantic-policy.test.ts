import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  type ExtractedMemoryCandidate,
  type MemoryExtractionWindow,
  type AutoExtractedMemoryType,
  validateExtractedCandidate,
  AUTO_EXTRACTED_MEMORY_TYPES,
} from '../../../src/memory/long-term-memory-extraction.js'
import { validateMemoryCandidate } from '../../../src/memory/memory-candidate-types.js'

describe('Memory Semantic Policy', () => {
  const validWindow: MemoryExtractionWindow = {
    userId: 'user-123',
    sessionId: 'session-456',
    triggerTurnId: 'turn-5',
    includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
    windowHash: 'sha256:abc123',
    sessionMemorySummaryId: 'summary-789',
    renderedInput: 'Transcript...',
  }

  const createValidCandidate = (text: string): ExtractedMemoryCandidate => ({
    memoryType: 'long_term_fact',
    text,
    confidence: 0.9,
    importance: 'high',
    sensitivity: 'low',
    keywords: ['fact'],
    scope: { visibility: 'private_user' },
    sourceRefs: {
      transcriptRefs: ['turn-1'],
      extraction: {
        windowHash: 'hash1',
        triggerTurnId: 'turn-1',
        includedTurnIds: ['turn-1'],
      },
    },
  })

  describe('long_term_fact type acceptance', () => {
    it('accepts long_term_fact as valid memory type', () => {
      const candidate = createValidCandidate('The project uses TypeScript for type safety')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(true)
      expect(result.normalizedCandidate?.memoryType).toBe('long_term_fact')
    })

    it('accepts long_term_fact with structured data', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'long_term_fact',
        text: 'API endpoint requires authentication',
        structured: { endpoint: '/api/v1/users', auth: 'required' },
        confidence: 0.95,
        importance: 'critical',
        sensitivity: 'medium',
        keywords: ['api', 'auth'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1', 'turn-2'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-2',
            includedTurnIds: ['turn-1', 'turn-2'],
          },
        },
      }
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(true)
    })
  })

  describe('ephemeral pattern detection', () => {
    const originalEnv = process.env.MEMORY_SEMANTIC_POLICY_ENABLED

    beforeEach(() => {
      process.env.MEMORY_SEMANTIC_POLICY_ENABLED = 'true'
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.MEMORY_SEMANTIC_POLICY_ENABLED
      } else {
        process.env.MEMORY_SEMANTIC_POLICY_ENABLED = originalEnv
      }
    })

    it('rejects commit hash patterns when policy enabled', () => {
      const candidate = createValidCandidate('Fixed bug in commit abc1234def5678')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('ephemeral_pattern_detected')
    })

    it('rejects npm run command patterns when policy enabled', () => {
      const candidate = createValidCandidate('Run npm run build to compile')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('ephemeral_pattern_detected')
    })

    it('rejects file:line reference patterns when policy enabled', () => {
      const candidate = createValidCandidate('Error at src/index.ts:42')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('ephemeral_pattern_detected')
    })

    it('rejects git command patterns when policy enabled', () => {
      const candidate = createValidCandidate('Use git push origin main')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('ephemeral_pattern_detected')
    })

    it('rejects test step patterns when policy enabled', () => {
      const candidate = createValidCandidate('Test step 1: verify login')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('ephemeral_pattern_detected')
    })

    it('rejects release version patterns when policy enabled', () => {
      const candidate = createValidCandidate('release v1.2.3 deployed')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('ephemeral_pattern_detected')
    })

    it('rejects console.log patterns when policy enabled', () => {
      const candidate = createValidCandidate('Added console.log("debug")')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('ephemeral_pattern_detected')
    })

    it('accepts valid long-term facts without ephemeral patterns', () => {
      const candidate = createValidCandidate('The system architecture follows microservices pattern')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(true)
    })
  })

  describe('legacy path (policy disabled)', () => {
    const originalEnv = process.env.MEMORY_SEMANTIC_POLICY_ENABLED

    beforeEach(() => {
      delete process.env.MEMORY_SEMANTIC_POLICY_ENABLED
    })

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.MEMORY_SEMANTIC_POLICY_ENABLED
      } else {
        process.env.MEMORY_SEMANTIC_POLICY_ENABLED = originalEnv
      }
    })

    it('accepts ephemeral patterns when policy disabled', () => {
      const candidate = createValidCandidate('Fixed bug in commit abc1234')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(true)
    })

    it('accepts npm commands when policy disabled', () => {
      const candidate = createValidCandidate('Run npm run test')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(true)
    })

    it('accepts file references when policy disabled', () => {
      const candidate = createValidCandidate('See src/main.ts:100')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(true)
    })

    it('accepts git commands when policy disabled', () => {
      const candidate = createValidCandidate('git commit -m "message"')
      const result = validateExtractedCandidate(candidate, validWindow)
      expect(result.valid).toBe(true)
    })
  })
})

describe('Auto-extraction vs Storage type distinction', () => {
  it('AUTO_EXTRACTED_MEMORY_TYPES contains exactly 5 types', () => {
    expect(AUTO_EXTRACTED_MEMORY_TYPES).toHaveLength(5)
    expect(AUTO_EXTRACTED_MEMORY_TYPES).toEqual([
      'user_preference',
      'user_profile',
      'user_safety_rule',
      'project_state',
      'long_term_fact',
    ])
  })

  it('long_term_fact is in auto-extraction whitelist', () => {
    expect(AUTO_EXTRACTED_MEMORY_TYPES).toContain('long_term_fact')
  })

  it('gated types are NOT in auto-extraction whitelist', () => {
    const gatedTypes = ['relationship', 'routine', 'workflow_preference', 'durable_fact', 'episodic_summary']
    for (const t of gatedTypes) {
      expect(AUTO_EXTRACTED_MEMORY_TYPES.includes(t as AutoExtractedMemoryType)).toBe(false)
    }
  })

  it('validateMemoryCandidate rejects gated types for auto_extraction origin', () => {
    const candidate = {
      memoryType: 'relationship',
      text: 'User knows Alice',
      confidence: 0.9,
      importance: 'medium' as const,
      sensitivity: 'low' as const,
      keywords: ['relationship'],
      scope: { visibility: 'private_user' as const },
      sourceRefs: {
        transcriptRefs: ['turn-1'],
        extraction: { windowHash: 'h', triggerTurnId: 'turn-1', includedTurnIds: ['turn-1'] },
      },
    } as ExtractedMemoryCandidate

    const result = validateMemoryCandidate(candidate, { origin: 'auto_extraction' })
    expect(result.valid).toBe(false)
  })

  it('validateMemoryCandidate accepts gated types for explicit_user_save origin', () => {
    const candidate = {
      memoryType: 'relationship',
      text: 'User knows Alice',
      confidence: 0.9,
      importance: 'medium' as const,
      sensitivity: 'low' as const,
      keywords: ['relationship'],
      scope: { visibility: 'private_user' as const },
      sourceRefs: {
        transcriptRefs: ['turn-1'],
        extraction: { windowHash: 'h', triggerTurnId: 'turn-1', includedTurnIds: ['turn-1'] },
      },
    } as ExtractedMemoryCandidate

    const result = validateMemoryCandidate(candidate, { origin: 'explicit_user_save' })
    expect(result.valid).toBe(true)
  })
})
