/**
 * Skill Escalation Security Tests - Main Agent
 *
 * Validates that main agent envelope denies write/automation/admin skills.
 */

import { describe, it, expect } from 'vitest'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import { computeEffectiveSkillIdsWithEnvelope } from '../../../src/foreground/effective-skill-ids.js'
import { makeSkillCatalog, MINIMAX_SKILL_IDS } from './skill-escalation-setup.js'

describe('Skill Escalation - Main Agent', () => {
  const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
  const catalog = makeSkillCatalog()

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

  it('main agent allows read MiniMax skills and denies write MiniMax skills', () => {
    const effective = computeEffectiveSkillIdsWithEnvelope(
      'main',
      catalog,
      envelopeRegistry,
      [...MINIMAX_SKILL_IDS, 'memory_research', 'session_status'],
    )

    expect(effective).toContain('memory_research')
    expect(effective).toContain('session_status')
    expect(effective).toContain('minimax-xlsx')
    for (const minimaxId of MINIMAX_SKILL_IDS.filter((id) => id !== 'minimax-xlsx')) {
      expect(effective).not.toContain(minimaxId)
    }
  })

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

  it('empty config allowedSkillIds denies all skills even if profile includes them', () => {
    const profileSkillIds = ['memory_research', 'session_status', 'documentation_search']
    const effective = computeEffectiveSkillIdsWithEnvelope(
      'main',
      catalog,
      envelopeRegistry,
      profileSkillIds,
      [],
    )

    expect(effective).toEqual([])
  })

  it('empty profile does not expand — envelope governs when profile is empty', () => {
    const effective = computeEffectiveSkillIdsWithEnvelope(
      'main',
      catalog,
      envelopeRegistry,
      [],
    )

    expect(effective).toContain('memory_research')
    expect(effective).toContain('session_status')
    expect(effective).toContain('documentation_search')
    expect(effective).toContain('web_research_guidance')
    expect(effective).toContain('internal_ops')
    expect(effective).not.toContain('artifact_workflow')
    expect(effective).not.toContain('admin_config')
  })
})
