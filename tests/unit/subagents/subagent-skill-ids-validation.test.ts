import { describe, it, expect } from 'vitest'
import {
  createSubagentRegistry,
  type SubagentRegistry,
} from '../../../src/subagents/registry.js'
import { registerBuiltInSubagents } from '../../../src/subagents/builtin-definitions.js'
import { createSkillRegistry, type SkillRegistry } from '../../../src/skills/skill-registry.js'
import { registerBuiltinSkills } from '../../../src/skills/builtin/manifest.js'
import { createAgentTypeSkillEnvelopeRegistry, type AgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'

function createPopulatedSubagentRegistry(): SubagentRegistry {
  const registry = createSubagentRegistry()
  registerBuiltInSubagents(registry)
  return registry
}

describe('SubagentDefinition allowedSkillIds validation', () => {
  const skillRegistry: SkillRegistry = createSkillRegistry()
  registerBuiltinSkills(skillRegistry)
  const envelopeRegistry: AgentTypeSkillEnvelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
  const subagentRegistry = createPopulatedSubagentRegistry()
  const definitions = subagentRegistry.list()

  it('all built-in subagents should have allowedSkillIds defined', () => {
    for (const def of definitions) {
      expect(
        def.allowedSkillIds,
        `Subagent "${def.agentType}" missing allowedSkillIds`,
      ).toBeDefined()
      expect(
        def.allowedSkillIds!.length,
        `Subagent "${def.agentType}" has empty allowedSkillIds`,
      ).toBeGreaterThan(0)
    }
  })

  it('every declared skill ID should resolve in the skill registry', () => {
    for (const def of definitions) {
      const unresolved = (def.allowedSkillIds ?? []).filter(
        (id) => !skillRegistry.has(id),
      )
      expect(
        unresolved,
        `Subagent "${def.agentType}" has unresolved skill IDs: ${unresolved.join(', ')}`,
      ).toEqual([])
    }
  })

  it('every declared skill ID should be allowed by the subagent envelope', () => {
    const agentType = 'subagent'
    for (const def of definitions) {
      const denied = (def.allowedSkillIds ?? []).filter((id) => {
        const skill = skillRegistry.get(id)
        if (!skill) return true
        return !envelopeRegistry.isSkillAllowedByEnvelope(agentType, id, skill.category)
      })
      expect(
        denied,
        `Subagent "${def.agentType}" skill IDs denied by ${agentType} envelope: ${denied.join(', ')}`,
      ).toEqual([])
    }
  })
})
