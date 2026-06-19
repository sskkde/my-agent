/**
 * Prompt Projection Types - Type definitions for PromptProjectionResolver.
 *
 * Defines input/output types for resolving prompt projections (persona, tool selection policy, memory policy).
 * These projections provide structured configuration for model input building.
 *
 * @module prompt/prompt-projection-types
 */

import type {
  PersonaProjection,
  ToolSelectionPolicyProjection,
  MemoryPolicyProjection,
} from '../kernel/model-input/model-input-types.js'
import type { AgentType } from '../context/types.js'
import type { LaunchSource } from '../taxonomy/launch-source-policy.js'

/**
 * Input parameters for PromptProjectionResolver.resolve().
 *
 * Provides taxonomy context so the resolver can select projections
 * appropriate for the agent type, profile, and output contract.
 */
export interface PromptProjectionResolveInput {
  /** Runtime agent class */
  agentType?: AgentType
  /** Capability/persona profile identifier */
  agentProfile?: string
  /** Platform-owned output schema identifier */
  outputContract?: string
  /** Audit-only launch source */
  launchSource?: LaunchSource
  /** Provider family for provider-specific projection adjustments */
  providerFamily?: string
}

/**
 * Result of PromptProjectionResolver.resolve().
 *
 * Contains optional projection objects that are compatible with ModelInputBuildInput fields.
 * Each projection is a structured object (NOT plain text) that will be rendered
 * by existing render*Projection() functions.
 */
export interface PromptProjectionResolveResult {
  /** Persona projection for expression style and preferences */
  personaProjection?: PersonaProjection
  /** Tool selection policy projection for tool selection heuristics */
  toolSelectionPolicy?: ToolSelectionPolicyProjection
  /** Memory policy projection for memory usage rules */
  memoryPolicyProjection?: MemoryPolicyProjection
}

/**
 * Resolver interface for prompt projections.
 *
 * Implementations should return structured projection objects that are compatible
 * with ModelInputBuildInput fields. Template content should fill structured object
 * fields (e.g., styleGuidelines, heuristics, useRules), which are then rendered
 * to text by existing render*Projection() functions.
 */
export interface PromptProjectionResolver {
  /**
   * Resolve prompt projections based on input parameters.
   *
   * @param input - Resolution parameters (currently empty, reserved for future use)
   * @returns Promise resolving to projection objects
   */
  resolve(input: PromptProjectionResolveInput): Promise<PromptProjectionResolveResult>
}
