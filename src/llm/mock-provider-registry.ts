import type { LLMRequest, LLMResponse, LLMResult, ToolCall } from './types.js'

export interface MockToolCallConfig {
  name: string
  arguments: string
}

export interface MockResponseConfig {
  content: string
  toolCalls?: MockToolCallConfig[]
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter'
  delayMs?: number
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface MockInteraction {
  id: string
  timestamp: string
  request: {
    model: string
    messages: LLMRequest['messages']
    temperature?: number
    tools?: LLMRequest['tools']
    toolChoice?: LLMRequest['toolChoice']
    maxTokens?: number
  }
  response: {
    content: string
    toolCalls?: ToolCall[]
    finishReason: string
    usage?: MockResponseConfig['usage']
  }
  durationMs: number
}

type ResponseMode = 'queue' | 'echo' | 'default'

class MockProviderRegistry {
  private interactions: MockInteraction[] = []
  private responseQueue: MockResponseConfig[] = []
  private mode: ResponseMode = 'default'
  private defaultResponse: MockResponseConfig = {
    content: '[Mock Provider] No response configured. Use POST /api/v1/mock-provider/responses to set responses.',
    finishReason: 'stop',
  }
  private interactionCounter = 0

  setResponseMode(mode: ResponseMode): void {
    this.mode = mode
  }

  getResponseMode(): ResponseMode {
    return this.mode
  }

  setResponseQueue(responses: MockResponseConfig[]): void {
    this.responseQueue = [...responses]
    this.mode = 'queue'
  }

  getResponseQueue(): MockResponseConfig[] {
    return [...this.responseQueue]
  }

  setDefaultResponse(response: MockResponseConfig): void {
    this.defaultResponse = response
  }

  getDefaultResponse(): MockResponseConfig {
    return { ...this.defaultResponse }
  }

  getNextResponse(request: LLMRequest): MockResponseConfig {
    if (this.mode === 'echo') {
      const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user')
      return {
        content: lastUserMessage?.content ?? '[Mock Echo] No user message found.',
        finishReason: 'stop',
      }
    }

    if (this.mode === 'queue' && this.responseQueue.length > 0) {
      return this.responseQueue.shift()!
    }

    return this.defaultResponse
  }

  recordInteraction(
    request: LLMRequest,
    response: MockResponseConfig,
    durationMs: number,
  ): MockInteraction {
    const interaction: MockInteraction = {
      id: `mock-int-${++this.interactionCounter}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      request: {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        tools: request.tools,
        toolChoice: request.toolChoice,
        maxTokens: request.maxTokens,
      },
      response: {
        content: response.content,
        toolCalls: response.toolCalls?.map((tc) => ({
          id: `call_${this.interactionCounter}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
        finishReason: response.finishReason ?? 'stop',
        usage: response.usage,
      },
      durationMs,
    }
    this.interactions.push(interaction)
    return interaction
  }

  getInteractions(limit?: number): MockInteraction[] {
    if (limit !== undefined) {
      return this.interactions.slice(-limit)
    }
    return [...this.interactions]
  }

  getInteraction(id: string): MockInteraction | null {
    return this.interactions.find((i) => i.id === id) ?? null
  }

  clearInteractions(): void {
    this.interactions = []
    this.interactionCounter = 0
  }

  reset(): void {
    this.interactions = []
    this.responseQueue = []
    this.mode = 'default'
    this.interactionCounter = 0
    this.defaultResponse = {
      content: '[Mock Provider] No response configured. Use POST /api/v1/mock-provider/responses to set responses.',
      finishReason: 'stop',
    }
  }

  getStats(): {
    totalInteractions: number
    responseMode: ResponseMode
    queueLength: number
  } {
    return {
      totalInteractions: this.interactions.length,
      responseMode: this.mode,
      queueLength: this.responseQueue.length,
    }
  }
}

let registryInstance: MockProviderRegistry | undefined

export function getMockProviderRegistry(): MockProviderRegistry {
  if (!registryInstance) {
    registryInstance = new MockProviderRegistry()
  }
  return registryInstance
}

export function buildMockLLMResponse(
  config: MockResponseConfig,
  requestModel: string,
): LLMResponse {
  return {
    id: `mock-resp-${Date.now()}`,
    model: requestModel,
    content: config.content,
    role: 'assistant',
    toolCalls: config.toolCalls?.map((tc, idx) => ({
      id: `call_${Date.now()}_${idx}`,
      type: 'function' as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
    usage: config.usage ?? {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    },
    finishReason: config.finishReason ?? (config.toolCalls?.length ? 'tool_calls' : 'stop'),
    createdAt: new Date().toISOString(),
  }
}

export function buildMockLLMResult(
  config: MockResponseConfig,
  requestModel: string,
  providerId: string,
): LLMResult {
  return {
    success: true,
    response: buildMockLLMResponse(config, requestModel),
    providerId,
  }
}

export type { ResponseMode }
