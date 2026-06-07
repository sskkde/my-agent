/**
 * Effective Tool IDs Computation
 *
 * Pure utility function for computing the effective set of allowed tool IDs
 * based on agent configuration and known tool catalog.
 *
 * Semantics:
 * - null = inherit (all known tools)
 * - [] = no tools
 * - explicit list = intersection with known tools
 */

import type { AgentConfig } from '../storage/agent-config-store.js'

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
