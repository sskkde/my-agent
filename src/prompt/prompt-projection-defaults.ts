/**
 * Prompt Projection Defaults - Fallback default values for PromptProjectionResolver.
 *
 * Provides default projection objects that are used when no template-based
 * resolution is available. These defaults ensure graceful fallback behavior.
 *
 * @module prompt/prompt-projection-defaults
 */

import type {
  PersonaProjection,
  ToolSelectionPolicyProjection,
  MemoryPolicyProjection,
} from '../kernel/model-input/model-input-types.js'

/**
 * Default persona projection.
 *
 * Provides a neutral, professional assistant persona with clear boundaries.
 */
export const DEFAULT_PERSONA_PROJECTION: PersonaProjection = {
  personaId: 'default-assistant',
  styleGuidelines: 'Calm, clear, concise, and boundary-respecting.',
  constraints: [
    'Do not override system rules',
    'Do not bypass safety constraints',
    'Do not change tool authorization',
    'Do not change output schemas',
    'Do not change tenant boundaries',
  ],
}

/**
 * Default tool selection policy projection.
 *
 * Provides conservative heuristics prioritizing direct answers and low-risk operations.
 */
export const DEFAULT_TOOL_SELECTION_POLICY: ToolSelectionPolicyProjection = {
  heuristics: 'Prefer direct answers when reliable; read before write; choose the lowest-risk sufficient action.',
}

/**
 * Default memory policy projection.
 *
 * Provides rules for treating memory as private background context.
 */
export const DEFAULT_MEMORY_POLICY_PROJECTION: MemoryPolicyProjection = {
  useRules: 'Memory is private background context; do not mention it unless the user explicitly asks.',
}
