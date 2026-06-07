/**
 * Ollama Chat API transformer functions
 * Transforms LLMRequest to Ollama API format and maps responses back
 */

import type { LLMRequest, LLMResponse } from '../types'

/**
 * Builds the request body for Ollama Chat API
 *
 * @param request - LLMRequest to transform
 * @returns Ollama API request body
 */
export function buildOllamaChatRequestBody(request: LLMRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    stream: false,
  }

  if (request.temperature !== undefined) {
    body.options = { temperature: request.temperature }
  }

  return body
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
