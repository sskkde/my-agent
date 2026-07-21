import { describe, it, expect, beforeEach } from 'vitest'
import type {
  KernelRunInput,
  KernelRunResult,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
  InternalToolHandler,
  InternalToolHandlerResult,
} from '../../../src/kernel/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMResult, LLMRequest, LLMResponse, ToolDefinition } from '../../../src/llm/types.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { ContextItem, ContextBundle } from '../../../src/context/types.js'
import type { DispatchRequest } from '../../../src/dispatcher/types.js'
import type { ToolPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'

// ---------------------------------------------------------------------------
// Test fakes (mirror integration/kernel test pattern)
// ---------------------------------------------------------------------------

class FakeLLMAdapter implements LLMAdapter {
  private responses: LLMResponse[]
  private currentIndex = 0
  capturedRequests: LLMRequest[] = []
  config: LLMAdapterConfig
  providers: LLMProvider[] = []

  constructor(responses: LLMResponse[]) {
    this.responses = responses
    this.config = {
      providers: [],
      defaultTimeoutMs: 60000,
      enableCircuitBreaker: false,
    }
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.capturedRequests.push(request)
    const response = this.responses[this.currentIndex++]
    if (this.currentIndex >= this.responses.length) {
      this.currentIndex = this.responses.length - 1
    }
    return { success: true, response, providerId: 'fake-provider' }
  }

  async *stream(
    request: LLMRequest,
  ): AsyncGenerator<import('../../../src/llm/types.js').LLMStreamChunk> {
    const result = await this.complete(request)
    if (!result.success) return
    const response = result.response
    if (response.content) {
      yield { kind: 'text', delta: response.content, providerId: result.providerId, model: request.model }
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

  addProvider(provider: LLMProvider): void { this.providers.push(provider) }
  removeProvider(providerId: string): void { this.providers = this.providers.filter(p => p.id !== providerId) }
  getProvider(providerId: string): LLMProvider | undefined { return this.providers.find(p => p.id === providerId) }
  getHealthyProviders(): LLMProvider[] { return this.providers }
  updateProviderPriority(providerId: string, priority: number): void {
    const p = this.getProvider(providerId)
    if (p) p.updateConfig({ ...p.config, priority })
  }
}

class FakeToolExecutor {
  async execute(_request: {
    toolCallId: string
    toolName: string
    params: unknown
    userId: string
    sessionId?: string
    kernelRunId?: string
    permissionContext: { userId: string; permissions: string[] }
  }): Promise<{ success: boolean; data?: unknown; error?: { code: string; message: string; recoverable: boolean }; resultPreview?: string }> {
    return { success: true, data: {}, resultPreview: '{}' }
  }
}

class FakeContextManager {
  private contextItems: ContextItem[] = []

  addItem(item: ContextItem): void { this.contextItems.push(item) }
  getItems(): ContextItem[] { return this.contextItems }

  assembleBundle(): ContextBundle {
    return {
      bundleId: 'test-bundle',
      runId: 'test-run',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      invocationSource: 'gateway_intent',
      pinnedItems: [],
      orderedItems: this.contextItems,
      tokenEstimate: 100,
    }
  }

  applyDelta(delta: { items?: ContextItem[] }): void {
    if (delta.items) this.contextItems.push(...delta.items)
  }
}

class FakeDispatcher {
  dispatchCalls: DispatchRequest[] = []

  async dispatch(request: DispatchRequest): Promise<{
    requestId: string
    actionId: string
    status: string
    targetRuntime: string
    result?: unknown
    error?: { code: string; message: string; recoverable: boolean }
    createdAt: string
    completedAt?: string
  }> {
    this.dispatchCalls.push(request)
    return {
      requestId: request.requestId,
      actionId: request.action.actionId,
      status: 'completed',
      targetRuntime: request.action.targetRuntime,
      result: { success: true, data: { executed: true } },
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function createTextResponse(content: string): LLMResponse {
  return {
    id: 'resp-' + Date.now(),
    model: 'test-model',
    content,
    role: 'assistant',
    finishReason: 'stop',
    createdAt: new Date().toISOString(),
  }
}

function throwIfCalled(): never {
  throw new Error('LLM should not have been called')
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Kernel abort signal', () => {
  let fakeToolExecutor: FakeToolExecutor
  let fakeContextManager: FakeContextManager
  let fakeDispatcher: FakeDispatcher
  let modelInputBuilder: ModelInputBuilder

  beforeEach(() => {
    fakeToolExecutor = new FakeToolExecutor()
    fakeContextManager = new FakeContextManager()
    fakeDispatcher = new FakeDispatcher()

    const testRegistry = new PromptTemplateRegistry(
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
            content: 'Execute tasks using available tools.',
          },
        ],
      ]),
    )
    modelInputBuilder = new ModelInputBuilder({
      templateRegistry: testRegistry,
      templateLoader: new TemplateLoader(),
    })
  })

  function createConfig(llmAdapter: FakeLLMAdapter, maxIterations = 10, overrides?: Partial<KernelConfig>): KernelConfig {
    return {
      llmAdapter,
      toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
      contextManager: fakeContextManager as unknown as ContextManager,
      dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
      modelInputBuilder,
      maxIterations,
      timeoutMs: 60000,
      ...overrides,
    }
  }

  function toolProjectionFor(...toolNames: string[]): ToolPlaneProjection {
    const tools: ToolDefinition[] = toolNames.map((name) => ({
      type: 'function',
      function: { name, description: 'Test tool: ' + name, parameters: { type: 'object', properties: {} } },
    }))
    return { toolIds: toolNames, tools }
  }

  function createInput(overrides?: Partial<KernelRunInput>): KernelRunInput {
    return {
      contextBundle: fakeContextManager.assembleBundle(),
      runId: 'test-run-id',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      sessionId: 'test-session',
      maxIterations: 10,
      timeoutMs: 60000,
      ...overrides,
    }
  }

  it('should return cancelled immediately when pre-aborted signal is passed', async () => {
    // Create a signal that is already aborted
    const controller = new AbortController()
    controller.abort()

    // Create an LLM adapter that would throw if called
    const adapter = new FakeLLMAdapter([])
    const originalComplete = adapter.complete.bind(adapter)
    adapter.complete = async (_request: LLMRequest): Promise<LLMResult> => {
      throwIfCalled()
      return originalComplete(_request)
    }

    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ signal: controller.signal }),
    )

    // Should return immediately with cancelled status
    expect(result.finalStatus).toBe('cancelled')
    // Signal check is before iteration increment, so 0 iterations used
    expect(result.iterationsUsed).toBe(0)
    // No LLM call captured
    expect(adapter.capturedRequests).toHaveLength(0)
  })

  it('should abort during iteration and return cancelled', async () => {
    const controller = new AbortController()
    // Blocking internal tool handler — resolves after signal fires
    let resolveHandler!: (value: InternalToolHandlerResult) => void
    const handlerPromise = new Promise<InternalToolHandlerResult>((resolve) => {
      resolveHandler = resolve
    })
    const blockingHandler: InternalToolHandler = async () => handlerPromise

    // Tool call response to trigger the handler
    const toolCallResponse: LLMResponse = {
      id: 'resp-tool-' + Date.now(),
      model: 'test-model',
      content: '',
      role: 'assistant',
      toolCalls: [
        { id: 'call-abort', type: 'function', function: { name: 'blocking-tool', arguments: '{}' } },
      ],
      finishReason: 'tool_calls',
      createdAt: new Date().toISOString(),
    }
    const adapter = new FakeLLMAdapter([
      toolCallResponse,
      createTextResponse('Should not reach here'),
    ])

    function toolProjectionFor(...toolNames: string[]): ToolPlaneProjection {
      const tools: ToolDefinition[] = toolNames.map((name) => ({
        type: 'function',
        function: { name, description: 'Test tool: ' + name, parameters: { type: 'object', properties: {} } },
      }))
      return { toolIds: toolNames, tools }
    }

    const kernel = new AgentKernel(createConfig(adapter))
    const resultPromise = kernel.run(
      createInput({
        signal: controller.signal,
        internalToolHandlers: { 'blocking-tool': blockingHandler },
        toolProjection: toolProjectionFor('blocking-tool'),
        maxIterations: 10,
      }),
    )

    // Let kernel reach the blocking handler
    await new Promise((r) => setTimeout(r, 20))

    // Abort the run
    controller.abort()

    // Unblock the handler
    resolveHandler({
      toolResult: {
        toolCallId: 'call-abort',
        result: null,
        error: { code: 'ABORTED', message: 'aborted externally', recoverable: true },
      },
    })

    const result = await resultPromise

    // Signal check 4 fires after internal handler → returns cancelled
    expect(result.finalStatus).toBe('cancelled')
    expect(result.iterationsUsed).toBe(1)
  })

  it('should run normally to completion when no signal is provided', async () => {
    const adapter = new FakeLLMAdapter([
      createTextResponse('Normal response.'),
    ])

    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput())

    // Normal completion
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Normal response.')
    expect(adapter.capturedRequests).toHaveLength(1)
    expect(result.iterationsUsed).toBe(1)
  })

  it('should abort hanging LLM complete() when signal fires (RED - fails without C2)', async () => {
    const controller = new AbortController()

    // Fake LLM that hangs forever on complete() — never resolves
    const adapter = new FakeLLMAdapter([])
    adapter.complete = async (_request: LLMRequest): Promise<LLMResult> => {
      // Hang forever
      await new Promise(() => {}) // never resolves
      throw new Error('unreachable')
    }

    const kernel = new AgentKernel(
      createConfig(adapter, 10, { providerFamily: 'test-non-streaming' }),
    )

    const resultPromise = kernel.run(
      createInput({
        signal: controller.signal,
        toolProjection: toolProjectionFor('test-tool'),
      }),
    )

    // Give kernel time to pass signal check 2 and enter the LLM call
    await new Promise((r) => setTimeout(r, 50))

    // Abort — should cancel the hanging LLM call immediately
    controller.abort()

    // Should resolve quickly (NOT wait for full 60s timeout)
    const result = await resultPromise

    // Status must be cancelled or failed (NOT timeout)
    expect(['cancelled', 'failed']).toContain(result.finalStatus)
    // LLM call was started (1 iteration used with tool projection)
    expect(result.iterationsUsed).toBe(1)
  }, 5000) // 5s vitest timeout — fails without C2 (would take 60s)
})
