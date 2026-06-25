/**
 * Skill Escalation Security Tests - Remote Agent
 *
 * Validates that remote agent type denies ALL skills.
 */

import { describe, it, expect } from 'vitest'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import { computeEffectiveSkillIdsWithEnvelope } from '../../../src/foreground/effective-skill-ids.js'
import { makeSkillCatalog, MINIMAX_SKILL_IDS } from './skill-escalation-setup.js'

describe('Skill Escalation - Remote Agent', () => {
  const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
  const catalog = makeSkillCatalog()

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

  it('remote agent denies all MiniMax skills even when explicitly requested', () => {
    const effective = computeEffectiveSkillIdsWithEnvelope(
      'remote',
      catalog,
      envelopeRegistry,
      MINIMAX_SKILL_IDS,
      MINIMAX_SKILL_IDS,
    )

    expect(effective).toEqual([])
  })

  it('no combination of profile + config can override envelope for remote with MiniMax skills', () => {
    const allIds = catalog.map((c) => c.id)
    const effective = computeEffectiveSkillIdsWithEnvelope(
      'remote',
      catalog,
      envelopeRegistry,
      allIds,
      allIds,
    )

    expect(effective).toEqual([])
    for (const minimaxId of MINIMAX_SKILL_IDS) {
      expect(effective).not.toContain(minimaxId)
    }
  })
})
