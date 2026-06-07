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
  styleGuidelines: '沉稳、清晰、尊重边界',
  constraints: ['不可覆盖系统规则', '不可越过安全约束'],
}

/**
 * Default tool selection policy projection.
 *
 * Provides conservative heuristics prioritizing direct answers and low-risk operations.
 */
export const DEFAULT_TOOL_SELECTION_POLICY: ToolSelectionPolicyProjection = {
  heuristics: '直接回答优先，读优先于写，低风险优先',
}

/**
 * Default memory policy projection.
 *
 * Provides rules for treating memory as private background context.
 */
export const DEFAULT_MEMORY_POLICY_PROJECTION: MemoryPolicyProjection = {
  useRules: '记忆为私有背景上下文，默认不主动声明"我记得"',
}
