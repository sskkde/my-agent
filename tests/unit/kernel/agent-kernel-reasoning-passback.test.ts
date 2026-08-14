import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { LLMResult, LLMRequest, ToolCall } from '../../../src/llm/types.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type {
  KernelRunInput,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'

const REASONING_FIXTURE = 'REASONING_PASSBACK_FIXTURE'

class FakeLLMAdapter implements LLMAdapter {
  private responses: LLMRequest[] = []
  private responseQueue: Array<() => Promise<LLMResult>> = []
  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  }
  providers: LLMProvider[] = []

  setResponseQueue(queue: Array<() => Promise<LLMResult>>): void {
    this.responseQueue = queue
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.responses.push(request)
    if (this.responseQueue.length > 0) {
      const handler = this.responseQueue.shift()!
      return handler()
    }
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

  async *stream(request: LLMRequest): AsyncGenerator<import('../../../src/llm/types.js').LLMStreamChunk> {
    const result = await this.complete(request)
    if (!result.success) return
    const response = result.response
    if (response.reasoningContent) {
      yield {
        kind: 'reasoning',
        delta: response.reasoningContent,
        providerId: result.providerId,
        model: request.model,
      }
    }
    if (response.content) {
      yield {
        kind: 'text',
        delta: response.content,
        providerId: result.providerId,
        model: request.model,
      }
    }
    if (response.toolCalls) {
      for (let index = 0; index < response.toolCalls.length; index++) {
        const tc = response.toolCalls[index]
        if (!tc) continue
        yield {
          kind: 'tool_call_delta',
          index,
          id: tc.id,
          name: tc.function.name,
          argumentsDelta: tc.function.arguments,
          providerId: result.providerId,
          model: request.model,
        }
      }
    }
    yield {
      kind: 'finish',
      finishReason: response.finishReason,
      providerId: result.providerId,
      model: request.model,
    }
  }

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

  getAllRequests(): LLMRequest[] {
    return this.responses
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
          taxonomyLayer: 'platform',
          description: 'Test base',
          content: 'You are a helpful assistant.',
        },
      ],
      [
        'agentProfile:default_main',
        {
          id: 'agentProfile:default_main',
          version: '2026-05-23',
          path: 'agents/kernel.md',
          agentKind: 'kernel',
          providerFamily: '*',
          layer: 3,
          taxonomyLayer: 'agentProfile',
          agentProfile: 'default_main',
          description: 'Test kernel',
          content: 'Execute tasks.',
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
    maxIterations: 5,
    timeoutMs: 5000,
  }
}

describe('AgentKernel reasoning_content passback (Fix-P0-3)', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env.TOOL_LOOP_V2_ENABLED
    process.env.TOOL_LOOP_V2_ENABLED = 'true'
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TOOL_LOOP_V2_ENABLED
    } else {
      process.env.TOOL_LOOP_V2_ENABLED = originalEnv
    }
  })

  it('replays reasoningContent on replayed assistant tool-call turns', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-p0-1', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
    ]

    const fakeLLM = new FakeLLMAdapter()
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls,
          reasoningContent: REASONING_FIXTURE,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
      async () => ({
        success: true,
        response: {
          id: 'resp-2',
          model: 'test-model',
          content: 'final answer',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ])

    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)
    const result = await kernel.run(makeRunInput())

    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('final answer')

    const requests = fakeLLM.getAllRequests()
    expect(requests.length).toBe(2)

    const secondRequest = requests[1]
    const assistantToolCallMessage = secondRequest.messages.find(
      (m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0,
    )
    expect(assistantToolCallMessage).toBeDefined()
    expect(assistantToolCallMessage?.reasoningContent).toBe(REASONING_FIXTURE)
  })

  it('omits reasoningContent when the tool-call turn had no reasoning', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-p0-2', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
    ]

    const fakeLLM = new FakeLLMAdapter()
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
      async () => ({
        success: true,
        response: {
          id: 'resp-2',
          model: 'test-model',
          content: 'final answer',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ])

    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)
    await kernel.run(makeRunInput())

    const requests = fakeLLM.getAllRequests()
    expect(requests.length).toBe(2)

    const secondRequest = requests[1]
    const assistantToolCallMessage = secondRequest.messages.find(
      (m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0,
    )
    expect(assistantToolCallMessage).toBeDefined()
    expect(assistantToolCallMessage?.reasoningContent).toBeUndefined()
  })

  it('keeps reasoning passback per-turn in a multi-step loop (mixed turns)', async () => {
    const toolCalls1: ToolCall[] = [
      { id: 'call-p0-a', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
    ]
    const toolCalls2: ToolCall[] = [
      { id: 'call-p0-b', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
    ]

    const fakeLLM = new FakeLLMAdapter()
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls: toolCalls1,
          reasoningContent: `${REASONING_FIXTURE}-1`,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
      async () => ({
        success: true,
        response: {
          id: 'resp-2',
          model: 'test-model',
          content: '',
          role: 'assistant',
          toolCalls: toolCalls2,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
      async () => ({
        success: true,
        response: {
          id: 'resp-3',
          model: 'test-model',
          content: 'final answer',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ])

    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)
    await kernel.run(makeRunInput())

    const requests = fakeLLM.getAllRequests()
    expect(requests.length).toBe(3)

    // Third request replays BOTH prior tool-call turns: first WITH reasoning,
    // second WITHOUT (empty reasoning omitted).
    const thirdRequest = requests[2]
    const assistantToolCallMessages = thirdRequest.messages.filter(
      (m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0,
    )
    expect(assistantToolCallMessages.length).toBe(2)
    expect(assistantToolCallMessages[0].reasoningContent).toBe(`${REASONING_FIXTURE}-1`)
    expect(assistantToolCallMessages[1].reasoningContent).toBeUndefined()
  })

  it('reasoning-only turn completes with empty assistant message and never passes reasoning back (P2-3 preserved)', async () => {
    const fakeLLM = new FakeLLMAdapter()
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'test-model',
          content: '',
          role: 'assistant',
          reasoningContent: REASONING_FIXTURE,
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ])

    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)
    const result = await kernel.run(makeRunInput())

    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('')
    expect(result.reasoningContent).toBe(REASONING_FIXTURE)

    // No tool calls → no second LLM request → no passback of any kind.
    const requests = fakeLLM.getAllRequests()
    expect(requests.length).toBe(1)
  })

  it('sets reasoningContentPassback=true only for the deepseek family', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-p0-3', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
    ]

    const fakeLLM = new FakeLLMAdapter()
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'deepseek-reasoner',
          content: '',
          role: 'assistant',
          toolCalls,
          reasoningContent: REASONING_FIXTURE,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
      async () => ({
        success: true,
        response: {
          id: 'resp-2',
          model: 'deepseek-reasoner',
          content: 'final answer',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ])

    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)
    await kernel.run({ ...makeRunInput(), model: 'deepseek-reasoner' })

    const requests = fakeLLM.getAllRequests()
    expect(requests.length).toBe(2)
    // resolveProviderFamily(undefined, 'deepseek-reasoner') === 'deepseek'
    expect(requests[0].reasoningContentPassback).toBe(true)
    expect(requests[1].reasoningContentPassback).toBe(true)
  })

  it('does NOT set reasoningContentPassback for non-deepseek families', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-p0-4', type: 'function', function: { name: 'test_tool', arguments: '{}' } },
    ]

    const fakeLLM = new FakeLLMAdapter()
    fakeLLM.setResponseQueue([
      async () => ({
        success: true,
        response: {
          id: 'resp-1',
          model: 'gpt-4',
          content: '',
          role: 'assistant',
          toolCalls,
          reasoningContent: REASONING_FIXTURE,
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
      async () => ({
        success: true,
        response: {
          id: 'resp-2',
          model: 'gpt-4',
          content: 'final answer',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake',
      }),
    ])

    const config = makeBaseConfig({ llmAdapter: fakeLLM })
    const kernel = new AgentKernel(config)
    await kernel.run(makeRunInput())

    const requests = fakeLLM.getAllRequests()
    expect(requests.length).toBe(2)
    expect(requests[0].reasoningContentPassback).toBeUndefined()
    expect(requests[1].reasoningContentPassback).toBeUndefined()
  })
})
