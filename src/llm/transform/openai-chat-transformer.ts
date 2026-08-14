/**
 * OpenAI Chat API transformer functions
 * Transforms LLMRequest to OpenAI API format and maps responses back
 */

import type { LLMRequest, LLMResponse, ToolCall, ProviderStreamEvent } from '../types.js'
import { mapFinishReason } from '../types.js'

/**
 * List of protected HTTP headers that cannot be overridden by user configuration.
 * Comparison is case-insensitive.
 */
const PROTECTED_HEADERS = new Set(['authorization', 'content-type', 'host', 'content-length', 'cookie', 'set-cookie'])

/**
 * Safely merges custom headers with base headers, preventing override of protected headers.
 * Protected headers: authorization, content-type, host, content-length, cookie, set-cookie
 *
 * @param baseHeaders - The base headers (typically system-provided, e.g., Authorization, Content-Type)
 * @param customHeaders - Custom headers to merge (from user configuration)
 * @returns Merged headers with protected headers preserved from base
 *
 * @example
 * ```typescript
 * const merged = safeMergeHeaders(
 *   { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
 *   { 'X-Custom': 'value', 'authorization': 'hacked' }
 * );
 * // Returns: { 'Content-Type': 'application/json', Authorization: 'Bearer token', 'X-Custom': 'value' }
 * ```
 */
export function safeMergeHeaders(
  baseHeaders: Record<string, string>,
  customHeaders?: Record<string, string>,
): Record<string, string> {
  if (!customHeaders || Object.keys(customHeaders).length === 0) {
    return { ...baseHeaders }
  }

  const result: Record<string, string> = { ...baseHeaders }

  for (const [key, value] of Object.entries(customHeaders)) {
    const lowerKey = key.toLowerCase()
    // Skip protected headers - they cannot be overridden
    if (PROTECTED_HEADERS.has(lowerKey)) {
      continue
    }
    // Preserve original casing for non-protected headers
    result[key] = value
  }

  return result
}

/**
 * Builds headers for OpenAI-compatible API requests
 *
 * @param input - Configuration object containing API key, base URL, and optional metadata
 * @returns Record of HTTP headers for the request
 */
export function buildOpenAICompatibleHeaders(input: {
  apiKey: string
  baseUrl: string
  providerId?: string
  siteUrl?: string
  appName?: string
  extraHeaders?: Record<string, string>
}): Record<string, string> {
  const baseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${input.apiKey}`,
  }

  if (input.siteUrl) baseHeaders['HTTP-Referer'] = input.siteUrl
  if (input.appName) baseHeaders['X-Title'] = input.appName

  return safeMergeHeaders(baseHeaders, input.extraHeaders)
}

/**
 * Builds the request body for OpenAI Chat API
 *
 * @param request - LLMRequest to transform
 * @returns OpenAI API request body
 */
export function buildOpenAIChatRequestBody(request: LLMRequest, stream = false): Record<string, unknown> {
  // `reasoning_content` is a DeepSeek-dialect field. Only the deepseek path sets
  // `reasoningContentPassback`, so every other provider's request stays unchanged.
  const reasoningContentPassback = request.reasoningContentPassback === true

  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name && { name: m.name }),
      ...(m.toolCallId && { tool_call_id: m.toolCallId }),
      ...(m.toolCalls &&
        m.toolCalls.length > 0 && {
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        }),
      // SAFETY: reasoning is emitted as a separate sibling field — never merged
      // into content. Only assistant tool-call turns carry it (DeepSeek thinking
      // mode requires the passback); plain turns omit it to save tokens.
      ...(reasoningContentPassback &&
        m.role === 'assistant' &&
        m.toolCalls &&
        m.toolCalls.length > 0 &&
        m.reasoningContent && {
          reasoning_content: m.reasoningContent,
        }),
    })),
  }

  if (stream) body.stream = true
  if (request.temperature !== undefined) body.temperature = request.temperature
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
  if (request.topP !== undefined) body.top_p = request.topP
  if (request.frequencyPenalty !== undefined) body.frequency_penalty = request.frequencyPenalty
  if (request.presencePenalty !== undefined) body.presence_penalty = request.presencePenalty
  if (request.stopSequences !== undefined) body.stop = request.stopSequences
  if (request.tools !== undefined) {
    body.tools = request.tools.map((t) => ({
      type: t.type,
      function: t.function,
    }))
  }
  if (request.toolChoice !== undefined) {
    if (typeof request.toolChoice === 'string') {
      body.tool_choice = request.toolChoice
    } else {
      body.tool_choice = {
        type: 'function',
        function: { name: request.toolChoice.function.name },
      }
    }
  }
  if (request.responseFormat !== undefined) {
    body.response_format = { type: request.responseFormat.type }
  }
  // reasoningDepth is applied by provider-aware applyReasoningDepthToBody()
  // after this base body is built (formats differ per provider).

  return body
}

export interface OpenAIStreamToolCallDelta {
  readonly index?: number
  readonly id?: string
  readonly type?: string
  readonly function?: {
    readonly name?: string
    readonly arguments?: string
  }
}

export interface OpenAIStreamChunk {
  readonly choices: ReadonlyArray<{
    readonly delta?: {
      readonly content?: string | null
      readonly reasoning_content?: string | null
      readonly tool_calls?: ReadonlyArray<OpenAIStreamToolCallDelta>
      readonly role?: string
    }
    readonly finish_reason?: string | null
  }>
}

/**
 * Parse one OpenAI-compatible SSE data line into a structured stream event.
 * Returns null for heartbeats, [DONE], empty role-only chunks, or malformed JSON.
 */
export function parseOpenAIStreamLine(line: string): ProviderStreamEvent | null {
  if (!line.startsWith('data: ')) return null
  const data = line.slice(6).trim()
  if (data === '[DONE]') return null
  try {
    const parsed = JSON.parse(data) as OpenAIStreamChunk
    const choice = parsed.choices?.[0]
    if (!choice) return null

    if (choice.finish_reason) {
      return { kind: 'finish', finishReason: mapFinishReason(choice.finish_reason) }
    }

    const delta = choice.delta
    if (!delta) return null

    const toolCalls = delta.tool_calls
    if (toolCalls && toolCalls.length > 0) {
      // Emit one event per tool_call fragment; callers may receive multiple per line.
      // Prefer the first fragment for single-event return; multi-fragment lines use parseOpenAIStreamEvents.
      const tc = toolCalls[0]
      if (!tc) return null
      return {
        kind: 'tool_call_delta',
        index: typeof tc.index === 'number' ? tc.index : 0,
        id: typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : undefined,
        name: typeof tc.function?.name === 'string' && tc.function.name.length > 0 ? tc.function.name : undefined,
        argumentsDelta:
          typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 0
            ? tc.function.arguments
            : undefined,
      }
    }

    // Reasoning is checked before content so reasoning is never lost when both arrive together.
    // SAFETY: reasoning goes ONLY into kind:'reasoning' — never into content/text.
    const reasoningContent = delta.reasoning_content
    if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
      return { kind: 'reasoning', delta: reasoningContent }
    }

    const content = delta.content
    if (typeof content === 'string' && content.length > 0) {
      return { kind: 'text', delta: content }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Parse one SSE line into zero or more stream events.
 * Handles multi tool_call fragments in a single chunk (parallel tool calls).
 */
export function parseOpenAIStreamEvents(line: string): ProviderStreamEvent[] {
  if (!line.startsWith('data: ')) return []
  const data = line.slice(6).trim()
  if (data === '[DONE]') return []
  try {
    const parsed = JSON.parse(data) as OpenAIStreamChunk
    const choice = parsed.choices?.[0]
    if (!choice) return []

    const events: ProviderStreamEvent[] = []
    const delta = choice.delta
    if (delta) {
      // Reasoning emitted before content so reasoning is never lost when both arrive together.
      // SAFETY: reasoning goes ONLY into kind:'reasoning' — never into content/text.
      const reasoningContent = delta.reasoning_content
      if (typeof reasoningContent === 'string' && reasoningContent.length > 0) {
        events.push({ kind: 'reasoning', delta: reasoningContent })
      }
      const content = delta.content
      if (typeof content === 'string' && content.length > 0) {
        events.push({ kind: 'text', delta: content })
      }
      const toolCalls = delta.tool_calls
      if (toolCalls) {
        for (const tc of toolCalls) {
          events.push({
            kind: 'tool_call_delta',
            index: typeof tc.index === 'number' ? tc.index : 0,
            id: typeof tc.id === 'string' && tc.id.length > 0 ? tc.id : undefined,
            name: typeof tc.function?.name === 'string' && tc.function.name.length > 0 ? tc.function.name : undefined,
            argumentsDelta:
              typeof tc.function?.arguments === 'string' && tc.function.arguments.length > 0
                ? tc.function.arguments
                : undefined,
          })
        }
      }
    }
    if (choice.finish_reason) {
      events.push({ kind: 'finish', finishReason: mapFinishReason(choice.finish_reason) })
    }
    return events
  } catch {
    return []
  }
}

/**
 * Maps OpenAI Chat API response to LLMResponse
 * Handles both OpenAI nested cache format and DeepSeek flat cache format
 *
 * @param data - Raw API response data
 * @returns Structured LLMResponse
 */
export function mapOpenAIChatResponse(data: Record<string, unknown>): LLMResponse {
  const choices = data.choices as Array<Record<string, unknown>> | undefined
  const firstChoice = choices?.[0]
  const message = firstChoice?.message as Record<string, unknown> | undefined
  const toolCalls = message?.tool_calls as Array<Record<string, unknown>> | undefined

  const mappedToolCalls: ToolCall[] | undefined = toolCalls?.map((tc) => ({
    id: tc.id as string,
    type: 'function',
    function: {
      name: (tc.function as Record<string, string>)?.name || '',
      arguments: (tc.function as Record<string, string>)?.arguments || '{}',
    },
  }))

  const usage = data.usage as Record<string, unknown> | undefined
  const promptTokensDetails = usage?.prompt_tokens_details as Record<string, number> | undefined
  const cachedTokens = promptTokensDetails?.cached_tokens

  let cacheMetrics: {
    promptCacheHitTokens?: number
    promptCacheMissTokens?: number
    cacheHitRate?: number
  } = {}

  if (usage && typeof cachedTokens === 'number' && cachedTokens > 0) {
    const promptTokens = (usage.prompt_tokens as number) || 0
    const promptCacheHitTokens = cachedTokens
    const promptCacheMissTokens = Math.max(0, promptTokens - cachedTokens)
    const totalPromptTokens = promptCacheHitTokens + promptCacheMissTokens
    const cacheHitRate = totalPromptTokens > 0 ? promptCacheHitTokens / totalPromptTokens : 0

    cacheMetrics = {
      promptCacheHitTokens,
      promptCacheMissTokens,
      cacheHitRate,
    }
  }

  // DeepSeek flat cache fields take priority over OpenAI nested format
  if (usage) {
    const dsHit = usage.prompt_cache_hit_tokens
    const dsMiss = usage.prompt_cache_miss_tokens
    if (typeof dsHit === 'number' || typeof dsMiss === 'number') {
      const promptCacheHitTokens = typeof dsHit === 'number' ? dsHit : 0
      const promptCacheMissTokens = typeof dsMiss === 'number' ? dsMiss : 0
      const totalPromptTokens = promptCacheHitTokens + promptCacheMissTokens
      cacheMetrics = {
        promptCacheHitTokens,
        promptCacheMissTokens,
        cacheHitRate: totalPromptTokens > 0 ? promptCacheHitTokens / totalPromptTokens : undefined,
      }
    }
  }

  return {
    id: (data.id as string) || `resp_${Date.now()}`,
    model: (data.model as string) || 'unknown',
    content: (message?.content as string) || '',
    // SAFETY: reasoning_content is captured separately — never merged into content.
    reasoningContent:
      typeof message?.reasoning_content === 'string' && message.reasoning_content.length > 0
        ? (message.reasoning_content as string)
        : undefined,
    role: 'assistant',
    toolCalls: mappedToolCalls,
    usage: usage
      ? {
          promptTokens: (usage.prompt_tokens as number) || 0,
          completionTokens: (usage.completion_tokens as number) || 0,
          totalTokens: (usage.total_tokens as number) || 0,
          ...cacheMetrics,
        }
      : undefined,
    finishReason: (firstChoice?.finish_reason as LLMResponse['finishReason']) || 'stop',
    createdAt: new Date().toISOString(),
  }
}
