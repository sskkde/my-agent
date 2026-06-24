import { describe, it, expect } from 'vitest'
import {
  createAgentTypeSkillEnvelopeRegistry,
  intersectSkillIdSets,
} from '../../../src/permissions/agent-type-skill-envelope.js'
import type { SkillCategory } from '../../../src/skills/types.js'

describe('AgentTypeSkillEnvelopeRegistry', () => {
  const registry = createAgentTypeSkillEnvelopeRegistry()

  describe('getEnvelope', () => {
    it('returns envelope for main agentType', () => {
      const envelope = registry.getEnvelope('main')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('main')
      expect(envelope!.allowedCategories.has('read')).toBe(true)
      expect(envelope!.allowedCategories.has('search')).toBe(true)
      expect(envelope!.allowedCategories.has('internal')).toBe(true)
    })

    it('returns envelope for subagent agentType', () => {
      const envelope = registry.getEnvelope('subagent')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('subagent')
      expect(envelope!.allowedCategories.has('write')).toBe(true)
      expect(envelope!.allowedCategories.has('automation')).toBe(true)
    })

    it('returns envelope for background agentType', () => {
      const envelope = registry.getEnvelope('background')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('background')
      expect(envelope!.allowedCategories.has('read')).toBe(true)
      expect(envelope!.allowedCategories.has('write')).toBe(false)
    })

    it('returns envelope for workflow_step agentType', () => {
      const envelope = registry.getEnvelope('workflow_step')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('workflow_step')
      expect(envelope!.allowedCategories.has('automation')).toBe(true)
    })

    it('returns envelope for remote agentType (hard-deny)', () => {
      const envelope = registry.getEnvelope('remote')
      expect(envelope).toBeDefined()
      expect(envelope!.agentType).toBe('remote')
      expect(envelope!.allowedCategories.size).toBe(0)
    })
  })

  describe('isSkillAllowedByEnvelope', () => {
    it('main: allows read/search/internal categories', () => {
      expect(registry.isSkillAllowedByEnvelope('main', 'memory_research', 'read')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('main', 'documentation_search', 'search')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('main', 'session_status', 'internal')).toBe(true)
    })

    it('main: denies write/automation/admin/custom categories', () => {
      expect(registry.isSkillAllowedByEnvelope('main', 'artifact_workflow', 'write')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('main', 'auto_deploy', 'automation')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('main', 'admin_config', 'admin')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('main', 'custom_skill', 'custom')).toBe(false)
    })

    it('subagent: allows read/search/internal/write/automation categories', () => {
      expect(registry.isSkillAllowedByEnvelope('subagent', 'memory_research', 'read')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('subagent', 'artifact_workflow', 'write')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('subagent', 'auto_deploy', 'automation')).toBe(true)
    })

    it('subagent: denies admin skills even if category is allowed', () => {
      expect(registry.isSkillAllowedByEnvelope('subagent', 'admin_config', 'admin')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('subagent', 'manage_users', 'admin')).toBe(false)
    })

    it('background: allows only read/search/internal', () => {
      expect(registry.isSkillAllowedByEnvelope('background', 'memory_research', 'read')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('background', 'documentation_search', 'search')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('background', 'artifact_workflow', 'write')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('background', 'auto_deploy', 'automation')).toBe(false)
    })

    it('workflow_step: allows read/search/internal/write/automation', () => {
      expect(registry.isSkillAllowedByEnvelope('workflow_step', 'memory_research', 'read')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('workflow_step', 'artifact_workflow', 'write')).toBe(true)
      expect(registry.isSkillAllowedByEnvelope('workflow_step', 'auto_deploy', 'automation')).toBe(true)
    })

    it('workflow_step: denies admin skills', () => {
      expect(registry.isSkillAllowedByEnvelope('workflow_step', 'admin_config', 'admin')).toBe(false)
    })

    it('remote: denies ALL skills unconditionally', () => {
      expect(registry.isSkillAllowedByEnvelope('remote', 'memory_research', 'read')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('remote', 'documentation_search', 'search')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('remote', 'session_status', 'internal')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('remote', 'artifact_workflow', 'write')).toBe(false)
      expect(registry.isSkillAllowedByEnvelope('remote', 'auto_deploy', 'automation')).toBe(false)
    })

    it('unknown agentType: denies by default', () => {
      // Cast to bypass type safety — simulate an unregistered agent type
      const unknownType = 'unknown_type' as never
      expect(registry.isSkillAllowedByEnvelope(unknownType, 'memory_research', 'read')).toBe(false)
    })
  })

  describe('getAllowedSkillIds', () => {
    const catalog = [
      { id: 'memory_research', category: 'read' as SkillCategory },
      { id: 'documentation_search', category: 'search' as SkillCategory },
      { id: 'session_status', category: 'internal' as SkillCategory },
      { id: 'artifact_workflow', category: 'write' as SkillCategory },
      { id: 'auto_deploy', category: 'automation' as SkillCategory },
      { id: 'admin_config', category: 'admin' as SkillCategory },
    ]

    it('main: returns only read/search/internal skills', () => {
      const allowed = registry.getAllowedSkillIds('main', catalog)
      expect(allowed).toContain('memory_research')
      expect(allowed).toContain('documentation_search')
      expect(allowed).toContain('session_status')
      expect(allowed).not.toContain('artifact_workflow')
      expect(allowed).not.toContain('auto_deploy')
      expect(allowed).not.toContain('admin_config')
    })

    it('subagent: returns read/search/internal/write/automation minus denied IDs', () => {
      const allowed = registry.getAllowedSkillIds('subagent', catalog)
      expect(allowed).toContain('memory_research')
      expect(allowed).toContain('documentation_search')
      expect(allowed).toContain('session_status')
      expect(allowed).toContain('artifact_workflow')
      expect(allowed).toContain('auto_deploy')
      expect(allowed).not.toContain('admin_config')
    })

    it('background: returns only read/search/internal', () => {
      const allowed = registry.getAllowedSkillIds('background', catalog)
      expect(allowed).toContain('memory_research')
      expect(allowed).toContain('documentation_search')
      expect(allowed).toContain('session_status')
      expect(allowed).not.toContain('artifact_workflow')
      expect(allowed).not.toContain('auto_deploy')
    })

    it('workflow_step: returns read/search/internal/write/automation minus denied IDs', () => {
      const allowed = registry.getAllowedSkillIds('workflow_step', catalog)
      expect(allowed).toContain('memory_research')
      expect(allowed).toContain('artifact_workflow')
      expect(allowed).toContain('auto_deploy')
      expect(allowed).not.toContain('admin_config')
    })

    it('remote: returns empty array', () => {
      const allowed = registry.getAllowedSkillIds('remote', catalog)
      expect(allowed).toEqual([])
    })

    it('unknown agentType: returns empty array', () => {
      const unknownType = 'unknown_type' as never
      const allowed = registry.getAllowedSkillIds(unknownType, catalog)
      expect(allowed).toEqual([])
    })
  })

  describe('envelope boundary enforcement (failure scenarios)', () => {
    const catalog = [
      { id: 'artifact_workflow', category: 'write' as SkillCategory },
      { id: 'auto_deploy', category: 'automation' as SkillCategory },
      { id: 'admin_config', category: 'admin' as SkillCategory },
    ]

    it('workflow_step cannot receive admin skills even if config allowlist includes them', () => {
      const allowed = registry.getAllowedSkillIds('workflow_step', catalog)
      expect(allowed).not.toContain('admin_config')
    })

    it('background cannot receive write/automation skills even if catalog includes them', () => {
      const allowed = registry.getAllowedSkillIds('background', catalog)
      expect(allowed).toEqual([])
    })

    it('main cannot receive write/automation/admin skills', () => {
      const allowed = registry.getAllowedSkillIds('main', catalog)
      expect(allowed).toEqual([])
    })
  })
})

describe('intersectSkillIdSets', () => {
  it('returns intersection of two sets', () => {
    const result = intersectSkillIdSets(
      new Set(['skill_a', 'skill_b', 'skill_c']),
      new Set(['skill_b', 'skill_c', 'skill_d']),
    )
    expect(result).toEqual(expect.arrayContaining(['skill_b', 'skill_c']))
    expect(result).toHaveLength(2)
  })

  it('returns intersection of three sets', () => {
    const result = intersectSkillIdSets(
      new Set(['skill_a', 'skill_b', 'skill_c']),
      new Set(['skill_b', 'skill_c', 'skill_d']),
      new Set(['skill_c', 'skill_d', 'skill_e']),
    )
    expect(result).toEqual(['skill_c'])
  })

  it('returns empty when one set is empty', () => {
    const result = intersectSkillIdSets(
      new Set(['skill_a', 'skill_b']),
      new Set([]),
    )
    expect(result).toEqual([])
  })

  it('skips undefined sets', () => {
    const result = intersectSkillIdSets(
      new Set(['skill_a', 'skill_b']),
      undefined,
      new Set(['skill_b', 'skill_c']),
    )
    expect(result).toEqual(['skill_b'])
  })

  it('returns empty when no sets provided', () => {
    const result = intersectSkillIdSets()
    expect(result).toEqual([])
  })

  it('works with arrays', () => {
    const result = intersectSkillIdSets(['skill_a', 'skill_b', 'skill_c'], ['skill_b', 'skill_c', 'skill_d'])
    expect(result).toEqual(expect.arrayContaining(['skill_b', 'skill_c']))
    expect(result).toHaveLength(2)
  })
})