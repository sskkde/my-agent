/**
 * Effective Tool IDs Computation
 *
 * Pure utility function for computing the effective set of allowed tool IDs
 * based on agent configuration, known tool catalog, and AgentType envelope.
 *
 * Semantics:
 * - null = inherit (all known tools)
 * - [] = no tools
 * - explicit list = intersection with known tools
 *
 * With envelope enforcement:
 *   effective = AgentTypeEnvelope ∩ AgentProfile.grants ∩ policy ∩ approvals
 *
 * The envelope is the outermost boundary — no profile or policy can expand beyond it.
 */

import type { AgentConfig } from '../storage/agent-config-store.js'
import type { AgentType } from '../context/types.js'
import type { ToolCategory } from '../tools/types.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'

/**
 * Tool catalog entry for envelope-aware computation.
 */
export interface ToolCatalogEntry {
  id: string
  category: ToolCategory
}

/**
 * Compute effective allowed tool IDs for routing prompt.
 *
 * @param agentConfig - Agent configuration (optional)
 * @param knownToolIds - Array of all known tool IDs from the tool catalog
 * @returns Array of effective tool IDs to use
 *
 * @example
 * // No config - use all known tools
 * computeEffectiveAllowedToolIds(undefined, ['tool_a', 'tool_b'])
 * // Returns: ['tool_a', 'tool_b']
 *
 * @example
 * // null allowedToolIds - inherit all known tools
 * computeEffectiveAllowedToolIds({ allowedToolIds: null, ... }, ['tool_a', 'tool_b'])
 * // Returns: ['tool_a', 'tool_b']
 *
 * @example
 * // Empty array - no tools allowed
 * computeEffectiveAllowedToolIds({ allowedToolIds: [], ... }, ['tool_a', 'tool_b'])
 * // Returns: []
 *
 * @example
 * // Explicit list - intersect with known tools
 * computeEffectiveAllowedToolIds({ allowedToolIds: ['tool_a', 'tool_c'], ... }, ['tool_a', 'tool_b'])
 * // Returns: ['tool_a']
 */
export function computeEffectiveAllowedToolIds(agentConfig: AgentConfig | undefined, knownToolIds: string[]): string[] {
  const allowed = agentConfig?.allowedToolIds

  // null means inherit - use all known tools
  if (allowed === null) {
    return [...knownToolIds]
  }

  // undefined (no config) - use all known tools
  if (allowed === undefined) {
    return [...knownToolIds]
  }

  // empty array means no tools allowed
  if (allowed.length === 0) {
    return []
  }

  // explicit list - intersect with known tools
  return knownToolIds.filter((id) => allowed.includes(id))
}

/**
 * Compute effective tool IDs with AgentType envelope enforcement.
 *
 * This is the security-critical function that enforces:
 *   effective = AgentTypeEnvelope ∩ profileToolIds ∩ policyToolIds
 *
 * The envelope is the outermost boundary. No downstream set can expand beyond it.
 *
 * @param agentType - The AgentType whose envelope is the outermost boundary
 * @param toolCatalog - Full tool catalog with category metadata
 * @param envelopeRegistry - Registry containing AgentType envelopes
 * @param profileToolIds - Tool IDs from AgentProfile.defaultToolIds (optional)
 * @param policyToolIds - Tool IDs from policy/approvals (optional)
 * @returns Array of effective tool IDs that pass ALL boundaries
 */
export function computeEffectiveToolIdsWithEnvelope(
  agentType: AgentType,
  toolCatalog: ToolCatalogEntry[],
  envelopeRegistry: AgentTypeToolEnvelopeRegistry,
  profileToolIds?: string[],
  policyToolIds?: string[],
): string[] {
  // Step 1: Apply envelope — the outermost boundary
  const envelopeAllowed = envelopeRegistry.getAllowedToolIds(agentType, toolCatalog)

  // Remote agent: hard deny everything
  if (agentType === 'remote') {
    return []
  }

  // Step 2: Intersect with profile grants (if provided)
  let effective = envelopeAllowed
  if (profileToolIds !== undefined && profileToolIds.length > 0) {
    effective = effective.filter((id) => profileToolIds.includes(id))
  }

  // Step 3: Intersect with policy/approvals (if provided)
  if (policyToolIds !== undefined && policyToolIds.length > 0) {
    effective = effective.filter((id) => policyToolIds.includes(id))
  }

  return effective
}
