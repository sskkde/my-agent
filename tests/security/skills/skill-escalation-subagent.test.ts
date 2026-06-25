/**
 * Skill Escalation Security Tests - Subagent and Workflow Step
 *
 * Validates that subagent and workflow_step envelopes deny admin skills.
 */

import { describe, it, expect } from 'vitest'
import { createAgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'
import { computeEffectiveSkillIdsWithEnvelope } from '../../../src/foreground/effective-skill-ids.js'
import { makeSkillCatalog, MINIMAX_SKILL_IDS } from './skill-escalation-setup.js'

describe('Skill Escalation - Subagent and Workflow Step', () => {
  const envelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
  const catalog = makeSkillCatalog()

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

    it('subagent allows MiniMax skills (write category in SUBAGENT_CATEGORIES)', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'subagent',
        catalog,
        envelopeRegistry,
        [...MINIMAX_SKILL_IDS, 'memory_research'],
      )

      expect(effective).toContain('memory_research')
      for (const minimaxId of MINIMAX_SKILL_IDS) {
        expect(effective).toContain(minimaxId)
      }
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

    it('workflow_step allows MiniMax skills (write category in WORKFLOW_STEP_CATEGORIES)', () => {
      const effective = computeEffectiveSkillIdsWithEnvelope(
        'workflow_step',
        catalog,
        envelopeRegistry,
        [...MINIMAX_SKILL_IDS, 'session_status'],
      )

      expect(effective).toContain('session_status')
      for (const minimaxId of MINIMAX_SKILL_IDS) {
        expect(effective).toContain(minimaxId)
      }
    })
  })
})
