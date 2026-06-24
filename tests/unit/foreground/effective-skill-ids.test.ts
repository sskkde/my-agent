import { describe, it, expect } from 'vitest'
import {
  computeEffectiveAllowedSkillIds,
  computeEffectiveSkillIdsWithEnvelope,
} from '../../../src/foreground/effective-skill-ids.js'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import type { AgentConfig } from '../../../src/storage/agent-config-store.js'
import type { SkillCategory } from '../../../src/skills/types.js'

describe('computeEffectiveAllowedSkillIds', () => {
  const createConfig = (allowedSkillIds: string[] | null): AgentConfig => ({
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
    allowedToolIds: null,
    allowedSkillIds,
    routingTimeoutMs: 60000,
    repairAttempts: 1,
    promptType: null,
    promptVersion: null,
    searchLlmProviderId: null,
    searchLlmModel: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  })

  const knownSkillIds = ['memory_research', 'documentation_search', 'artifact_workflow', 'web_research_guidance']

  describe('when agentConfig is undefined', () => {
    it('should return all known skill IDs', () => {
      const result = computeEffectiveAllowedSkillIds(undefined, knownSkillIds)
      expect(result).toEqual(['memory_research', 'documentation_search', 'artifact_workflow', 'web_research_guidance'])
    })

    it('should return a copy of the known skill IDs array', () => {
      const result = computeEffectiveAllowedSkillIds(undefined, knownSkillIds)
      expect(result).not.toBe(knownSkillIds)
      expect(result).toEqual(knownSkillIds)
    })
  })

  describe('when allowedSkillIds is null (inherit)', () => {
    it('should return all known skill IDs', () => {
      const config = createConfig(null)
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).toEqual(['memory_research', 'documentation_search', 'artifact_workflow', 'web_research_guidance'])
    })

    it('should return a copy of the known skill IDs array', () => {
      const config = createConfig(null)
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).not.toBe(knownSkillIds)
      expect(result).toEqual(knownSkillIds)
    })
  })

  describe('when allowedSkillIds is an empty array (none)', () => {
    it('should return an empty array (no skills allowed)', () => {
      const config = createConfig([])
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).toEqual([])
    })
  })

  describe('when allowedSkillIds is an explicit array (intersect)', () => {
    it('should return intersection with known skill IDs', () => {
      const config = createConfig(['memory_research', 'documentation_search'])
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).toEqual(['memory_research', 'documentation_search'])
    })

    it('should filter out unknown skill IDs', () => {
      const config = createConfig(['memory_research', 'unknown_skill', 'documentation_search'])
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).toEqual(['memory_research', 'documentation_search'])
    })

    it('should return empty array if no allowed skills are in known skills', () => {
      const config = createConfig(['unknown_skill_1', 'unknown_skill_2'])
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).toEqual([])
    })

    it('should preserve order from knownSkillIds', () => {
      // allowedSkillIds has different order than knownSkillIds
      const config = createConfig(['web_research_guidance', 'memory_research'])
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      // Result should be in knownSkillIds order: memory_research comes before web_research_guidance
      expect(result).toEqual(['memory_research', 'web_research_guidance'])
    })

    it('should handle single skill', () => {
      const config = createConfig(['memory_research'])
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).toEqual(['memory_research'])
    })

    it('should handle deprecated alias IDs (filtered as unknown if not in catalog)', () => {
      // Deprecated aliases like 'artifact_create' are not in the known catalog
      // unless explicitly registered. They should be filtered out.
      const config = createConfig(['artifact_create', 'memory_research'])
      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)
      expect(result).toEqual(['memory_research'])
    })
  })

  describe('edge cases', () => {
    it('should handle empty knownSkillIds array', () => {
      const config = createConfig(['memory_research'])
      const result = computeEffectiveAllowedSkillIds(config, [])
      expect(result).toEqual([])
    })

    it('should handle empty knownSkillIds with null allowedSkillIds', () => {
      const config = createConfig(null)
      const result = computeEffectiveAllowedSkillIds(config, [])
      expect(result).toEqual([])
    })

    it('should handle empty knownSkillIds with undefined agentConfig', () => {
      const result = computeEffectiveAllowedSkillIds(undefined, [])
      expect(result).toEqual([])
    })

    it('should handle empty knownSkillIds with empty allowedSkillIds', () => {
      const config = createConfig([])
      const result = computeEffectiveAllowedSkillIds(config, [])
      expect(result).toEqual([])
    })
  })

  describe('immutability', () => {
    it('should not modify the input knownSkillIds array', () => {
      const originalSkills = ['memory_research', 'documentation_search']
      const skillsCopy = [...originalSkills]
      const config = createConfig(['memory_research'])

      computeEffectiveAllowedSkillIds(config, originalSkills)

      expect(originalSkills).toEqual(skillsCopy)
    })

    it('should not modify the allowedSkillIds in config', () => {
      const allowedSkills = ['memory_research', 'documentation_search']
      const config = createConfig(allowedSkills)

      const result = computeEffectiveAllowedSkillIds(config, knownSkillIds)

      expect(allowedSkills).toEqual(['memory_research', 'documentation_search'])
      expect(result).not.toBe(allowedSkills)
    })
  })
})

describe('computeEffectiveSkillIdsWithEnvelope', () => {
  const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()

  const skillCatalog = [
    { id: 'memory_research', category: 'read' as SkillCategory },
    { id: 'documentation_search', category: 'search' as SkillCategory },
    { id: 'session_status', category: 'internal' as SkillCategory },
    { id: 'artifact_workflow', category: 'write' as SkillCategory },
    { id: 'auto_deploy', category: 'automation' as SkillCategory },
    { id: 'admin_config', category: 'admin' as SkillCategory },
  ]

  describe('envelope-only (no profile or config)', () => {
    it('main: returns read/search/internal skills from catalog', () => {
      const result = computeEffectiveSkillIdsWithEnvelope('main', skillCatalog, envelopeRegistry)
      expect(result).toContain('memory_research')
      expect(result).toContain('documentation_search')
      expect(result).toContain('session_status')
      expect(result).not.toContain('artifact_workflow')
      expect(result).not.toContain('auto_deploy')
      expect(result).not.toContain('admin_config')
    })

    it('subagent: returns read/search/internal/write/automation skills', () => {
      const result = computeEffectiveSkillIdsWithEnvelope('subagent', skillCatalog, envelopeRegistry)
      expect(result).toContain('memory_research')
      expect(result).toContain('artifact_workflow')
      expect(result).toContain('auto_deploy')
      expect(result).not.toContain('admin_config')
    })

    it('background: returns only read/search/internal skills', () => {
      const result = computeEffectiveSkillIdsWithEnvelope('background', skillCatalog, envelopeRegistry)
      expect(result).toContain('memory_research')
      expect(result).toContain('documentation_search')
      expect(result).toContain('session_status')
      expect(result).not.toContain('artifact_workflow')
      expect(result).not.toContain('auto_deploy')
    })

    it('workflow_step: returns read/search/internal/write/automation skills', () => {
      const result = computeEffectiveSkillIdsWithEnvelope('workflow_step', skillCatalog, envelopeRegistry)
      expect(result).toContain('memory_research')
      expect(result).toContain('artifact_workflow')
      expect(result).toContain('auto_deploy')
      expect(result).not.toContain('admin_config')
    })

    it('remote: returns empty array (hard deny)', () => {
      const result = computeEffectiveSkillIdsWithEnvelope('remote', skillCatalog, envelopeRegistry)
      expect(result).toEqual([])
    })
  })

  describe('envelope + profile intersection', () => {
    it('intersects envelope with profile skills', () => {
      const profileSkills = ['memory_research', 'documentation_search', 'artifact_workflow']
      const result = computeEffectiveSkillIdsWithEnvelope(
        'main',
        skillCatalog,
        envelopeRegistry,
        profileSkills,
      )
      // main envelope allows read/search/internal, so artifact_workflow (write) is filtered out
      expect(result).toContain('memory_research')
      expect(result).toContain('documentation_search')
      expect(result).not.toContain('artifact_workflow')
    })

    it('profile cannot expand beyond envelope', () => {
      // Profile includes admin_config, but envelope denies it
      const profileSkills = ['memory_research', 'admin_config']
      const result = computeEffectiveSkillIdsWithEnvelope(
        'main',
        skillCatalog,
        envelopeRegistry,
        profileSkills,
      )
      expect(result).toContain('memory_research')
      expect(result).not.toContain('admin_config')
    })

    it('empty profile skills returns envelope-only result', () => {
      const result = computeEffectiveSkillIdsWithEnvelope(
        'main',
        skillCatalog,
        envelopeRegistry,
        [],
      )
      // Empty array means no restriction from profile — envelope governs
      expect(result).toContain('memory_research')
      expect(result).toContain('documentation_search')
    })
  })

  describe('envelope + profile + config intersection', () => {
    it('intersects all three layers', () => {
      const profileSkills = ['memory_research', 'documentation_search', 'session_status']
      const configSkills = ['memory_research', 'session_status']
      const result = computeEffectiveSkillIdsWithEnvelope(
        'main',
        skillCatalog,
        envelopeRegistry,
        profileSkills,
        configSkills,
      )
      expect(result).toContain('memory_research')
      expect(result).toContain('session_status')
      expect(result).not.toContain('documentation_search')
    })

    it('config cannot expand beyond envelope', () => {
      const profileSkills = ['memory_research', 'documentation_search']
      const configSkills = ['memory_research', 'admin_config']
      const result = computeEffectiveSkillIdsWithEnvelope(
        'main',
        skillCatalog,
        envelopeRegistry,
        profileSkills,
        configSkills,
      )
      expect(result).toContain('memory_research')
      expect(result).not.toContain('admin_config')
    })

    it('workflow_step cannot receive admin skill even if config includes it', () => {
      const configSkills = ['memory_research', 'admin_config']
      const result = computeEffectiveSkillIdsWithEnvelope(
        'workflow_step',
        skillCatalog,
        envelopeRegistry,
        undefined,
        configSkills,
      )
      expect(result).toContain('memory_research')
      expect(result).not.toContain('admin_config')
    })

    it('remote returns empty regardless of profile/config', () => {
      const profileSkills = ['memory_research', 'documentation_search']
      const configSkills = ['memory_research']
      const result = computeEffectiveSkillIdsWithEnvelope(
        'remote',
        skillCatalog,
        envelopeRegistry,
        profileSkills,
        configSkills,
      )
      expect(result).toEqual([])
    })
  })

  describe('deprecated alias handling', () => {
    it('deprecated alias IDs not in catalog are filtered out', () => {
      // If the catalog doesn't include deprecated aliases, they won't appear
      const catalogWithoutAliases = [
        { id: 'memory_research', category: 'read' as SkillCategory },
      ]
      const configSkills = ['artifact_create', 'memory_research']
      const result = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalogWithoutAliases,
        envelopeRegistry,
        undefined,
        configSkills,
      )
      expect(result).toEqual(['memory_research'])
    })

    it('deprecated alias IDs in catalog are allowed if envelope permits', () => {
      // If the catalog includes deprecated aliases (e.g. from registry), they pass
      const catalogWithAliases = [
        { id: 'memory_research', category: 'read' as SkillCategory },
        { id: 'artifact_create', category: 'write' as SkillCategory },
      ]
      const configSkills = ['artifact_create', 'memory_research']
      // main envelope denies write category, so artifact_create is filtered
      const result = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalogWithAliases,
        envelopeRegistry,
        undefined,
        configSkills,
      )
      expect(result).toEqual(['memory_research'])
    })
  })
})