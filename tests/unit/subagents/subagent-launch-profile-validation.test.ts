import { describe, it, expect, beforeEach } from 'vitest'
import { inferSubagentType } from '../../../src/subagents/action-mapper.js'
import { normalizeAgentLabel, isKnownAgentLabel, UnknownAgentLabelError } from '../../../src/taxonomy/agent-label-normalizer.js'
import { createAgentProfileRegistry, registerSystemProfiles } from '../../../src/taxonomy/agent-profile-registry.js'
import type { AgentProfileRegistry } from '../../../src/taxonomy/agent-profile-registry.js'

describe('inferSubagentType returns NormalizedAgentLabel', () => {
  it('should return normalized label with agentType and agentProfile for document keywords', () => {
    const result = inferSubagentType({ message: '请帮我处理这个PDF文档' })

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('document_processor')
  })

  it('should return normalized label for image keywords', () => {
    const result = inferSubagentType({ message: '识别这张图片中的文字' })

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('image_processor')
  })

  it('should return normalized label for data keywords', () => {
    const result = inferSubagentType({ message: '分析这个CSV数据' })

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('data_processor')
  })

  it('should return normalized label for code keywords', () => {
    const result = inferSubagentType({ message: 'fix this typescript bug' })

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('code_processor')
  })

  it('should return research_processor fallback for unrecognized input', () => {
    const result = inferSubagentType({ message: 'hello world' })

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('research_processor')
  })

  it('should return frozen-like object (new instance each call)', () => {
    const a = inferSubagentType({ message: 'test' })
    const b = inferSubagentType({ message: 'test' })

    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

describe('normalizeAgentLabel for old launch input names', () => {
  it('should normalize legacy kernel label', () => {
    const result = normalizeAgentLabel('kernel')

    expect(result.agentType).toBe('main')
    expect(result.agentProfile).toBe('default_main')
  })

  it('should normalize legacy foreground label', () => {
    const result = normalizeAgentLabel('foreground')

    expect(result.agentType).toBe('main')
    expect(result.agentProfile).toBe('foreground')
  })

  it('should normalize legacy planner label', () => {
    const result = normalizeAgentLabel('planner')

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('planner')
  })

  it('should normalize legacy search label', () => {
    const result = normalizeAgentLabel('search')

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('search')
  })

  it('should normalize document_processor label', () => {
    const result = normalizeAgentLabel('document_processor')

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('document_processor')
  })

  it('should normalize research_processor label', () => {
    const result = normalizeAgentLabel('research_processor')

    expect(result.agentType).toBe('subagent')
    expect(result.agentProfile).toBe('research_processor')
  })

  it('should throw UnknownAgentLabelError for unrecognized label', () => {
    expect(() => normalizeAgentLabel('totally_unknown_agent')).toThrow(UnknownAgentLabelError)
  })

  it('isKnownAgentLabel should return true for known labels', () => {
    expect(isKnownAgentLabel('document_processor')).toBe(true)
    expect(isKnownAgentLabel('kernel')).toBe(true)
    expect(isKnownAgentLabel('planner')).toBe(true)
  })

  it('isKnownAgentLabel should return false for unknown labels', () => {
    expect(isKnownAgentLabel('unknown_agent')).toBe(false)
    expect(isKnownAgentLabel('')).toBe(false)
  })
})

describe('AgentProfileRegistry validation', () => {
  let registry: AgentProfileRegistry

  beforeEach(() => {
    registry = createAgentProfileRegistry()
    registerSystemProfiles(registry)
  })

  it('should validate registered profile IDs', () => {
    const profile = registry.assertAllowed('document_processor')

    expect(profile.id).toBe('document_processor')
    expect(profile.displayName).toBe('Document Processor')
  })

  it('should validate all system profiles', () => {
    const systemProfileIds = [
      'default_main',
      'foreground',
      'planner',
      'memory',
      'search',
      'document_processor',
      'image_processor',
      'data_processor',
      'audio_processor',
      'code_processor',
      'research_processor',
      'search_processor',
    ]

    for (const profileId of systemProfileIds) {
      const profile = registry.assertAllowed(profileId)
      expect(profile.id).toBe(profileId)
    }
  })

  it('should throw for unregistered profile IDs', () => {
    expect(() => registry.assertAllowed('unregistered_profile')).toThrow('Unknown agent profile: "unregistered_profile"')
  })

  it('should throw for arbitrary LLM-supplied strings', () => {
    expect(() => registry.assertAllowed('evil_injected_profile')).toThrow()
    expect(() => registry.assertAllowed('')).toThrow()
    expect(() => registry.assertAllowed('../../admin')).toThrow()
  })

  it('should return undefined for get on unregistered profile', () => {
    expect(registry.get('nonexistent')).toBeUndefined()
  })

  it('should list all registered profiles', () => {
    const profiles = registry.list()

    expect(profiles.length).toBeGreaterThanOrEqual(12)
    expect(profiles.map((p) => p.id)).toContain('document_processor')
    expect(profiles.map((p) => p.id)).toContain('research_processor')
  })
})

describe('Launch profile normalization flow', () => {
  it('old agentType label should normalize to agentProfile via normalizer', () => {
    const oldLabel = 'document_processor'
    const normalized = normalizeAgentLabel(oldLabel)

    expect(normalized.agentProfile).toBe('document_processor')
    expect(normalized.agentType).toBe('subagent')
  })

  it('legacy kernel label should normalize and be valid in registry', () => {
    let registry: AgentProfileRegistry = createAgentProfileRegistry()
    registerSystemProfiles(registry)

    const normalized = normalizeAgentLabel('kernel')
    const profile = registry.get(normalized.agentProfile)

    expect(profile).toBeDefined()
    expect(profile!.id).toBe('default_main')
  })

  it('inferSubagentType result should be valid in registry', () => {
    let registry: AgentProfileRegistry = createAgentProfileRegistry()
    registerSystemProfiles(registry)

    const inferred = inferSubagentType({ message: '处理PDF文档' })
    const profile = registry.assertAllowed(inferred.agentProfile)

    expect(profile.id).toBe('document_processor')
  })
})
