import { describe, it, expect } from 'vitest'
import {
  normalizeAgentLabel,
  isKnownAgentLabel,
  getAllKnownLabels,
  UnknownAgentLabelError,
} from '../../../src/taxonomy/agent-label-normalizer.js'

describe('agent-label-normalizer', () => {
  // ─── normalizeAgentLabel ─────────────────────────────────────────────────

  describe('normalizeAgentLabel', () => {
    describe('main agents', () => {
      it('should normalize kernel to { main, default_main }', () => {
        const result = normalizeAgentLabel('kernel')
        expect(result).toEqual({ agentType: 'main', agentProfile: 'default_main' })
        expect(result.outputContract).toBeUndefined()
      })

      it('should normalize foreground to { main, foreground }', () => {
        const result = normalizeAgentLabel('foreground')
        expect(result).toEqual({ agentType: 'main', agentProfile: 'foreground' })
        expect(result.outputContract).toBeUndefined()
      })
    })

    describe('background agents', () => {
      it('should normalize memory to { background, memory }', () => {
        const result = normalizeAgentLabel('memory')
        expect(result).toEqual({ agentType: 'background', agentProfile: 'memory' })
        expect(result.outputContract).toBeUndefined()
      })
    })

    describe('subagent profiles', () => {
      it('should normalize planner to { subagent, planner }', () => {
        const result = normalizeAgentLabel('planner')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'planner' })
      })

      it('should normalize search to { subagent, search }', () => {
        const result = normalizeAgentLabel('search')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'search' })
      })

      it('should normalize document_processor to { subagent, document_processor }', () => {
        const result = normalizeAgentLabel('document_processor')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'document_processor' })
      })

      it('should normalize image_processor to { subagent, image_processor }', () => {
        const result = normalizeAgentLabel('image_processor')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'image_processor' })
      })

      it('should normalize data_processor to { subagent, data_processor }', () => {
        const result = normalizeAgentLabel('data_processor')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'data_processor' })
      })

      it('should normalize audio_processor to { subagent, audio_processor }', () => {
        const result = normalizeAgentLabel('audio_processor')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'audio_processor' })
      })

      it('should normalize code_processor to { subagent, code_processor }', () => {
        const result = normalizeAgentLabel('code_processor')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'code_processor' })
      })

      it('should normalize research_processor to { subagent, research_processor }', () => {
        const result = normalizeAgentLabel('research_processor')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'research_processor' })
      })

      it('should normalize search_processor to { subagent, search_processor }', () => {
        const result = normalizeAgentLabel('search_processor')
        expect(result).toEqual({ agentType: 'subagent', agentProfile: 'search_processor' })
      })
    })

    describe('return value immutability', () => {
      it('should return a new object on each call (no shared mutation risk)', () => {
        const first = normalizeAgentLabel('kernel')
        const second = normalizeAgentLabel('kernel')
        expect(first).toEqual(second)
        expect(first).not.toBe(second)
      })
    })

    describe('unknown labels', () => {
      it('should throw UnknownAgentLabelError for empty string', () => {
        expect(() => normalizeAgentLabel('')).toThrow(UnknownAgentLabelError)
      })

      it('should throw UnknownAgentLabelError for arbitrary string', () => {
        expect(() => normalizeAgentLabel('nonexistent_agent')).toThrow(UnknownAgentLabelError)
      })

      it('should include the unrecognized label in the error', () => {
        try {
          normalizeAgentLabel('bogus')
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(UnknownAgentLabelError)
          const typed = error as UnknownAgentLabelError
          expect(typed.label).toBe('bogus')
          expect(typed.message).toContain('bogus')
        }
      })

      it('should throw for case-sensitive mismatches', () => {
        expect(() => normalizeAgentLabel('Kernel')).toThrow(UnknownAgentLabelError)
        expect(() => normalizeAgentLabel('KERNEL')).toThrow(UnknownAgentLabelError)
        expect(() => normalizeAgentLabel('Foreground')).toThrow(UnknownAgentLabelError)
      })

      it('should throw for labels with leading/trailing whitespace', () => {
        expect(() => normalizeAgentLabel(' kernel ')).toThrow(UnknownAgentLabelError)
        expect(() => normalizeAgentLabel('kernel ')).toThrow(UnknownAgentLabelError)
        expect(() => normalizeAgentLabel(' kernel')).toThrow(UnknownAgentLabelError)
      })
    })
  })

  // ─── isKnownAgentLabel ──────────────────────────────────────────────────

  describe('isKnownAgentLabel', () => {
    it('should return true for all known labels', () => {
      const knownLabels = [
        'kernel',
        'foreground',
        'memory',
        'planner',
        'search',
        'document_processor',
        'image_processor',
        'data_processor',
        'audio_processor',
        'code_processor',
        'research_processor',
        'search_processor',
      ]

      for (const label of knownLabels) {
        expect(isKnownAgentLabel(label)).toBe(true)
      }
    })

    it('should return false for unknown labels', () => {
      expect(isKnownAgentLabel('')).toBe(false)
      expect(isKnownAgentLabel('unknown')).toBe(false)
      expect(isKnownAgentLabel('Kernel')).toBe(false)
      expect(isKnownAgentLabel('kernel ')).toBe(false)
    })
  })

  // ─── getAllKnownLabels ──────────────────────────────────────────────────

  describe('getAllKnownLabels', () => {
    it('should return exactly 12 known labels', () => {
      const labels = getAllKnownLabels()
      expect(labels).toHaveLength(12)
    })

    it('should include all expected legacy labels', () => {
      const labels = getAllKnownLabels()
      expect(labels).toContain('kernel')
      expect(labels).toContain('foreground')
      expect(labels).toContain('memory')
      expect(labels).toContain('planner')
      expect(labels).toContain('search')
      expect(labels).toContain('document_processor')
      expect(labels).toContain('image_processor')
      expect(labels).toContain('data_processor')
      expect(labels).toContain('audio_processor')
      expect(labels).toContain('code_processor')
      expect(labels).toContain('research_processor')
      expect(labels).toContain('search_processor')
    })

    it('should be idempotent', () => {
      const first = getAllKnownLabels()
      const second = getAllKnownLabels()
      expect(first).toEqual(second)
      expect(first).not.toBe(second)
    })
  })

  // ─── UnknownAgentLabelError ─────────────────────────────────────────────

  describe('UnknownAgentLabelError', () => {
    it('should be an instance of Error', () => {
      const error = new UnknownAgentLabelError('test')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct name property', () => {
      const error = new UnknownAgentLabelError('test')
      expect(error.name).toBe('UnknownAgentLabelError')
    })

    it('should expose the label via .label', () => {
      const error = new UnknownAgentLabelError('my_label')
      expect(error.label).toBe('my_label')
    })

    it('should produce a human-readable message', () => {
      const error = new UnknownAgentLabelError('my_label')
      expect(error.message).toBe('Unknown agent label: "my_label"')
    })
  })

  // ─── Cross-cutting: all labels normalize to valid AgentType ─────────────

  describe('AgentType conformance', () => {
    const VALID_AGENT_TYPES = new Set(['main', 'subagent', 'background', 'workflow_step', 'remote'])

    it('should map every known label to a valid AgentType', () => {
      const labels = getAllKnownLabels()
      for (const label of labels) {
        const result = normalizeAgentLabel(label)
        expect(VALID_AGENT_TYPES.has(result.agentType)).toBe(true)
      }
    })
  })
})
