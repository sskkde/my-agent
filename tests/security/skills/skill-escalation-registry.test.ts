/**
 * Skill Escalation Security Tests - Skill Registry and Unknown Agent Type
 *
 * Validates skill ID spoofing prevention and unknown agent type handling.
 */

import { describe, it, expect } from 'vitest'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import { computeEffectiveSkillIdsWithEnvelope } from '../../../src/foreground/effective-skill-ids.js'
import { createSkillRegistry } from '../../../src/skills/skill-registry.js'
import { registerBuiltinSkills } from '../../../src/skills/builtin/manifest.js'
import { makeSkillCatalog } from './skill-escalation-setup.js'

describe('Skill Escalation - Skill Registry and Unknown Agent Type', () => {
  const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
  const catalog = makeSkillCatalog()

  describe('skill ID cannot spoof tool ID to gain execution', () => {
    it('skill with same ID as a tool is still documentation-only', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const skill = registry.get('web_search')
      if (skill) {
        expect(skill.enabled).toBe(false)
        expect(skill.tags).toContain('deprecated')
        expect(skill.description).toContain('Deprecated')
      }
    })

    it('active skill IDs do not overlap with tool IDs', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const activeSkills = registry.list().filter((s) => s.enabled)
      const activeSkillIds = new Set(activeSkills.map((s) => s.skillId))

      const knownToolIds = [
        'file_read', 'file_write', 'web_search', 'web_fetch',
        'exec', 'bash', 'process', 'code_execution',
        'status_query', 'memory_retrieve', 'artifact_create',
        'admin_config', 'transcript_search', 'plan_patch',
      ]

      for (const toolId of knownToolIds) {
        expect(activeSkillIds.has(toolId)).toBe(false)
      }
    })
  })

  describe('unknown agent type denies all skills', () => {
    it('unknown agent type returns empty effective skill IDs', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'unknown_type' as any,
        catalog,
        envelopeRegistry,
        ['memory_research', 'session_status'],
      )

      expect(effective).toEqual([])
    })
  })

  describe('skill registry builtin registration', () => {
    it('all builtin skills have documentation-only fields', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const allSkills = registry.list()
      for (const skill of allSkills) {
        expect(skill.documentPath).toBeDefined()
        expect(typeof skill.documentPath).toBe('string')
        expect(skill.documentPath.length).toBeGreaterThan(0)

        expect((skill as any).handler).toBeUndefined()
        expect((skill as any).schema).toBeUndefined()
        expect((skill as any).command).toBeUndefined()
        expect((skill as any).script).toBeUndefined()
        expect((skill as any).execute).toBeUndefined()
        expect((skill as any).parameters).toBeUndefined()
      }
    })

    it('builtin skills have valid allowedAgentTypes from the closed set', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const validAgentTypes = ['main', 'subagent', 'background', 'workflow_step', 'remote']
      const allSkills = registry.list()

      for (const skill of allSkills) {
        for (const agentType of skill.allowedAgentTypes) {
          expect(validAgentTypes).toContain(agentType)
        }
      }
    })

    it('no builtin skill allows remote agent type', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const allSkills = registry.list()
      for (const skill of allSkills) {
        expect(skill.allowedAgentTypes).not.toContain('remote')
      }
    })
  })
})
