import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LLMResult, LLMRequest } from '../../../src/llm/types.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type {
  KernelRunInput,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js'
import type { ToolPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { extractToolsForRequest } from '../../../src/kernel/model-input/model-input-builder.js'
import type { ModelInputBuildInput } from '../../../src/kernel/model-input/model-input-types.js'

// ─── Minimal fakes ──────────────────────────────────────────────────────────

class FakeLLMAdapter implements LLMAdapter {
  private lastRequest: LLMRequest | undefined
  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  }
  providers: LLMProvider[] = []

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.lastRequest = request
    return {
      success: true,
      response: {
        id: 'resp-test',
        model: request.model,
        content: 'done',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'fake',
    }
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string }> {}

  addProvider(provider: LLMProvider): void {
    this.providers.push(provider)
  }
  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId)
  }
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.find((p) => p.id === providerId)
  }
  getHealthyProviders(): LLMProvider[] {
    return this.providers
  }
  updateProviderPriority(_providerId: string, _priority: number): void {}

  getLastRequest(): LLMRequest | undefined {
    return this.lastRequest
  }
}

class FakeToolExecutor implements ToolExecutor {
  async execute() {
    return { success: true, data: { result: 'ok' } }
  }
}

class FakeContextManager implements ContextManager {
  assembleBundle(): ContextBundle {
    return {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 100,
    }
  }
  getItems() {
    return []
  }
  addItem() {}
  applyDelta() {}
}

class FakeDispatcher implements RuntimeDispatcher {
  async dispatch() {
    return {
      requestId: 'req-test',
      actionId: 'act-test',
      status: 'completed',
      targetRuntime: 'tool_plane',
      result: { ok: true },
      createdAt: new Date().toISOString(),
    }
  }
}

class CountingDispatcher implements RuntimeDispatcher {
  calls = 0

  async dispatch() {
    this.calls += 1
    return {
      requestId: 'req-counting',
      actionId: 'act-counting',
      status: 'completed',
      targetRuntime: 'tool_plane',
      result: { dispatched: true },
      createdAt: new Date().toISOString(),
    }
  }
}

class ToolCallLLMAdapter implements LLMAdapter {
  private lastRequest: LLMRequest | undefined
  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  }
  providers: LLMProvider[] = []

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.lastRequest = request
    return {
      success: true,
      response: {
        id: 'resp-tool-call',
        model: request.model,
        content: '',
        role: 'assistant',
        finishReason: 'tool_calls',
        createdAt: new Date().toISOString(),
        toolCalls: [
          {
            id: 'tc-internal-1',
            type: 'function',
            function: {
              name: 'foreground_decide',
              arguments: JSON.stringify({ route: 'answer_directly', reason: 'Use internal handler' }),
            },
          },
        ],
      },
      providerId: 'fake',
    }
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string }> {}

  addProvider(provider: LLMProvider): void {
    this.providers.push(provider)
  }
  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId)
  }
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.find((p) => p.id === providerId)
  }
  getHealthyProviders(): LLMProvider[] {
    return this.providers
  }
  updateProviderPriority(_providerId: string, _priority: number): void {}

  getLastRequest(): LLMRequest | undefined {
    return this.lastRequest
  }
}

class HangingLLMAdapter implements LLMAdapter {
  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  }
  providers: LLMProvider[] = []

  async complete(): Promise<LLMResult> {
    return new Promise(() => {})
  }

  async *stream(): AsyncGenerator<{ delta: string; providerId: string }> {}
  addProvider(provider: LLMProvider): void {
    this.providers.push(provider)
  }
  removeProvider(providerId: string): void {
    this.providers = this.providers.filter((p) => p.id !== providerId)
  }
  getProvider(providerId: string): LLMProvider | undefined {
    return this.providers.find((p) => p.id === providerId)
  }
  getHealthyProviders(): LLMProvider[] {
    return this.providers
  }
  updateProviderPriority(_providerId: string, _priority: number): void {}
}

function createModelInputBuilder(): ModelInputBuilder {
  const registry = new PromptTemplateRegistry(
    new Map([
      [
        'platform:base',
        {
          id: 'platform:base',
          version: '2026-05-23',
          path: 'platform/base.md',
          agentKind: '*',
          providerFamily: '*',
          layer: 1,
          description: 'Test base',
          content: 'You are a helpful assistant.',
        },
      ],
      [
        'agents:kernel',
        {
          id: 'agents:kernel',
          version: '2026-05-23',
          path: 'agents/kernel.md',
          agentKind: 'kernel',
          providerFamily: '*',
          layer: 3,
          description: 'Test kernel',
          content: 'Kernel agent instructions.',
        },
      ],
    ]),
  )
  return new ModelInputBuilder({
    templateRegistry: registry,
    templateLoader: new TemplateLoader(),
  })
}

function makeBaseConfig(overrides?: Partial<KernelConfig>): KernelConfig {
  return {
    llmAdapter: new FakeLLMAdapter(),
    toolExecutor: new FakeToolExecutor(),
    contextManager: new FakeContextManager(),
    dispatcher: new FakeDispatcher(),
    modelInputBuilder: createModelInputBuilder(),
    maxIterations: 10,
    timeoutMs: 30000,
    ...overrides,
  }
}

function makeRunInput(): KernelRunInput {
  return {
    contextBundle: {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 100,
    },
    runId: 'test-run',
    agentId: 'test-agent',
    agentType: 'main',
    userId: 'test-user',
    maxIterations: 1,
    timeoutMs: 5000,
  }
}

const sampleToolProjection: ToolPlaneProjection = {
  toolIds: ['status_query', 'web_search'],
  tools: [
    {
      type: 'function',
      function: {
        name: 'status_query',
        description: 'Query active work status',
        parameters: { type: 'object', properties: { runId: { type: 'string' } } },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    },
  ],
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AgentKernel toolProjection in function_calling mode', () => {
  let fakeLLM: FakeLLMAdapter

  beforeEach(() => {
    fakeLLM = new FakeLLMAdapter()
  })

  it('passes toolProjection from config to ModelInputBuildInput', async () => {
    const config = makeBaseConfig({
      llmAdapter: fakeLLM,
      toolProjection: sampleToolProjection,
    })
    const kernel = new AgentKernel(config)
    await kernel.run(makeRunInput())

    const request = fakeLLM.getLastRequest()
    expect(request).toBeDefined()
    expect(request!.tools).toBeDefined()
    expect(request!.tools!.length).toBe(2)
    expect(request!.tools![0].function.name).toBe('status_query')
    expect(request!.tools![1].function.name).toBe('web_search')
  })

  it('uses empty fallback when toolProjection is not provided', async () => {
    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)
    await kernel.run(makeRunInput())

    const request = fakeLLM.getLastRequest()
    expect(request).toBeDefined()
    // With empty fallback { toolIds: [], tools: [] }, extractToolsForRequest
    // sees tools as [] (empty array, not undefined), so it returns [] not undefined
    expect(request!.tools).toEqual([])
  })

  it('function_calling mode with tools produces LLMRequest.tools as non-empty array', async () => {
    const config = makeBaseConfig({
      llmAdapter: fakeLLM,
      toolProjection: sampleToolProjection,
    })
    const kernel = new AgentKernel(config)
    await kernel.run(makeRunInput())

    const request = fakeLLM.getLastRequest()
    expect(request!.tools).toBeDefined()
    expect(request!.tools!.length).toBeGreaterThan(0)
    for (const tool of request!.tools!) {
      expect(tool.type).toBe('function')
      expect(tool.function.name).toBeTypeOf('string')
      expect(tool.function.description).toBeTypeOf('string')
    }
  })

  it('function_calling mode with toolIds-only projection produces LLMRequest.tools as undefined via extractToolsForRequest', () => {
    // When toolProjection has toolIds but no tools field,
    // extractToolsForRequest returns undefined (no full schemas available)
    const projectionWithoutSchemas: ToolPlaneProjection = {
      toolIds: ['status_query', 'web_search'],
    }

    const buildInput: ModelInputBuildInput = {
      mode: 'function_calling',
      agentKind: 'kernel',
      providerFamily: 'openai',
      toolProjection: projectionWithoutSchemas,
      currentDate: new Date().toISOString(),
      sessionId: 'test',
      runId: 'test',
    }

    const tools = extractToolsForRequest(buildInput)
    expect(tools).toBeUndefined()
  })

  it('function_calling mode with empty toolIds and empty tools array produces LLMRequest.tools as empty array', () => {
    const buildInput: ModelInputBuildInput = {
      mode: 'function_calling',
      agentKind: 'kernel',
      providerFamily: 'openai',
      toolProjection: { toolIds: [], tools: [] },
      currentDate: new Date().toISOString(),
      sessionId: 'test',
      runId: 'test',
    }

    const tools = extractToolsForRequest(buildInput)
    // tools is [] (empty array, truthy-ish but length 0)
    // extractToolsForRequest: if input.toolProjection?.tools is truthy (even []), returns it
    expect(tools).toEqual([])
  })

  it('function_calling mode without toolProjection at all produces LLMRequest.tools as undefined via extractToolsForRequest', () => {
    const buildInput: ModelInputBuildInput = {
      mode: 'function_calling',
      agentKind: 'kernel',
      providerFamily: 'openai',
      currentDate: new Date().toISOString(),
      sessionId: 'test',
      runId: 'test',
    }

    const tools = extractToolsForRequest(buildInput)
    expect(tools).toBeUndefined()
  })
})

describe('AgentKernel toolProjection per-run override', () => {
  let fakeLLM: FakeLLMAdapter

  beforeEach(() => {
    fakeLLM = new FakeLLMAdapter()
  })

  it('KernelRunInput.toolProjection overrides KernelConfig.toolProjection', async () => {
    const configProjection: ToolPlaneProjection = {
      toolIds: ['status_query'],
      tools: [
        {
          type: 'function',
          function: {
            name: 'status_query',
            description: 'Query status',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    }
    const runProjection: ToolPlaneProjection = {
      toolIds: ['web_search'],
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        },
      ],
    }

    const config = makeBaseConfig({
      llmAdapter: fakeLLM,
      toolProjection: configProjection,
    })
    const kernel = new AgentKernel(config)

    const input: KernelRunInput = {
      ...makeRunInput(),
      toolProjection: runProjection,
    }
    await kernel.run(input)

    const request = fakeLLM.getLastRequest()
    expect(request).toBeDefined()
    expect(request!.tools!.length).toBe(1)
    expect(request!.tools![0].function.name).toBe('web_search')
  })

  it('KernelRunInput.toolProjection is used when KernelConfig has none', async () => {
    const runProjection: ToolPlaneProjection = {
      toolIds: ['status_query', 'web_search'],
      tools: [
        {
          type: 'function',
          function: {
            name: 'status_query',
            description: 'Query status',
            parameters: { type: 'object', properties: {} },
          },
        },
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        },
      ],
    }

    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)

    const input: KernelRunInput = {
      ...makeRunInput(),
      toolProjection: runProjection,
    }
    await kernel.run(input)

    const request = fakeLLM.getLastRequest()
    expect(request).toBeDefined()
    expect(request!.tools!.length).toBe(2)
    expect(request!.tools![0].function.name).toBe('status_query')
    expect(request!.tools![1].function.name).toBe('web_search')
  })

  it('falls back to KernelConfig.toolProjection when run input has none', async () => {
    const configProjection: ToolPlaneProjection = {
      toolIds: ['status_query'],
      tools: [
        {
          type: 'function',
          function: {
            name: 'status_query',
            description: 'Query status',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    }

    const config = makeBaseConfig({
      llmAdapter: fakeLLM,
      toolProjection: configProjection,
    })
    const kernel = new AgentKernel(config)

    await kernel.run(makeRunInput())

    const request = fakeLLM.getLastRequest()
    expect(request).toBeDefined()
    expect(request!.tools!.length).toBe(1)
    expect(request!.tools![0].function.name).toBe('status_query')
  })
})

describe('AgentKernel internal tool handling', () => {
  it('bypasses dispatcher and returns structuredResult when internal handler stops', async () => {
    const fakeLLM = new ToolCallLLMAdapter()
    const dispatcher = new CountingDispatcher()
    const kernel = new AgentKernel(
      makeBaseConfig({
        llmAdapter: fakeLLM,
        dispatcher,
      }),
    )

    const result = await kernel.run({
      ...makeRunInput(),
      toolProjection: {
        toolIds: [],
        tools: [
          {
            type: 'function',
            function: {
              name: 'foreground_decide',
              description: 'Internal foreground routing decision',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      },
      internalToolHandlers: {
        foreground_decide: async (request) => ({
          toolResult: {
            toolCallId: request.toolCallId,
            result: { decision: { route: 'answer_directly', reason: 'Handled internally' } },
          },
          stop: true,
          structuredResult: { decision: { route: 'answer_directly', reason: 'Handled internally' } },
        }),
      },
    })

    expect(dispatcher.calls).toBe(0)
    expect(result.finalStatus).toBe('completed')
    expect(result.structuredResult).toEqual({ decision: { route: 'answer_directly', reason: 'Handled internally' } })
    expect(result.transcript.some((entry) => entry.type === 'tool_call')).toBe(true)
    expect(result.transcript.some((entry) => entry.type === 'tool_result')).toBe(true)
  })

  it('uses modelInputOverride and per-run LLM request overrides', async () => {
    const fakeLLM = new ToolCallLLMAdapter()
    const kernel = new AgentKernel(makeBaseConfig({ llmAdapter: fakeLLM }))

    await kernel.run({
      ...makeRunInput(),
      modelInputOverride: {
        mode: 'routing_tool_call',
        agentKind: 'foreground',
        providerFamily: 'openai',
        toolProjection: sampleToolProjection,
        currentUserMessage: 'Please route this message',
        sessionId: 'session-override',
        runId: 'run-override',
      },
      temperature: 0.1,
      maxTokens: 500,
      toolChoice: { type: 'function', function: { name: 'foreground_decide' } },
      model: 'foreground-routing-model',
      internalToolHandlers: {
        foreground_decide: async (request) => ({
          toolResult: {
            toolCallId: request.toolCallId,
            result: { decision: { route: 'answer_directly', reason: 'ok' } },
          },
          stop: true,
          structuredResult: { decision: { route: 'answer_directly', reason: 'ok' } },
        }),
      },
    })

    const request = fakeLLM.getLastRequest()
    expect(request).toBeDefined()
    expect(request!.model).toBe('foreground-routing-model')
    expect(request!.temperature).toBe(0.1)
    expect(request!.maxTokens).toBe(500)
    expect(request!.toolChoice).toEqual({ type: 'function', function: { name: 'foreground_decide' } })
    expect(request!.tools?.map((tool) => tool.function.name)).toEqual(['status_query', 'web_search'])
    expect(request!.messages.some((message) => message.content.includes('Please route this message'))).toBe(true)
  })

  it('does not dispatch tool calls that were not projected as callable schemas', async () => {
    const fakeLLM = new ToolCallLLMAdapter()
    const dispatcher = new CountingDispatcher()
    const kernel = new AgentKernel(
      makeBaseConfig({
        llmAdapter: fakeLLM,
        dispatcher,
      }),
    )

    const result = await kernel.run({
      ...makeRunInput(),
      toolProjection: {
        toolIds: ['foreground_decide'],
        tools: [
          {
            type: 'function',
            function: {
              name: 'other.tool',
              description: 'Different projected tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      },
    })

    expect(dispatcher.calls).toBe(0)
    expect(result.finalStatus).toBe('max_iterations_reached')
    const toolResult = result.transcript.find((entry) => entry.type === 'tool_result')
    expect(toolResult?.content).toMatchObject({
      error: {
        code: 'UNPROJECTED_TOOL_CALL',
      },
    })
  })

  it('returns timeout when the LLM call exceeds timeoutMs', async () => {
    vi.useFakeTimers()
    const kernel = new AgentKernel(makeBaseConfig({ llmAdapter: new HangingLLMAdapter() }))
    const runPromise = kernel.run({
      ...makeRunInput(),
      timeoutMs: 10,
    })

    await vi.advanceTimersByTimeAsync(11)
    const result = await runPromise
    vi.useRealTimers()

    expect(result.finalStatus).toBe('failed')
    expect(result.error?.code).toBe('KERNEL_ERROR')
    expect(result.error?.message).toContain('LLM request timeout')
  })
})

describe('AgentKernel envelope enforcement', () => {
  it('remote agentType rejects all tool calls even when projected', async () => {
    const fakeLLM = new ToolCallLLMAdapter()
    const dispatcher = new CountingDispatcher()
    const kernel = new AgentKernel(
      makeBaseConfig({
        llmAdapter: fakeLLM,
        dispatcher,
      }),
    )

    const result = await kernel.run({
      ...makeRunInput(),
      agentType: 'remote',
      toolProjection: {
        toolIds: ['status_query'],
        tools: [
          {
            type: 'function',
            function: {
              name: 'status_query',
              description: 'Query status',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      },
    })

    expect(dispatcher.calls).toBe(0)
    const toolResult = result.transcript.find((entry) => entry.type === 'tool_result')
    expect(toolResult?.content).toMatchObject({
      error: {
        code: 'UNPROJECTED_TOOL_CALL',
      },
    })
  })

  it('main agentType allows projected read/search/internal tools', async () => {
    const fakeLLM = new FakeLLMAdapter()
    const dispatcher = new CountingDispatcher()
    const kernel = new AgentKernel(
      makeBaseConfig({
        llmAdapter: fakeLLM,
        dispatcher,
        toolProjection: {
          toolIds: ['status_query'],
          tools: [
            {
              type: 'function',
              function: {
                name: 'status_query',
                description: 'Query status',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
        },
      }),
    )

    const result = await kernel.run({
      ...makeRunInput(),
      agentType: 'main',
    })

    expect(result.finalStatus).toBe('completed')
    expect(result.error).toBeUndefined()
  })
})
