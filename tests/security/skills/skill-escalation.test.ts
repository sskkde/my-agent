/**
 * Skill Escalation Security Tests
 *
 * Validates that skill access cannot be escalated beyond AgentType envelope
 * boundaries. Skills are documentation-only records whose visibility is
 * governed by the envelope ∩ profile ∩ config intersection. No combination
 * of profile, config, or policy can expand skill access beyond the envelope.
 *
 * @module security/skills/skill-escalation
 */

import { describe, it, expect } from 'vitest'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import { computeEffectiveSkillIdsWithEnvelope, type SkillCatalogEntry } from '../../../src/foreground/effective-skill-ids.js'
import { createSkillRegistry } from '../../../src/skills/skill-registry.js'
import { registerBuiltinSkills } from '../../../src/skills/builtin/manifest.js'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeSkillCatalog(): SkillCatalogEntry[] {
  return [
    { id: 'artifact_workflow', category: 'write' },
    { id: 'memory_research', category: 'read' },
    { id: 'session_status', category: 'read' },
    { id: 'documentation_search', category: 'search' },
    { id: 'web_research_guidance', category: 'search' },
    { id: 'admin_config', category: 'admin' },
    { id: 'custom_automation', category: 'automation' },
    { id: 'internal_ops', category: 'internal' },
  ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Skill Escalation Security Tests', () => {
  const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
  const catalog = makeSkillCatalog()

  describe('remote agent type denies ALL skills', () => {
    it('remote agent cannot access any skill regardless of profile or config', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'remote',
        catalog,
        envelopeRegistry,
        ['memory_research', 'session_status', 'documentation_search'],
        ['memory_research', 'session_status', 'documentation_search', 'artifact_workflow'],
      )

      expect(effective).toEqual([])
    })

    it('remote agent with undefined profile and config gets no skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'remote',
        catalog,
        envelopeRegistry,
      )

      expect(effective).toEqual([])
    })

    it('remote agent with broad config still gets no skills', () => {
      const allIds = catalog.map((c) => c.id)
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'remote',
        catalog,
        envelopeRegistry,
        allIds,
        allIds,
      )

      expect(effective).toEqual([])
    })
  })

  describe('main agent envelope denies write/automation/admin skills', () => {
    it('main agent cannot access write-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalog,
        envelopeRegistry,
        ['artifact_workflow', 'memory_research', 'session_status'],
      )

      expect(effective).toContain('memory_research')
      expect(effective).toContain('session_status')
      expect(effective).not.toContain('artifact_workflow')
    })

    it('main agent cannot access automation-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalog,
        envelopeRegistry,
        ['custom_automation', 'memory_research'],
      )

      expect(effective).toContain('memory_research')
      expect(effective).not.toContain('custom_automation')
    })

    it('main agent cannot access admin-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalog,
        envelopeRegistry,
        ['admin_config', 'session_status'],
      )

      expect(effective).toContain('session_status')
      expect(effective).not.toContain('admin_config')
    })

    it('main agent can access read/search/internal skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalog,
        envelopeRegistry,
        ['memory_research', 'session_status', 'documentation_search', 'web_research_guidance', 'internal_ops'],
      )

      expect(effective).toContain('memory_research')
      expect(effective).toContain('session_status')
      expect(effective).toContain('documentation_search')
      expect(effective).toContain('web_research_guidance')
      expect(effective).toContain('internal_ops')
    })
  })

  describe('background agent envelope denies write/automation/admin skills', () => {
    it('background agent cannot access write-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'background',
        catalog,
        envelopeRegistry,
        ['artifact_workflow', 'memory_research'],
      )

      expect(effective).toContain('memory_research')
      expect(effective).not.toContain('artifact_workflow')
    })

    it('background agent cannot access automation-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'background',
        catalog,
        envelopeRegistry,
        ['custom_automation', 'documentation_search'],
      )

      expect(effective).toContain('documentation_search')
      expect(effective).not.toContain('custom_automation')
    })

    it('background agent cannot access admin-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'background',
        catalog,
        envelopeRegistry,
        ['admin_config', 'session_status'],
      )

      expect(effective).toContain('session_status')
      expect(effective).not.toContain('admin_config')
    })
  })

  describe('subagent envelope denies admin skills', () => {
    it('subagent cannot access admin-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'subagent',
        catalog,
        envelopeRegistry,
        ['admin_config', 'artifact_workflow', 'memory_research'],
      )

      expect(effective).toContain('artifact_workflow')
      expect(effective).toContain('memory_research')
      expect(effective).not.toContain('admin_config')
    })

    it('subagent can access write and automation skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'subagent',
        catalog,
        envelopeRegistry,
        ['artifact_workflow', 'custom_automation', 'memory_research'],
      )

      expect(effective).toContain('artifact_workflow')
      expect(effective).toContain('custom_automation')
      expect(effective).toContain('memory_research')
    })
  })

  describe('workflow_step envelope denies admin skills', () => {
    it('workflow_step cannot access admin-category skills', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'workflow_step',
        catalog,
        envelopeRegistry,
        ['admin_config', 'artifact_workflow', 'custom_automation'],
      )

      expect(effective).toContain('artifact_workflow')
      expect(effective).toContain('custom_automation')
      expect(effective).not.toContain('admin_config')
    })
  })

  describe('envelope is the outermost boundary', () => {
    it('profile cannot expand beyond envelope — write skill denied for main even if profile includes it', () => {
      const profileSkillIds = ['artifact_workflow', 'memory_research', 'session_status']
      const configSkillIds = ['artifact_workflow', 'memory_research', 'session_status']
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalog,
        envelopeRegistry,
        profileSkillIds,
        configSkillIds,
      )

      expect(effective).toContain('memory_research')
      expect(effective).toContain('session_status')
      expect(effective).not.toContain('artifact_workflow')
    })

    it('config cannot expand beyond envelope — admin skill denied for subagent even if config includes it', () => {
      const profileSkillIds = ['admin_config', 'artifact_workflow']
      const configSkillIds = ['admin_config', 'artifact_workflow']
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'subagent',
        catalog,
        envelopeRegistry,
        profileSkillIds,
        configSkillIds,
      )

      expect(effective).toContain('artifact_workflow')
      expect(effective).not.toContain('admin_config')
    })

    it('no combination of profile + config can override envelope for background', () => {
      const allIds = catalog.map((c) => c.id)
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'background',
        catalog,
        envelopeRegistry,
        allIds,
        allIds,
      )

      // Background only allows read/search/internal
      expect(effective).toContain('memory_research')
      expect(effective).toContain('session_status')
      expect(effective).toContain('documentation_search')
      expect(effective).toContain('web_research_guidance')
      expect(effective).toContain('internal_ops')
      expect(effective).not.toContain('artifact_workflow')
      expect(effective).not.toContain('custom_automation')
      expect(effective).not.toContain('admin_config')
    })

    it('empty config allowedSkillIds denies all skills even if profile includes them', () => {
      const profileSkillIds = ['memory_research', 'session_status', 'documentation_search']
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalog,
        envelopeRegistry,
        profileSkillIds,
        [], // empty config = deny all
      )

      expect(effective).toEqual([])
    })

    it('empty profile does not expand — envelope governs when profile is empty', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'main',
        catalog,
        envelopeRegistry,
        [], // empty profile
      )

      // With empty profile, envelope still governs
      expect(effective).toContain('memory_research')
      expect(effective).toContain('session_status')
      expect(effective).toContain('documentation_search')
      expect(effective).toContain('web_research_guidance')
      expect(effective).toContain('internal_ops')
      expect(effective).not.toContain('artifact_workflow')
      expect(effective).not.toContain('admin_config')
    })
  })

  describe('skill ID cannot spoof tool ID to gain execution', () => {
    it('skill with same ID as a tool is still documentation-only', () => {
      // Some deprecated aliases share IDs with tools (e.g., 'web_search')
      // These are marked deprecated and enabled:false in the registry
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      // 'web_search' is a deprecated alias in the skill registry
      const skill = registry.get('web_search')
      if (skill) {
        // It's a deprecated alias — documentation only, not executable
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

      // Known tool IDs from the platform
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
        // Must have documentPath (documentation-only)
        expect(skill.documentPath).toBeDefined()
        expect(typeof skill.documentPath).toBe('string')
        expect(skill.documentPath.length).toBeGreaterThan(0)

        // Must NOT have executable fields (runtime check)
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
