import { describe, it, expect } from 'vitest'
import { computeEffectiveAllowedToolIds } from '../../../src/foreground/effective-tool-ids.js'
import type { AgentConfig } from '../../../src/storage/agent-config-store.js'

describe('computeEffectiveAllowedToolIds', () => {
  const createConfig = (allowedToolIds: string[] | null): AgentConfig => ({
    agentConfigId: 'test-config-id',
    agentId: 'foreground.default',
    scope: 'global',
    userId: null,
    displayName: 'Test Config',
    enabled: true,
    systemPrompt: null,
    routingPrompt: null,
    providerId: null,
    model: null,
    allowedToolIds,
    allowedSkillIds: null,
    routingTimeoutMs: 60000,
    repairAttempts: 1,
    promptType: null,
    promptVersion: null,
    searchLlmProviderId: null,
    searchLlmModel: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  const knownToolIds = ['web_search', 'read_file', 'write_file', 'execute_code']

  describe('when agentConfig is undefined', () => {
    it('should return all known tool IDs', () => {
      const result = computeEffectiveAllowedToolIds(undefined, knownToolIds)
      expect(result).toEqual(['web_search', 'read_file', 'write_file', 'execute_code'])
    })

    it('should return a copy of the known tool IDs array', () => {
      const result = computeEffectiveAllowedToolIds(undefined, knownToolIds)
      expect(result).not.toBe(knownToolIds)
      expect(result).toEqual(knownToolIds)
    })
  })

  describe('when allowedToolIds is null', () => {
    it('should return all known tool IDs (inherit)', () => {
      const config = createConfig(null)
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      expect(result).toEqual(['web_search', 'read_file', 'write_file', 'execute_code'])
    })

    it('should return a copy of the known tool IDs array', () => {
      const config = createConfig(null)
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      expect(result).not.toBe(knownToolIds)
      expect(result).toEqual(knownToolIds)
    })
  })

  describe('when allowedToolIds is an empty array', () => {
    it('should return an empty array (no tools allowed)', () => {
      const config = createConfig([])
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      expect(result).toEqual([])
    })
  })

  describe('when allowedToolIds is an explicit array', () => {
    it('should return intersection with known tool IDs', () => {
      const config = createConfig(['web_search', 'read_file'])
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      expect(result).toEqual(['web_search', 'read_file'])
    })

    it('should filter out unknown tool IDs', () => {
      const config = createConfig(['web_search', 'unknown_tool', 'read_file'])
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      expect(result).toEqual(['web_search', 'read_file'])
    })

    it('should return empty array if no allowed tools are in known tools', () => {
      const config = createConfig(['unknown_tool_1', 'unknown_tool_2'])
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      expect(result).toEqual([])
    })

    it('should preserve order from knownToolIds', () => {
      // allowedToolIds has different order than knownToolIds
      const config = createConfig(['execute_code', 'read_file'])
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      // Result should be in knownToolIds order: read_file comes before execute_code
      expect(result).toEqual(['read_file', 'execute_code'])
    })

    it('should handle single tool', () => {
      const config = createConfig(['web_search'])
      const result = computeEffectiveAllowedToolIds(config, knownToolIds)
      expect(result).toEqual(['web_search'])
    })
  })

  describe('edge cases', () => {
    it('should handle empty knownToolIds array', () => {
      const config = createConfig(['web_search'])
      const result = computeEffectiveAllowedToolIds(config, [])
      expect(result).toEqual([])
    })

    it('should handle empty knownToolIds with null allowedToolIds', () => {
      const config = createConfig(null)
      const result = computeEffectiveAllowedToolIds(config, [])
      expect(result).toEqual([])
    })

    it('should handle empty knownToolIds with undefined agentConfig', () => {
      const result = computeEffectiveAllowedToolIds(undefined, [])
      expect(result).toEqual([])
    })

    it('should handle empty knownToolIds with empty allowedToolIds', () => {
      const config = createConfig([])
      const result = computeEffectiveAllowedToolIds(config, [])
      expect(result).toEqual([])
    })
  })

  describe('immutability', () => {
    it('should not modify the input knownToolIds array', () => {
      const originalTools = ['web_search', 'read_file']
      const toolsCopy = [...originalTools]
      const config = createConfig(['web_search'])

      computeEffectiveAllowedToolIds(config, originalTools)

      expect(originalTools).toEqual(toolsCopy)
    })

    it('should not modify the allowedToolIds in config', () => {
      const allowedTools = ['web_search', 'read_file']
      const config = createConfig(allowedTools)

      const result = computeEffectiveAllowedToolIds(config, knownToolIds)

      expect(allowedTools).toEqual(['web_search', 'read_file'])
      expect(result).not.toBe(allowedTools)
    })
  })
})
