import { describe, it, expect } from 'vitest'
import {
  createAgentProfileRegistry,
  registerSystemProfiles,
  type AgentProfile,
  type AgentProfileRegistry,
} from '../../../src/taxonomy/agent-profile-registry.js'
import { createSkillRegistry } from '../../../src/skills/skill-registry.js'
import { registerBuiltinSkills } from '../../../src/skills/builtin/manifest.js'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'

const REQUIRED_PROFILE_IDS = [
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

function createRegistry(): AgentProfileRegistry {
  const registry = createAgentProfileRegistry()
  registerSystemProfiles(registry)
  return registry
}

describe('AgentProfileRegistry', () => {
  describe('system profiles', () => {
    it('should contain all required profile IDs', () => {
      const registry = createRegistry()
      const ids = registry.list().map((p) => p.id)

      for (const requiredId of REQUIRED_PROFILE_IDS) {
        expect(ids).toContain(requiredId)
      }
    })

    it('should have exactly 12 system profiles', () => {
      const registry = createRegistry()
      expect(registry.list()).toHaveLength(12)
    })

    it('should have all profiles owned by system', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        expect(profile.ownerScope).toBe('system')
      }
    })

    it('should have all profiles with non-empty allowedAgentTypes', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        expect(profile.allowedAgentTypes.length).toBeGreaterThan(0)
      }
    })

    it('should have all profiles with non-empty promptTemplateIds', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        expect(profile.promptTemplateIds.length).toBeGreaterThan(0)
      }
    })

    it('should have all profiles with valid riskLevel', () => {
      const registry = createRegistry()
      const validRiskLevels = ['low', 'medium', 'high', 'critical']
      for (const profile of registry.list()) {
        expect(validRiskLevels).toContain(profile.riskLevel)
      }
    })
  })

  describe('default_main profile', () => {
    it('should allow only main agentType', () => {
      const registry = createRegistry()
      const profile = registry.assertAllowed('default_main')
      expect(profile.allowedAgentTypes).toEqual(['main'])
    })

    it('should have medium risk level', () => {
      const registry = createRegistry()
      const profile = registry.assertAllowed('default_main')
      expect(profile.riskLevel).toBe('medium')
    })
  })

  describe('foreground profile', () => {
    it('should allow only main agentType', () => {
      const registry = createRegistry()
      const profile = registry.assertAllowed('foreground')
      expect(profile.allowedAgentTypes).toEqual(['main'])
    })
  })

  describe('planner profile', () => {
    it('should allow subagent and workflow_step agentTypes', () => {
      const registry = createRegistry()
      const profile = registry.assertAllowed('planner')
      expect(profile.allowedAgentTypes).toContain('subagent')
      expect(profile.allowedAgentTypes).toContain('workflow_step')
    })
  })

  describe('memory profile', () => {
    it('should allow only background agentType', () => {
      const registry = createRegistry()
      const profile = registry.assertAllowed('memory')
      expect(profile.allowedAgentTypes).toEqual(['background'])
    })

    it('should have high risk level', () => {
      const registry = createRegistry()
      const profile = registry.assertAllowed('memory')
      expect(profile.riskLevel).toBe('high')
    })
  })

  describe('subagent processor profiles', () => {
    const processorProfiles = [
      'document_processor',
      'image_processor',
      'data_processor',
      'audio_processor',
      'code_processor',
      'research_processor',
      'search_processor',
    ]

    for (const profileId of processorProfiles) {
      it(`${profileId} should allow subagent and background agentTypes`, () => {
        const registry = createRegistry()
        const profile = registry.assertAllowed(profileId)
        expect(profile.allowedAgentTypes).toContain('subagent')
        expect(profile.allowedAgentTypes).toContain('background')
      })
    }
  })

  describe('registry operations', () => {
    it('get should return profile by ID', () => {
      const registry = createRegistry()
      const profile = registry.get('foreground')
      expect(profile).toBeDefined()
      expect(profile?.id).toBe('foreground')
    })

    it('get should return undefined for unknown ID', () => {
      const registry = createRegistry()
      const profile = registry.get('nonexistent_profile')
      expect(profile).toBeUndefined()
    })

    it('assertAllowed should throw for unknown profile', () => {
      const registry = createRegistry()
      expect(() => registry.assertAllowed('nonexistent_profile')).toThrow('Unknown agent profile: "nonexistent_profile"')
    })

    it('assertAllowed should return profile for known ID', () => {
      const registry = createRegistry()
      const profile = registry.assertAllowed('code_processor')
      expect(profile.id).toBe('code_processor')
    })

    it('should reject duplicate registration', () => {
      const registry = createRegistry()
      const duplicate: AgentProfile = {
        id: 'foreground',
        displayName: 'Duplicate',
        allowedAgentTypes: ['main'],
        promptTemplateIds: ['test'],
        defaultToolIds: [],
        riskLevel: 'low',
        ownerScope: 'system',
      }
      expect(() => registry.register(duplicate)).toThrow('Agent profile already registered: "foreground"')
    })

    it('should allow registering custom profiles', () => {
      const registry = createRegistry()
      const custom: AgentProfile = {
        id: 'custom_test',
        displayName: 'Custom Test',
        allowedAgentTypes: ['subagent'],
        promptTemplateIds: ['custom:test'],
        defaultToolIds: ['test_tool'],
        riskLevel: 'low',
        ownerScope: 'user',
      }
      registry.register(custom)
      expect(registry.get('custom_test')).toBeDefined()
      expect(registry.list()).toHaveLength(13)
    })
  })

  describe('profile schema validation', () => {
    it('all profiles should have displayName', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        expect(profile.displayName.length).toBeGreaterThan(0)
      }
    })

    it('all profiles should have at least one promptTemplateId', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        expect(profile.promptTemplateIds.length).toBeGreaterThan(0)
      }
    })
  })

  describe('defaultSkillIds validation', () => {
    const skillRegistry = createSkillRegistry()
    registerBuiltinSkills(skillRegistry)
    const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()

    it('all system profiles should have defaultSkillIds defined', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        expect(
          profile.defaultSkillIds,
          `Profile "${profile.id}" missing defaultSkillIds`,
        ).toBeDefined()
        expect(
          profile.defaultSkillIds!.length,
          `Profile "${profile.id}" has empty defaultSkillIds`,
        ).toBeGreaterThan(0)
      }
    })

    it('every declared skill ID should resolve in the skill registry', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        const unresolved = (profile.defaultSkillIds ?? []).filter(
          (id) => !skillRegistry.has(id),
        )
        expect(
          unresolved,
          `Profile "${profile.id}" has unresolved skill IDs: ${unresolved.join(', ')}`,
        ).toEqual([])
      }
    })

    it('every declared skill ID should be allowed by the envelope for all allowedAgentTypes', () => {
      const registry = createRegistry()
      for (const profile of registry.list()) {
        for (const agentType of profile.allowedAgentTypes) {
          const denied = (profile.defaultSkillIds ?? []).filter((id) => {
            const skill = skillRegistry.get(id)
            if (!skill) return true
            return !envelopeRegistry.isSkillAllowedByEnvelope(agentType, id, skill.category)
          })
          expect(
            denied,
            `Profile "${profile.id}" skill IDs denied by ${agentType} envelope: ${denied.join(', ')}`,
          ).toEqual([])
        }
      }
    })
  })
})
