import { describe, it, expect } from 'vitest'
import {
  type ExtractedMemoryCandidate,
  type AllowedLongTermMemoryType,
} from '../../../src/memory/long-term-memory-extraction.js'
import type { Importance, Sensitivity, MemoryType } from '../../../src/storage/long-term-memory-store.js'
import { validateMemoryCandidate } from '../../../src/memory/memory-candidate-types.js'

function createValidCandidate(): ExtractedMemoryCandidate {
  return {
    memoryType: 'user_preference',
    text: 'Prefers dark mode',
    confidence: 0.9,
    importance: 'high',
    sensitivity: 'low',
    keywords: ['dark mode', 'preference'],
    scope: { visibility: 'private_user' },
    sourceRefs: {
      transcriptRefs: ['turn-1', 'turn-2'],
      extraction: {
        windowHash: 'hash123',
        triggerTurnId: 'turn-2',
        includedTurnIds: ['turn-1', 'turn-2'],
      },
    },
  }
}

describe('validateMemoryCandidate', () => {
  describe('valid candidates', () => {
    it('should accept valid candidate', () => {
      const candidate = createValidCandidate()
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should accept all auto-extracted memory types with default origin', () => {
      const autoTypes = [
        'user_preference',
        'user_profile',
        'user_safety_rule',
        'project_state',
        'long_term_fact',
      ] as const

      for (const memoryType of autoTypes) {
        const candidate = { ...createValidCandidate(), memoryType }
        const result = validateMemoryCandidate(candidate)
        expect(result.valid).toBe(true)
      }
    })

    it('should accept confidence at exactly 0.7', () => {
      const candidate = { ...createValidCandidate(), confidence: 0.7 }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(true)
    })

    it('should accept confidence at exactly 1.0', () => {
      const candidate = { ...createValidCandidate(), confidence: 1.0 }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(true)
    })

    it('should accept all valid importance levels', () => {
      const importanceLevels = ['low', 'medium', 'high', 'critical'] as const

      for (const importance of importanceLevels) {
        const candidate = { ...createValidCandidate(), importance }
        const result = validateMemoryCandidate(candidate)
        expect(result.valid).toBe(true)
      }
    })

    it('should accept valid sensitivity levels', () => {
      const sensitivities = ['low', 'medium', 'high'] as const

      for (const sensitivity of sensitivities) {
        const candidate = { ...createValidCandidate(), sensitivity }
        const result = validateMemoryCandidate(candidate)
        expect(result.valid).toBe(true)
      }
    })

    it('should accept keywords with 1 item', () => {
      const candidate = { ...createValidCandidate(), keywords: ['single'] }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(true)
    })

    it('should accept keywords with 12 items', () => {
      const candidate = { ...createValidCandidate(), keywords: Array.from({ length: 12 }, (_, i) => `keyword${i}`) }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(true)
    })
  })

  describe('memoryType validation', () => {
    it('should reject unsupported memory types', () => {
      const candidate = { ...createValidCandidate(), memoryType: 'routine' }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('unsupported_memory_type:routine')
    })

    it('should reject non-auto-extraction memory types with default origin', () => {
      const gatedTypes = ['relationship', 'routine', 'workflow_preference', 'durable_fact', 'episodic_summary']

      for (const memoryType of gatedTypes) {
        const candidate = { ...createValidCandidate(), memoryType }
        const result = validateMemoryCandidate(candidate)
        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.includes('unsupported_memory_type'))).toBe(true)
      }
    })
  })

  describe('confidence validation', () => {
    it('should reject confidence below 0.7', () => {
      const candidate = { ...createValidCandidate(), confidence: 0.69 }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('confidence_out_of_range'))).toBe(true)
    })

    it('should reject confidence above 1.0', () => {
      const candidate = { ...createValidCandidate(), confidence: 1.01 }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('confidence_out_of_range'))).toBe(true)
    })

    it('should reject zero confidence', () => {
      const candidate = { ...createValidCandidate(), confidence: 0 }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('confidence_out_of_range'))).toBe(true)
    })
  })

  describe('keywords validation', () => {
    it('should reject empty keywords array', () => {
      const candidate = { ...createValidCandidate(), keywords: [] }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('keywords_empty')
    })

    it('should reject missing keywords', () => {
      const candidate = { ...createValidCandidate(), keywords: undefined as unknown as string[] }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('keywords_empty')
    })

    it('should reject keywords with more than 12 items', () => {
      const candidate = { ...createValidCandidate(), keywords: Array.from({ length: 13 }, (_, i) => `keyword${i}`) }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('keywords_too_many'))).toBe(true)
    })

    it('should reject keywords containing empty string', () => {
      const candidate = { ...createValidCandidate(), keywords: ['valid', '', 'also-valid'] }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('keywords_contain_empty_string')
    })
  })

  describe('sourceRefs.transcriptRefs validation', () => {
    it('should reject missing transcriptRefs', () => {
      const candidate = {
        ...createValidCandidate(),
        sourceRefs: {
          ...createValidCandidate().sourceRefs,
          transcriptRefs: undefined,
        },
      }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('missing_transcript_refs')
    })

    it('should reject empty transcriptRefs', () => {
      const candidate = {
        ...createValidCandidate(),
        sourceRefs: {
          ...createValidCandidate().sourceRefs,
          transcriptRefs: [],
        },
      }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('missing_transcript_refs')
    })
  })

  describe('sensitivity validation', () => {
    it('should reject restricted sensitivity', () => {
      const candidate = { ...createValidCandidate(), sensitivity: 'restricted' as Sensitivity }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('restricted_sensitivity')
    })
  })

  describe('origin-aware type validation', () => {
    it('should reject auto-extraction gated types: relationship, durable_fact, episodic_summary, routine, workflow_preference', () => {
      const gatedTypes: string[] = [
        'relationship',
        'durable_fact',
        'episodic_summary',
        'routine',
        'workflow_preference',
      ]

      for (const memoryType of gatedTypes) {
        const candidate = { ...createValidCandidate(), memoryType }
        const result = validateMemoryCandidate(candidate, { origin: 'auto_extraction' })
        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.includes('unsupported_memory_type'))).toBe(true)
      }
    })

    it('should accept gated storage types with explicit_user_save origin', () => {
      const gatedTypes: MemoryType[] = [
        'relationship',
        'durable_fact',
        'episodic_summary',
        'routine',
        'workflow_preference',
      ]

      for (const memoryType of gatedTypes) {
        const candidate = { ...createValidCandidate(), memoryType }
        const result = validateMemoryCandidate(candidate, { origin: 'explicit_user_save' })
        expect(result.valid).toBe(true)
      }
    })

    it('should accept gated storage types with system_import origin', () => {
      const candidate = { ...createValidCandidate(), memoryType: 'relationship' as MemoryType }
      const result = validateMemoryCandidate(candidate, { origin: 'system_import' })
      expect(result.valid).toBe(true)
    })

    it('should accept gated storage types with manual_admin origin', () => {
      const candidate = { ...createValidCandidate(), memoryType: 'workflow_preference' as MemoryType }
      const result = validateMemoryCandidate(candidate, { origin: 'manual_admin' })
      expect(result.valid).toBe(true)
    })

    it('should accept long_term_fact with default origin (auto_extraction)', () => {
      const candidate = { ...createValidCandidate(), memoryType: 'long_term_fact' }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(true)
    })

    it('should accept long_term_fact with explicit_user_save origin', () => {
      const candidate = { ...createValidCandidate(), memoryType: 'long_term_fact' }
      const result = validateMemoryCandidate(candidate, { origin: 'explicit_user_save' })
      expect(result.valid).toBe(true)
    })

    it('should reject truly unknown types regardless of origin', () => {
      const candidate = { ...createValidCandidate(), memoryType: 'completely_unknown_type' }
      const result = validateMemoryCandidate(candidate, { origin: 'manual_admin' })
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('unsupported_memory_type'))).toBe(true)
    })

    it('should reject secret-like content for explicit_user_save origin', () => {
      const candidate = { ...createValidCandidate(), text: 'password=correct-horse-battery-staple' }
      const result = validateMemoryCandidate(candidate, { origin: 'explicit_user_save' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('secret_like_content')
    })

    it('should reject secret-like content for system_import origin', () => {
      const candidate = { ...createValidCandidate(), text: 'api_key=sk_test_1234567890abcdef' }
      const result = validateMemoryCandidate(candidate, { origin: 'system_import' })
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('secret_like_content')
    })
  })

  describe('importance validation', () => {
    it('should reject invalid importance values', () => {
      const candidate = { ...createValidCandidate(), importance: 'super_critical' }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('invalid_importance'))).toBe(true)
    })

    it('should reject numeric importance', () => {
      const candidate = { ...createValidCandidate(), importance: 5 as unknown as string }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('invalid_importance'))).toBe(true)
    })
  })

  describe('multiple errors', () => {
    it('should return all errors for candidate with multiple violations', () => {
      const candidate = {
        ...createValidCandidate(),
        memoryType: 'relationship' as AllowedLongTermMemoryType,
        confidence: 0.5,
        sensitivity: 'restricted' as Sensitivity,
        importance: 'invalid' as Importance,
        keywords: [],
      }
      const result = validateMemoryCandidate(candidate)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(1)
    })
  })
})
