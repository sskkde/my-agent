/**
 * Prompt Taxonomy Migration Gap Tests
 *
 * Regression tests for the prompt taxonomy migration. These tests document
 * the gaps closed by the migration and prevent legacy prompt paths from
 * returning.
 *
 * Covered gaps:
 * 1. AgentProfile.promptTemplateIds entries that don't resolve in PromptTemplateRegistry
 * 2. Legacy `agents:` / `subagent.` prefixed IDs in promptTemplateIds
 * 3. System profiles missing `agentProfile:*` registry records
 * 4. AgentType variants missing `agentType:*` registry records
 * 5. PromptProviderFamily variants missing `provider:*` registry records
 * 6. Search profile web_fetch scope alignment
 */

import { describe, it, expect } from 'vitest'
import {
  createAgentProfileRegistry,
  registerSystemProfiles,
  type AgentProfileRegistry,
} from '../../../src/taxonomy/agent-profile-registry.js'
import {
  PROMPT_TEMPLATE_REGISTRY,
  PromptTemplateRegistry,
} from '../../../src/prompt/prompt-template-registry.js'
import type { AgentType } from '../../../src/context/types.js'
import type { PromptProviderFamily } from '../../../src/llm/types.js'
import { assertSearchScope } from '../../../src/search/search-subagent-types.js'
import { createSkillRegistry, type SkillRegistry } from '../../../src/skills/skill-registry.js'
import { registerBuiltinSkills } from '../../../src/skills/builtin/manifest.js'
import { createAgentTypeSkillEnvelopeRegistry, type AgentTypeSkillEnvelopeRegistry } from '../../../src/permissions/agent-type-skill-envelope.js'

// ── Canonical variant sets ────────────────────────────────────────────────────

const ALL_AGENT_TYPES: readonly AgentType[] = [
  'main',
  'subagent',
  'background',
  'workflow_step',
  'remote',
]

const ALL_PROMPT_PROVIDER_FAMILIES: readonly PromptProviderFamily[] = [
  'openai',
  'deepseek',
  'ollama',
  'anthropic',
  'gemini',
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function createPopulatedProfileRegistry(): AgentProfileRegistry {
  const registry = createAgentProfileRegistry()
  registerSystemProfiles(registry)
  return registry
}

function isLegacyId(templateId: string): boolean {
  return templateId.startsWith('agents:') || templateId.startsWith('subagent.')
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Prompt Taxonomy Migration Gaps', () => {
  const profileRegistry = createPopulatedProfileRegistry()
  const templateRegistry = new PromptTemplateRegistry()

  // ──────────────────────────────────────────────────────────────────────────
  // GAP 1: Every AgentProfile.promptTemplateIds must resolve in registry
  // ──────────────────────────────────────────────────────────────────────────

  describe('GAP 1: promptTemplateIds resolution', () => {
    const profiles = profileRegistry.list()

    for (const profile of profiles) {
      it(`${profile.id}: all promptTemplateIds resolve in PromptTemplateRegistry`, () => {
        const unresolved: string[] = []

        for (const templateId of profile.promptTemplateIds) {
          if (!templateRegistry.hasTemplate(templateId)) {
            unresolved.push(templateId)
          }
        }

        // When this test FAILS, `unresolved` lists the template IDs that need
        // to be registered in PROMPT_TEMPLATE_REGISTRY before production cut-over.
        expect(
          unresolved,
          `Profile "${profile.id}" has unresolved promptTemplateIds: ${unresolved.join(', ')}`,
        ).toEqual([])
      })
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GAP 2: No legacy `agents:` or `subagent.` IDs in promptTemplateIds
  // ──────────────────────────────────────────────────────────────────────────

  describe('GAP 2: no legacy agents: / subagent. IDs', () => {
    const profiles = profileRegistry.list()

    for (const profile of profiles) {
      it(`${profile.id}: promptTemplateIds contain no legacy prefix`, () => {
        const legacyIds = profile.promptTemplateIds.filter(isLegacyId)

        // When this test FAILS, `legacyIds` lists the IDs that must be
        // migrated to new taxonomy (`agentProfile:*`, `agentType:*`, etc.)
        expect(
          legacyIds,
          `Profile "${profile.id}" still uses legacy promptTemplateIds: ${legacyIds.join(', ')}`,
        ).toEqual([])
      })
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GAP 3: Every system profile must have an agentProfile:* record
  // ──────────────────────────────────────────────────────────────────────────

  describe('GAP 3: system profiles need agentProfile:* records', () => {
    const profiles = profileRegistry.list()

    for (const profile of profiles) {
      it(`${profile.id}: has a matching agentProfile:${profile.id} template`, () => {
        const expectedId = `agentProfile:${profile.id}`
        const exists = templateRegistry.hasTemplate(expectedId)

        // When this test FAILS, the profile needs a PromptTemplateRecord
        // with id `agentProfile:<profileId>` added to PROMPT_TEMPLATE_REGISTRY.
        expect(
          exists,
          `Missing template "${expectedId}" for system profile "${profile.id}"`,
        ).toBe(true)
      })
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GAP 4: Every AgentType variant must have an agentType:* record
  // ──────────────────────────────────────────────────────────────────────────

  describe('GAP 4: AgentType variants need agentType:* records', () => {
    for (const agentType of ALL_AGENT_TYPES) {
      it(`agentType:${agentType} template exists in registry`, () => {
        const templateId = `agentType:${agentType}`
        const exists = templateRegistry.hasTemplate(templateId)

        // When this test FAILS, the agent type needs a PromptTemplateRecord
        // with taxonomyLayer: 'agentType' and agentType field set.
        expect(
          exists,
          `Missing agentType template "${templateId}" — registry only has: ${Array.from(PROMPT_TEMPLATE_REGISTRY.keys()).filter((k) => k.startsWith('agentType:')).join(', ')}`,
        ).toBe(true)
      })
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GAP 5: Every PromptProviderFamily variant must have a provider:* record
  // ──────────────────────────────────────────────────────────────────────────

  describe('GAP 5: PromptProviderFamily variants need provider:* records', () => {
    for (const family of ALL_PROMPT_PROVIDER_FAMILIES) {
      it(`provider:${family} template exists in registry`, () => {
        const templateId = `provider:${family}`
        const exists = templateRegistry.hasTemplate(templateId)

        // When this test FAILS, the provider family needs a PromptTemplateRecord
        // with taxonomyLayer: 'provider' and providerFamily field set.
        expect(
          exists,
          `Missing provider template "${templateId}" — registry only has: ${Array.from(PROMPT_TEMPLATE_REGISTRY.keys()).filter((k) => k.startsWith('provider:')).join(', ')}`,
        ).toBe(true)
      })
    }
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GAP 6: Search profile tool scope alignment
  // ──────────────────────────────────────────────────────────────────────────

  describe('GAP 6: search profile tool scope alignment', () => {
    it('search profile excludes web_fetch from defaultToolIds', () => {
      const searchProfile = profileRegistry.get('search')
      expect(searchProfile).toBeDefined()
      expect(searchProfile?.defaultToolIds).not.toContain('web_fetch')
    })

    it('assertSearchScope rejects web_fetch', () => {
      expect(() => assertSearchScope('web_fetch')).toThrow()
    })

    it('search profile defaultToolIds are a subset of search scope', () => {
      const searchProfile = profileRegistry.get('search')
      expect(searchProfile).toBeDefined()

      const toolsInScope = ['web_search', 'docs_search']
      const profileTools = searchProfile?.defaultToolIds ?? []

      const mismatchedTools = profileTools.filter(
        (tool) => !toolsInScope.includes(tool),
      )

      expect(
        mismatchedTools,
        `Search profile defaultToolIds include tools rejected by assertSearchScope: ${mismatchedTools.join(', ')}`,
      ).toEqual([])
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // GAP 7: Every AgentProfile.defaultSkillIds must resolve and be envelope-allowed
  // ──────────────────────────────────────────────────────────────────────────

  describe('GAP 7: defaultSkillIds resolution and envelope validation', () => {
    const skillRegistry: SkillRegistry = createSkillRegistry()
    registerBuiltinSkills(skillRegistry)
    const envelopeRegistry: AgentTypeSkillEnvelopeRegistry = createAgentTypeSkillEnvelopeRegistry()
    const profiles = profileRegistry.list()

    for (const profile of profiles) {
      it(`${profile.id}: all defaultSkillIds resolve in SkillRegistry`, () => {
        const skillIds = profile.defaultSkillIds ?? []
        const unresolved = skillIds.filter((id) => !skillRegistry.has(id))

        expect(
          unresolved,
          `Profile "${profile.id}" has unresolved defaultSkillIds: ${unresolved.join(', ')}`,
        ).toEqual([])
      })

      for (const agentType of profile.allowedAgentTypes) {
        it(`${profile.id}: defaultSkillIds allowed by ${agentType} envelope`, () => {
          const skillIds = profile.defaultSkillIds ?? []
          const denied = skillIds.filter((id) => {
            const skill = skillRegistry.get(id)
            if (!skill) return true
            return !envelopeRegistry.isSkillAllowedByEnvelope(agentType, id, skill.category)
          })

          expect(
            denied,
            `Profile "${profile.id}" defaultSkillIds denied by ${agentType} envelope: ${denied.join(', ')}`,
          ).toEqual([])
        })
      }
    }
  })
})
