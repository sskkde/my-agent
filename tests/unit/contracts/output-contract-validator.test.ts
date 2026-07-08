import { describe, expect, it } from 'vitest'
import {
  StructuredOutputContractError,
  getOutputContractDefinition,
  validateOutputContractContent,
} from '../../../src/contracts/output-contract-validator.js'

const validMemoryCandidateEnvelope = {
  candidates: [
    {
      memoryType: 'user_preference',
      text: 'User prefers concise answers',
      confidence: 0.9,
      importance: 'medium',
      sensitivity: 'low',
      keywords: ['concise', 'answers'],
      scope: { visibility: 'private_user' },
      sourceRefs: {
        transcriptRefs: ['turn-1'],
        extraction: {
          windowHash: 'hash-1',
          triggerTurnId: 'turn-1',
          includedTurnIds: ['turn-1'],
        },
      },
    },
  ],
}

describe('output contract validator', () => {
  it('registers memory candidate as a structured JSON contract', () => {
    expect(getOutputContractDefinition('output:memory-candidate.schema')).toEqual({
      contractId: 'output:memory-candidate.schema',
      kind: 'structured_json',
      description: 'Memory extraction candidates envelope',
    })
  })

  it('registers default chat as a natural-language contract', () => {
    expect(getOutputContractDefinition('output:default-chat.schema')).toEqual({
      contractId: 'output:default-chat.schema',
      kind: 'natural_language',
      description: 'Default conversational markdown response',
    })
  })

  it('parses and validates valid memory candidate JSON', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: JSON.stringify(validMemoryCandidateEnvelope),
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.parsed).toEqual(validMemoryCandidateEnvelope)
      expect(result.skippedReason).toBeUndefined()
    }
  })

  it('returns INVALID_JSON for malformed structured JSON', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: '{ candidates: [',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('INVALID_JSON')
      expect(result.message).toContain('not valid JSON')
    }
  })

  it('returns SCHEMA_MISMATCH when memory candidates are structurally invalid', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: JSON.stringify({ candidates: [{ text: 'missing required fields' }] }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('SCHEMA_MISMATCH')
      expect(result.details).toContain('candidates[0].memoryType must be a string')
      expect(result.details).toContain('candidates[0].confidence must be a number')
    }
  })

  it('skips natural-language contracts without parsing content as JSON', () => {
    const result = validateOutputContractContent({
      contractId: 'output:default-chat.schema',
      mode: 'function_calling',
      content: 'Plain conversational markdown response.',
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('natural_language')
      expect(result.skippedReason).toBe('natural_language_contract')
      expect(result.parsed).toBeUndefined()
    }
  })

  it('fails closed for unknown contracts in structured_json mode', () => {
    const result = validateOutputContractContent({
      contractId: 'output:unknown.schema',
      mode: 'structured_json',
      content: '{}',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN_OUTPUT_CONTRACT')
      expect(result.contractId).toBe('output:unknown.schema')
    }
  })

  it('wraps validation failures in StructuredOutputContractError', () => {
    const result = validateOutputContractContent({
      contractId: 'output:memory-candidate.schema',
      mode: 'structured_json',
      content: '{}',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const error = new StructuredOutputContractError(result)
      expect(error.code).toBe('SCHEMA_MISMATCH')
      expect(error.contractId).toBe('output:memory-candidate.schema')
      expect(error.details).toContain('candidates must be an array')
    }
  })
})
