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

/**
 * Input parameters for PromptProjectionResolver.resolve().
 *
 * Currently empty for future expansion. May include fields like:
 * - agentKind?: string - Agent kind for context-aware resolution
 * - providerFamily?: string - Provider family for template selection
 */
export interface PromptProjectionResolveInput {
  // Reserved for future expansion
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
