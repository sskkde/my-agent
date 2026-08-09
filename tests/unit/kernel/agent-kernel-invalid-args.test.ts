import { describe, it, expect, beforeEach } from 'vitest'
import type {
  KernelRunInput,
  KernelRunResult,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMResult, LLMRequest, ToolCall, LLMResponse, ToolDefinition } from '../../../src/llm/types.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { ContextItem, ContextBundle } from '../../../src/context/types.js'
import type { DispatchRequest } from '../../../src/dispatcher/types.js'
import type { ToolPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'

// ---------------------------------------------------------------------------
// Test fakes (same pattern as agent-kernel-truncation-guard.test.ts)
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

  async *stream(request: LLMRequest): AsyncGenerator<import('../../../src/llm/types.js').LLMStreamChunk> {
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
  }): Promise<{
    success: boolean
    data?: unknown
    error?: { code: string; message: string; recoverable: boolean }
    resultPreview?: string
  }> {
    return { success: true, data: {}, resultPreview: '{}' }
  }
}

class FakeContextManager {
  private contextItems: ContextItem[] = []

  addItem(item: ContextItem): void {
    this.contextItems.push(item)
  }
  getItems(): ContextItem[] {
    return this.contextItems
  }

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

function createToolUseResponse(toolCalls: ToolCall[]): LLMResponse {
  return {
    id: 'resp-tool-' + Date.now(),
    model: 'test-model',
    content: '',
    role: 'assistant',
    toolCalls,
    finishReason: 'tool_calls',
    createdAt: new Date().toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Invalid tool argument JSON guard', () => {
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

  function createConfig(llmAdapter: FakeLLMAdapter, maxIterations = 10): KernelConfig {
    return {
      llmAdapter,
      toolExecutor: fakeToolExecutor as unknown as ToolExecutor,
      contextManager: fakeContextManager as unknown as ContextManager,
      dispatcher: fakeDispatcher as unknown as RuntimeDispatcher,
      modelInputBuilder,
      maxIterations,
      timeoutMs: 60000,
    }
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

  function toolProjectionFor(...toolNames: string[]): ToolPlaneProjection {
    const tools: ToolDefinition[] = toolNames.map((name) => ({
      type: 'function',
      function: { name, description: 'Test tool: ' + name, parameters: { type: 'object', properties: {} } },
    }))
    return { toolIds: toolNames, tools }
  }

  // =====================================================================
  // RED test: this should FAIL before the invalid-args guard is implemented
  // because current kernel silently coerces invalid JSON to {} and dispatches.
  // =====================================================================

  it('RED PHASE: should reject invalid JSON tool arguments and emit INVALID_TOOL_ARGUMENTS (fails before guard)', async () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call-invalid-a',
        type: 'function',
        function: { name: 'test-tool', arguments: '{not-json' },
      },
    ]

    const adapter = new FakeLLMAdapter([
      createToolUseResponse(toolCalls),
      createTextResponse('Proceeded after invalid args.'),
    ])

    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('test-tool') }))

    // (a) dispatcher should NOT have been called for invalid JSON args
    expect(fakeDispatcher.dispatchCalls).toHaveLength(0)

    // (b) INVALID_TOOL_ARGUMENTS synthetic result in transcript
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(1)

    const tr = toolResultEntries[0].content as {
      toolCallId: string
      result: unknown
      error?: { code: string; message: string; recoverable: boolean }
    }
    expect(tr.error).toBeDefined()
    expect(tr.error!.code).toBe('INVALID_TOOL_ARGUMENTS')
    expect(tr.error!.recoverable).toBe(true)
    expect(tr.result).toBeNull()

    // (c) toolCallId matches
    expect(tr.toolCallId).toBe('call-invalid-a')

    // (d) Validate pairing
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)

    // (e) Loop continued to text response
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Proceeded after invalid args.')
  })

  it('should still dispatch tools with valid JSON arguments', async () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call-valid-a',
        type: 'function',
        function: { name: 'test-tool', arguments: JSON.stringify({ x: 1 }) },
      },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Valid execution.')])

    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('test-tool') }))

    // (a) dispatcher should have been called
    expect(fakeDispatcher.dispatchCalls.length).toBeGreaterThanOrEqual(1)

    // (b) NO INVALID_TOOL_ARGUMENTS in transcript
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    for (const entry of toolResultEntries) {
      const tr = entry.content as { error?: { code: string } }
      if (tr.error) {
        expect(tr.error.code).not.toBe('INVALID_TOOL_ARGUMENTS')
      }
    }

    // (c) Normal completion
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Valid execution.')
  })

  it('should handle mixed valid and invalid tool calls in one assistant message', async () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'call-invalid-b',
        type: 'function',
        function: { name: 'test-tool', arguments: 'plain-text-not-json' },
      },
      {
        id: 'call-valid-b',
        type: 'function',
        function: { name: 'test-tool', arguments: JSON.stringify({ x: 42 }) },
      },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Mixed batch done.')])

    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('test-tool') }))

    // (a) Only the valid tool should have been dispatched
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)

    // (b) Two tool results in transcript
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    // (c) Invalid tool has INVALID_TOOL_ARGUMENTS
    const invalidResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-invalid-b',
    )
    expect(invalidResult).toBeDefined()
    const invalidContent = invalidResult!.content as {
      toolCallId: string
      result: unknown
      error?: { code: string; message: string; recoverable: boolean }
    }
    expect(invalidContent.error).toBeDefined()
    expect(invalidContent.error!.code).toBe('INVALID_TOOL_ARGUMENTS')
    expect(invalidContent.error!.recoverable).toBe(true)
    expect(invalidContent.result).toBeNull()

    // (d) Valid tool has NO error (success)
    const validResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-valid-b',
    )
    expect(validResult).toBeDefined()
    const validContent = validResult!.content as {
      error?: { code: string }
    }
    expect(validContent.error).toBeUndefined()

    // (e) Validate pairing passes
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)

    // (f) Loop completed normally
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Mixed batch done.')
  })

  it('should reject multiple invalid JSON variants (malformed input probe)', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-openbrace', type: 'function', function: { name: 'test-tool', arguments: '{' } },
      { id: 'call-plaintext', type: 'function', function: { name: 'test-tool', arguments: 'not json at all' } },
      { id: 'call-extracomma', type: 'function', function: { name: 'test-tool', arguments: '{"x":1 ,}' } },
      { id: 'call-broken', type: 'function', function: { name: 'test-tool', arguments: '{broken' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('All malformed handled.')])

    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('test-tool') }))

    // (a) No dispatches — all four are invalid
    expect(fakeDispatcher.dispatchCalls).toHaveLength(0)

    // (b) Four synthetic results
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(4)

    // (c) All have INVALID_TOOL_ARGUMENTS
    for (const entry of toolResultEntries) {
      const tr = entry.content as {
        toolCallId: string
        error?: { code: string; recoverable: boolean }
      }
      expect(tr.error).toBeDefined()
      expect(tr.error!.code).toBe('INVALID_TOOL_ARGUMENTS')
      expect(tr.error!.recoverable).toBe(true)
    }

    // (d) All four toolCallIds present
    const resultIds = toolResultEntries.map((e) => (e.content as { toolCallId: string }).toolCallId).sort()
    expect(resultIds).toEqual(['call-broken', 'call-extracomma', 'call-openbrace', 'call-plaintext'])

    // (e) Pairing valid
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    expect(validateToolResultPairing(result.transcript).valid).toBe(true)
  })
})
