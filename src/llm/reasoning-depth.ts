/**
 * Model reasoning depth (effort) and provider-specific request body mapping.
 *
 * UI values: off | low | medium | high
 * Each provider family uses a different wire format.
 */

export const REASONING_DEPTH_VALUES = ['off', 'low', 'medium', 'high'] as const

export type ReasoningDepth = (typeof REASONING_DEPTH_VALUES)[number]

export const DEFAULT_REASONING_DEPTH: ReasoningDepth = 'off'

const REASONING_DEPTH_SET = new Set<string>(REASONING_DEPTH_VALUES)

export function isReasoningDepth(value: unknown): value is ReasoningDepth {
  return typeof value === 'string' && REASONING_DEPTH_SET.has(value)
}

export function parseReasoningDepth(
  value: unknown,
  fallback: ReasoningDepth = DEFAULT_REASONING_DEPTH,
): ReasoningDepth {
  return isReasoningDepth(value) ? value : fallback
}

/** OpenAI-compatible reasoning_effort; omit when off. */
export function toReasoningEffort(
  depth: ReasoningDepth | undefined,
): 'low' | 'medium' | 'high' | undefined {
  if (!depth || depth === 'off') return undefined
  return depth
}

export const REASONING_DEPTH_LABELS: Record<ReasoningDepth, string> = {
  off: '关闭',
  low: '低',
  medium: '中',
  high: '高',
}

/** DashScope / Qwen thinking_budget token caps by depth. */
const DASHSCOPE_THINKING_BUDGET: Record<Exclude<ReasoningDepth, 'off'>, number> = {
  low: 1024,
  medium: 4096,
  high: 8192,
}

/**
 * Reasoning control wire format families used by adapters in this codebase.
 * All domestic providers go through OpenAI-compatible chat/completions.
 */
export type ReasoningWireFormat =
  | 'openai_effort' // reasoning_effort: low|medium|high
  | 'openrouter_reasoning' // reasoning: { effort }
  | 'deepseek_thinking' // thinking.type + reasoning_effort high|max
  | 'dashscope_thinking' // enable_thinking + thinking_budget
  | 'moonshot_thinking' // thinking: { type }
  | 'zhipu_thinking' // thinking: { type } + optional reasoning_effort
  | 'volcengine_thinking' // thinking: { type: enabled|disabled|auto }
  | 'none' // strip / do not send reasoning params

export function resolveReasoningWireFormat(providerType: string | undefined): ReasoningWireFormat {
  switch (providerType) {
    case 'openai':
    case 'custom':
      return 'openai_effort'
    case 'openrouter':
      return 'openrouter_reasoning'
    case 'deepseek':
      return 'deepseek_thinking'
    case 'dashscope':
    case 'siliconflow': // often Qwen-family models on SiliconFlow
      return 'dashscope_thinking'
    case 'moonshot':
      return 'moonshot_thinking'
    case 'zhipu':
      return 'zhipu_thinking'
    case 'volcengine':
      return 'volcengine_thinking'
    case 'ollama':
    case 'mock':
    case 'qianfan':
    case 'minimax':
    case 'jdcloud-yanxi':
    case 'mimo':
    case 'iflytek-spark':
    case 'stepfun':
    case 'hunyuan':
    default:
      return 'none'
  }
}

function stripReasoningFields(body: Record<string, unknown>): void {
  delete body.reasoning_effort
  delete body.reasoning
  delete body.thinking
  delete body.enable_thinking
  delete body.thinking_budget
  delete body.thinking_type
}

/**
 * Apply session reasoning depth onto an OpenAI-compatible chat request body
 * using the provider's real API field names.
 *
 * Call AFTER the base body is built (and after domestic quirks that only
 * rename max_tokens / tool_choice).
 */
export function applyReasoningDepthToBody(
  providerType: string | undefined,
  body: Record<string, unknown>,
  depth: ReasoningDepth | undefined,
): Record<string, unknown> {
  const next = { ...body }
  // Always clear any generic mapping first so provider formats don't stack.
  stripReasoningFields(next)

  if (!depth) {
    return next
  }

  const format = resolveReasoningWireFormat(providerType)

  switch (format) {
    case 'openai_effort': {
      if (depth !== 'off') {
        next.reasoning_effort = depth
      }
      return next
    }
    case 'openrouter_reasoning': {
      // OpenRouter unified reasoning control (preferred over bare reasoning_effort).
      const effort = depth === 'off' ? 'none' : depth
      next.reasoning = { effort, enabled: depth !== 'off' }
      return next
    }
    case 'deepseek_thinking': {
      // Docs: thinking: { type: enabled|disabled }, reasoning_effort: high|max
      // low/medium are accepted by API but mapped to high; we send high/max explicitly.
      if (depth === 'off') {
        next.thinking = { type: 'disabled' }
      } else {
        next.thinking = { type: 'enabled' }
        next.reasoning_effort = depth === 'high' ? 'max' : 'high'
      }
      return next
    }
    case 'dashscope_thinking': {
      // Qwen OpenAI-compatible: enable_thinking + thinking_budget
      if (depth === 'off') {
        next.enable_thinking = false
      } else {
        next.enable_thinking = true
        next.thinking_budget = DASHSCOPE_THINKING_BUDGET[depth]
      }
      return next
    }
    case 'moonshot_thinking': {
      // Kimi K2.x: thinking: { type: enabled|disabled }
      next.thinking = { type: depth === 'off' ? 'disabled' : 'enabled' }
      return next
    }
    case 'zhipu_thinking': {
      // GLM: thinking.type and/or enable_thinking; effort high|max|none on newer models
      if (depth === 'off') {
        next.thinking = { type: 'disabled' }
        next.enable_thinking = false
      } else {
        next.thinking = { type: 'enabled' }
        next.enable_thinking = true
        next.reasoning_effort = depth === 'high' ? 'max' : 'high'
      }
      return next
    }
    case 'volcengine_thinking': {
      // Doubao Ark: thinking.type enabled|disabled|auto
      next.thinking = {
        type: depth === 'off' ? 'disabled' : depth === 'low' ? 'auto' : 'enabled',
      }
      return next
    }
    case 'none':
    default:
      return next
  }
}
