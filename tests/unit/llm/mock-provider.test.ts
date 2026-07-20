import { describe, it, expect, beforeEach } from 'vitest'
import { MockProvider } from '../../../src/llm/mock-provider-adapter.js'
import {
  getMockProviderRegistry,
  type MockResponseConfig,
  type MockInteraction,
} from '../../../src/llm/mock-provider-registry.js'
import type { LLMRequest, ProviderConfig, ToolDefinition } from '../../../src/llm/types.js'

function buildProviderConfig(id: string): ProviderConfig {
  return {
    id,
    name: `mock-${id}`,
    enabled: true,
    priority: 0,
    timeoutMs: 60000,
    retries: 0,
    capabilities: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsVision: false,
      maxTokens: 4096,
      supportedModels: ['mock-model'],
    },
  }
}

function buildRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    model: 'mock-model',
    messages: [{ role: 'user', content: 'Hello, mock provider!' }],
    ...overrides,
  }
}

const mockConfig: MockResponseConfig = {
  content: 'Mocked response content',
  finishReason: 'stop',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
}

describe('MockProvider', () => {
  let provider: MockProvider

  beforeEach(() => {
    getMockProviderRegistry().reset()
    provider = new MockProvider(buildProviderConfig('mock-provider-1'))
  })

  describe('complete()', () => {
    it('returns the configured response and records an interaction', async () => {
      getMockProviderRegistry().setResponseQueue([mockConfig])

      const result = await provider.complete(buildRequest())

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.response.content).toBe('Mocked response content')
        expect(result.response.finishReason).toBe('stop')
        expect(result.response.usage?.totalTokens).toBe(15)
        expect(result.providerId).toBe('mock-provider-1')
      }

      const interactions = getMockProviderRegistry().getInteractions()
      expect(interactions).toHaveLength(1)
      expect(interactions[0].response.content).toBe('Mocked response content')
      expect(interactions[0].request.model).toBe('mock-model')
    })

    it('falls back to default response when queue is empty', async () => {
      const result = await provider.complete(buildRequest())

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.response.content).toContain('[Mock Provider]')
        expect(result.response.finishReason).toBe('stop')
      }
    })

    it('records tool calls in the interaction when configured', async () => {
      const toolCallConfig: MockResponseConfig = {
        content: '',
        toolCalls: [{ name: 'get_weather', arguments: '{"city":"Beijing"}' }],
        finishReason: 'tool_calls',
      }
      getMockProviderRegistry().setResponseQueue([toolCallConfig])

      const result = await provider.complete(buildRequest())

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.response.toolCalls).toHaveLength(1)
        expect(result.response.toolCalls![0].function.name).toBe('get_weather')
        expect(result.response.finishReason).toBe('tool_calls')
      }

      const interactions = getMockProviderRegistry().getInteractions()
      expect(interactions[0].response.toolCalls).toHaveLength(1)
      expect(interactions[0].response.finishReason).toBe('tool_calls')
    })
  })

  describe('stream()', () => {
    it('yields content tokens that reassemble to the response content', async () => {
      getMockProviderRegistry().setResponseQueue([mockConfig])

      const tokens: string[] = []
      for await (const event of provider.stream(buildRequest())) {
        if (event.kind === 'text') tokens.push(event.delta)
      }

      expect(tokens.join('')).toBe('Mocked response content')
    })

    it('records an interaction after streaming completes', async () => {
      getMockProviderRegistry().setResponseQueue([mockConfig])

      for await (const _ of provider.stream(buildRequest())) {
        // consume
      }

      const interactions = getMockProviderRegistry().getInteractions()
      expect(interactions).toHaveLength(1)
      expect(interactions[0].response.content).toBe('Mocked response content')
    })
  })
})

describe('MockProviderRegistry response queue', () => {
  beforeEach(() => {
    getMockProviderRegistry().reset()
  })

  it('returns queued responses in FIFO order', async () => {
    const first: MockResponseConfig = { content: 'first', finishReason: 'stop' }
    const second: MockResponseConfig = { content: 'second', finishReason: 'stop' }
    getMockProviderRegistry().setResponseQueue([first, second])

    const provider = new MockProvider(buildProviderConfig('mock-fifo'))

    const r1 = await provider.complete(buildRequest())
    const r2 = await provider.complete(buildRequest())

    expect(r1.success && r1.response.content).toBe('first')
    expect(r2.success && r2.response.content).toBe('second')
  })

  it('falls back to default response after the queue is exhausted', async () => {
    getMockProviderRegistry().setResponseQueue([
      { content: 'queued', finishReason: 'stop' },
    ])

    const provider = new MockProvider(buildProviderConfig('mock-exhaust'))

    const r1 = await provider.complete(buildRequest())
    const r2 = await provider.complete(buildRequest())

    expect(r1.success && r1.response.content).toBe('queued')
    expect(r2.success && r2.response.content).toContain('[Mock Provider]')
  })
})

describe('MockProviderRegistry echo mode', () => {
  beforeEach(() => {
    getMockProviderRegistry().reset()
  })

  it('returns the last user message as the response content', async () => {
    getMockProviderRegistry().setResponseMode('echo')

    const provider = new MockProvider(buildProviderConfig('mock-echo'))

    const result = await provider.complete(
      buildRequest({
        messages: [
          { role: 'system', content: 'You are a mock.' },
          { role: 'user', content: 'echo this back' },
        ],
      }),
    )

    expect(result.success && result.response.content).toBe('echo this back')
  })

  it('returns a fallback message when no user message is present', async () => {
    getMockProviderRegistry().setResponseMode('echo')

    const provider = new MockProvider(buildProviderConfig('mock-echo-none'))

    const result = await provider.complete(
      buildRequest({
        messages: [{ role: 'system', content: 'no user message here' }],
      }),
    )

    expect(result.success && result.response.content).toContain('[Mock Echo]')
  })
})

describe('MockProviderRegistry interaction recording', () => {
  beforeEach(() => {
    getMockProviderRegistry().reset()
  })

  it('records request messages, tools, and toolChoice', async () => {
    const tools: ToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]
    const toolChoice = { type: 'function', function: { name: 'get_weather' } } as const

    getMockProviderRegistry().setResponseQueue([mockConfig])

    const provider = new MockProvider(buildProviderConfig('mock-record'))

    await provider.complete(
      buildRequest({
        temperature: 0.7,
        maxTokens: 512,
        tools,
        toolChoice,
      }),
    )

    const interactions: MockInteraction[] = getMockProviderRegistry().getInteractions()
    expect(interactions).toHaveLength(1)
    const recorded = interactions[0].request
    expect(recorded.temperature).toBe(0.7)
    expect(recorded.maxTokens).toBe(512)
    expect(recorded.tools).toEqual(tools)
    expect(recorded.toolChoice).toEqual(toolChoice)
    expect(recorded.messages).toHaveLength(1)
  })

  it('getInteractions respects the limit parameter', async () => {
    const provider = new MockProvider(buildProviderConfig('mock-limit'))

    for (let i = 0; i < 5; i++) {
      await provider.complete(buildRequest())
    }

    expect(getMockProviderRegistry().getInteractions()).toHaveLength(5)
    expect(getMockProviderRegistry().getInteractions(2)).toHaveLength(2)
  })

  it('retrieves a single interaction by id', async () => {
    const provider = new MockProvider(buildProviderConfig('mock-by-id'))

    await provider.complete(buildRequest())

    const interactions = getMockProviderRegistry().getInteractions()
    const id = interactions[0].id
    expect(getMockProviderRegistry().getInteraction(id)?.id).toBe(id)
    expect(getMockProviderRegistry().getInteraction('nonexistent')).toBeNull()
  })
})

describe('MockProviderRegistry clear/reset', () => {
  beforeEach(() => {
    getMockProviderRegistry().reset()
  })

  it('clearInteractions empties the interaction list', async () => {
    getMockProviderRegistry().setResponseQueue([mockConfig])

    const provider = new MockProvider(buildProviderConfig('mock-clear'))

    await provider.complete(buildRequest())
    expect(getMockProviderRegistry().getInteractions()).toHaveLength(1)

    getMockProviderRegistry().clearInteractions()
    expect(getMockProviderRegistry().getInteractions()).toHaveLength(0)
    expect(getMockProviderRegistry().getStats().totalInteractions).toBe(0)
  })

  it('reset clears interactions, response queue, and restores default mode', async () => {
    getMockProviderRegistry().setResponseQueue([
      { content: 'queued', finishReason: 'stop' },
    ])
    getMockProviderRegistry().setResponseMode('echo')

    expect(getMockProviderRegistry().getStats().queueLength).toBe(1)
    expect(getMockProviderRegistry().getResponseMode()).toBe('echo')

    getMockProviderRegistry().reset()

    const stats = getMockProviderRegistry().getStats()
    expect(stats.totalInteractions).toBe(0)
    expect(stats.queueLength).toBe(0)
    expect(stats.responseMode).toBe('default')
  })

  it('getStats reports current registry state', async () => {
    getMockProviderRegistry().setResponseQueue([
      { content: 'a', finishReason: 'stop' },
      { content: 'b', finishReason: 'stop' },
    ])

    const provider = new MockProvider(buildProviderConfig('mock-stats'))

    await provider.complete(buildRequest())

    const stats = getMockProviderRegistry().getStats()
    expect(stats.totalInteractions).toBe(1)
    expect(stats.queueLength).toBe(1)
    expect(stats.responseMode).toBe('queue')
  })
})
