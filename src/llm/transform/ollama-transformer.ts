/**
 * Ollama Chat API transformer functions
 * Transforms LLMRequest to Ollama API format and maps responses back
 */

import type { LLMRequest, LLMResponse, ProviderStreamEvent } from '../types.js'
import { mapFinishReason } from '../types.js'

/**
 * Builds the request body for Ollama Chat API
 *
 * @param request - LLMRequest to transform
 * @returns Ollama API request body
 */
export function buildOllamaChatRequestBody(request: LLMRequest, stream = false): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream,
  }

  if (request.temperature !== undefined) {
    body.options = { temperature: request.temperature }
  }

  return body
}

export interface OllamaStreamChunk {
  readonly message?: { readonly content?: string }
  readonly done: boolean
}

export function parseOllamaStreamLine(line: string): ProviderStreamEvent | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    const parsed = JSON.parse(trimmed) as OllamaStreamChunk
    const content = parsed.message?.content
    if (typeof content === 'string' && content.length > 0) {
      return { kind: 'text', delta: content }
    }
    if (parsed.done) {
      return { kind: 'finish', finishReason: mapFinishReason('stop') }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Maps Ollama Chat API response to LLMResponse
 *
 * @param data - Raw API response data
 * @returns Structured LLMResponse
 */
export function mapOllamaChatResponse(data: Record<string, unknown>): LLMResponse {
  const message = data.message as Record<string, unknown> | undefined

  return {
    id: `resp_${Date.now()}`,
    model: (data.model as string) || 'unknown',
    content: (message?.content as string) || '',
    role: 'assistant',
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  }
}
