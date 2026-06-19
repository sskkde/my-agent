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
  return process.env.PROMPT_MEMORY_P0_ENABLED === 'true'
}

/**
 * Check if prompt template projection is enabled.
 * This feature is gated by PROMPT_MEMORY_P0_ENABLED - it only returns true
 * when P0 is also enabled.
 */
export function isPromptTemplateProjectionEnabled(): boolean {
  return isPromptMemoryP0Enabled() && process.env.PROMPT_TEMPLATE_PROJECTION_ENABLED === 'true'
}

/**
 * Check if TOOL_LOOP_V2 feature is enabled.
 * This is the feature flag for the new tool loop implementation.
 */
export function isToolLoopV2Enabled(): boolean {
  return process.env.TOOL_LOOP_V2_ENABLED === 'true'
}

// ---------------------------------------------------------------------------
// Prompt Migration Feature Flags (T5–T7 templates, Segment D provenance)
// All flags default to OFF for safety during incremental rollout.
// ---------------------------------------------------------------------------

/**
 * Check if T5 agentProfile template consumption is enabled.
 * Controls T5 template rendering in Segment B.
 */
export function isPromptT5TemplateConsumptionEnabled(): boolean {
  return process.env.PROMPT_T5_TEMPLATE_CONSUMPTION_ENABLED === 'true'
}

/**
 * Check if T6 toolProjection template consumption is enabled.
 * Controls T6 template rendering in Segment C.
 */
export function isPromptT6TemplateConsumptionEnabled(): boolean {
  return process.env.PROMPT_T6_TEMPLATE_CONSUMPTION_ENABLED === 'true'
}

/**
 * Check if T7 runtimeContext template consumption is enabled.
 * Controls T7 template rendering in Segment D.
 */
export function isPromptT7TemplateConsumptionEnabled(): boolean {
  return process.env.PROMPT_T7_TEMPLATE_CONSUMPTION_ENABLED === 'true'
}

/**
 * Check if Segment B explicit sub-sections (B1/B2/B3) rendering is enabled.
 */
export function isPromptSegmentBSubsectionsEnabled(): boolean {
  return process.env.PROMPT_SEGMENT_B_SUBSECTIONS_ENABLED === 'true'
}

/**
 * Check if Segment D provenance header rendering is enabled.
 */
export function isPromptSegmentDProvenanceEnabled(): boolean {
  return process.env.PROMPT_SEGMENT_D_PROVENANCE_ENABLED === 'true'
}

/**
 * Check if summaryLayers as a top-level field is enabled.
 */
export function isPromptSummaryLayersTopLevelEnabled(): boolean {
  return process.env.PROMPT_SUMMARY_LAYERS_TOP_LEVEL_ENABLED === 'true'
}

/**
 * Check if rich persona field rendering in B3 is enabled.
 */
export function isPromptRichPersonaEnabled(): boolean {
  return process.env.PROMPT_RICH_PERSONA_ENABLED === 'true'
}
