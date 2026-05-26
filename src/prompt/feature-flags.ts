/**
 * Feature Flags for Prompt System
 *
 * Centralized feature flag functions for prompt-related features.
 * All flags default to OFF for safety.
 *
 * @module prompt/feature-flags
 */

/**
 * Check if PROMPT_MEMORY_P0 feature is enabled.
 * This is the base flag for P0 prompt features.
 */
export function isPromptMemoryP0Enabled(): boolean {
  return process.env.PROMPT_MEMORY_P0_ENABLED === 'true';
}

/**
 * Check if prompt template projection is enabled.
 * This feature is gated by PROMPT_MEMORY_P0_ENABLED - it only returns true
 * when P0 is also enabled.
 */
export function isPromptTemplateProjectionEnabled(): boolean {
  return isPromptMemoryP0Enabled() && process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED === 'true';
}

/**
 * Check if TOOL_LOOP_V2 feature is enabled.
 * This is the feature flag for the new tool loop implementation.
 */
export function isToolLoopV2Enabled(): boolean {
  return process.env.TOOL_LOOP_V2_ENABLED === 'true';
}
