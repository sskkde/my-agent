/**
 * Skill Escalation Security Tests - Background Agent
 *
 * Validates that background agent envelope denies write/automation/admin skills.
 */

import { describe, it, expect } from 'vitest'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import { computeEffectiveSkillIdsWithEnvelope } from '../../../src/foreground/effective-skill-ids.js'
import { makeSkillCatalog, MINIMAX_SKILL_IDS } from './skill-escalation-setup.js'

describe('Skill Escalation - Background Agent', () => {
  const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
  const catalog = makeSkillCatalog()

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

  it('background agent allows read MiniMax skills and denies write MiniMax skills', () => {
    const effective = computeEffectiveSkillIdsWithEnvelope(
      'background',
      catalog,
      envelopeRegistry,
      [...MINIMAX_SKILL_IDS, 'documentation_search'],
    )

    expect(effective).toContain('documentation_search')
    expect(effective).toContain('minimax-xlsx')
    for (const minimaxId of MINIMAX_SKILL_IDS.filter((id) => id !== 'minimax-xlsx')) {
      expect(effective).not.toContain(minimaxId)
    }
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

    expect(effective).toContain('memory_research')
    expect(effective).toContain('session_status')
    expect(effective).toContain('documentation_search')
    expect(effective).toContain('web_research_guidance')
    expect(effective).toContain('internal_ops')
    expect(effective).not.toContain('artifact_workflow')
    expect(effective).not.toContain('custom_automation')
    expect(effective).not.toContain('admin_config')
  })
})
