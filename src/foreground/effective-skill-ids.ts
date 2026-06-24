/**
 * Effective Skill IDs Computation
 *
 * Pure utility function for computing the effective set of allowed skill IDs
 * based on agent configuration, known skill catalog, and AgentType envelope.
 *
 * Semantics:
 * - null = inherit (all known skills)
 * - [] = no skills
 * - explicit list = intersection with known skills
 *
 * With envelope enforcement:
 *   effective = AgentTypeSkillEnvelope ∩ AgentProfile.defaultSkillIds ∩ config ∩ policy
 *
 * The envelope is the outermost boundary — no profile or config can expand
 * beyond it.
 *
 * This mirrors {@link computeEffectiveToolIdsWithEnvelope} but operates on the
 * skill plane (documentation-only records), never the tool plane.
 */

import type { AgentConfig } from '../storage/agent-config-store.js'
import type { AgentType } from '../context/types.js'
import type { SkillCategory } from '../skills/types.js'
import type { AgentTypeSkillEnvelopeRegistry } from '../permissions/agent-type-skill-envelope.js'

/**
 * Skill catalog entry for envelope-aware computation.
 */
export interface SkillCatalogEntry {
  id: string
  category: SkillCategory
}

/**
 * Compute effective allowed skill IDs for routing prompt.
 *
 * @param agentConfig - Agent configuration (optional)
 * @param knownSkillIds - Array of all known skill IDs from the skill catalog
 * @returns Array of effective skill IDs to use
 *
 * @example
 * // No config - use all known skills
 * computeEffectiveAllowedSkillIds(undefined, ['skill_a', 'skill_b'])
 * // Returns: ['skill_a', 'skill_b']
 *
 * @example
 * // null allowedSkillIds - inherit all known skills
 * computeEffectiveAllowedSkillIds({ allowedSkillIds: null, ... }, ['skill_a', 'skill_b'])
 * // Returns: ['skill_a', 'skill_b']
 *
 * @example
 * // Empty array - no skills allowed
 * computeEffectiveAllowedSkillIds({ allowedSkillIds: [], ... }, ['skill_a', 'skill_b'])
 * // Returns: []
 *
 * @example
 * // Explicit list - intersect with known skills
 * computeEffectiveAllowedSkillIds({ allowedSkillIds: ['skill_a', 'skill_c'], ... }, ['skill_a', 'skill_b'])
 * // Returns: ['skill_a']
 */
export function computeEffectiveAllowedSkillIds(
  agentConfig: AgentConfig | undefined,
  knownSkillIds: string[],
): string[] {
  const allowed = agentConfig?.allowedSkillIds

  // null means inherit - use all known skills
  if (allowed === null) {
    return [...knownSkillIds]
  }

  // undefined (no config) - use all known skills
  if (allowed === undefined) {
    return [...knownSkillIds]
  }

  // empty array means no skills allowed
  if (allowed.length === 0) {
    return []
  }

  // explicit list - intersect with known skills
  return knownSkillIds.filter((id) => allowed.includes(id))
}

/**
 * Compute effective skill IDs with AgentType envelope enforcement.
 *
 * This is the security-critical function that enforces:
 *   effective = AgentTypeSkillEnvelope ∩ profileSkillIds ∩ configSkillIds
 *
 * The envelope is the outermost boundary. No downstream set can expand beyond it.
 *
 * @param agentType - The AgentType whose envelope is the outermost boundary
 * @param skillCatalog - Full skill catalog with category metadata
 * @param envelopeRegistry - Registry containing AgentType skill envelopes
 * @param profileSkillIds - Skill IDs from AgentProfile.defaultSkillIds (optional)
 * @param configSkillIds - Skill IDs from agent config allowedSkillIds (optional)
 * @returns Array of effective skill IDs that pass ALL boundaries
 */
export function computeEffectiveSkillIdsWithEnvelope(
  agentType: AgentType,
  skillCatalog: SkillCatalogEntry[],
  envelopeRegistry: AgentTypeSkillEnvelopeRegistry,
  profileSkillIds?: string[],
  configSkillIds?: string[],
): string[] {
  // Step 1: Apply envelope — the outermost boundary
  const envelopeAllowed = envelopeRegistry.getAllowedSkillIds(agentType, skillCatalog)

  // Remote agent: hard deny everything
  if (agentType === 'remote') {
    return []
  }

  // Step 2: Intersect with profile grants (if provided)
  // [] for profile means "no profile defaults" — envelope still governs
  let effective = envelopeAllowed
  if (profileSkillIds !== undefined && profileSkillIds.length > 0) {
    effective = effective.filter((id) => profileSkillIds.includes(id))
  }

  // Step 3: Intersect with config/policy (if provided)
  // [] for config means "user explicitly denies all skills"
  if (configSkillIds !== undefined) {
    if (configSkillIds.length === 0) {
      return []
    }
    effective = effective.filter((id) => configSkillIds.includes(id))
  }

  return effective
}