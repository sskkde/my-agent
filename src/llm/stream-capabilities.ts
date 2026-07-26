/**
 * Provider family capability for structured streaming (text + tool_calls).
 * Used by AgentKernel to decide whether tool-capable turns may use stream().
 */

const STRUCTURED_TOOL_STREAM_FAMILIES = new Set([
  'openai',
  'openai_compatible',
  'deepseek',
  'dashscope',
  'volcengine',
  'qianfan',
  'zhipu',
  'moonshot',
  'minimax',
  'mimo',
  'iflytek-spark',
  'stepfun',
  'hunyuan',
  'siliconflow',
  'ollama',
])

/**
 * Whether this provider family is trusted to emit OpenAI-compatible
 * streaming tool_calls deltas. Anthropic/Gemini/Bedrock use different
 * or incomplete stream tool protocols in this codebase — fall back to complete().
 * Ollama is included because it now serves the OpenAI-compatible
 * /v1/chat/completions streaming path.
 */
export function supportsStructuredToolStreaming(providerFamily: string | undefined): boolean {
  if (!providerFamily) {
    // Default conservative: allow (OpenAI-compatible is the primary path)
    return true
  }
  return STRUCTURED_TOOL_STREAM_FAMILIES.has(providerFamily)
}
