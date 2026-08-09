import { describe, it, expect, beforeEach } from 'vitest'
import type {
  KernelRunInput,
  KernelRunResult,
  KernelConfig,
  ToolExecutor,
  ContextManager,
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
// Test fakes (mirror batch-dispatch test pattern)
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

/**
 * Batch-aware FakeDispatcher.
 * Returns results as ToolExecutionResult[] when toolUses.length > 1.
 * Supports terminate flag via toolResults data map.
 * Tracks all dispatch calls for assertion.
 */
class FakeBatchDispatcher {
  dispatchCalls: DispatchRequest[] = []
  /** Per-toolCallId result overrides for testing terminate flags */
  toolResults: Map<
    string,
    { success: boolean; data?: unknown; error?: { code: string; message: string; recoverable: boolean } }
  > = new Map()

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

    const ta = request.action?.targetAction as
      | { toolDispatchRequest?: { toolUses?: Array<{ toolCallId: string }> } }
      | undefined
    const toolUses = ta?.toolDispatchRequest?.toolUses ?? []
    if (toolUses.length === 0) {
      return {
        requestId: request.requestId,
        actionId: request.action?.actionId ?? 'test',
        status: 'completed',
        targetRuntime: request.action?.targetRuntime ?? 'tool_plane',
        result: { success: true, data: { executed: true } },
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    }

    // Build per-tool results from toolResults map or defaults
    const results: Array<{
      success: boolean
      data?: unknown
      error?: { code: string; message: string; recoverable: boolean }
    }> = []
    for (const tu of toolUses) {
      const existing = this.toolResults.get(tu.toolCallId)
      if (existing) {
        results.push(existing)
      } else {
        results.push({ success: true, data: { toolCallId: tu.toolCallId, result: `result-${tu.toolCallId}` } })
      }
    }

    // Return array for multi-tool, single for single-tool
    const returnResult = results.length === 1 ? results[0] : results

    return {
      requestId: request.requestId,
      actionId: request.action?.actionId ?? 'test',
      status: 'completed',
      targetRuntime: request.action?.targetRuntime ?? 'tool_plane',
      result: returnResult,
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

describe('Batch terminate-all semantics for external tools', () => {
  let fakeDispatcher: FakeBatchDispatcher
  let fakeContextManager: FakeContextManager
  let modelInputBuilder: ModelInputBuilder

  beforeEach(() => {
    fakeDispatcher = new FakeBatchDispatcher()
    fakeContextManager = new FakeContextManager()

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
      toolExecutor: new FakeToolExecutor() as unknown as ToolExecutor,
      contextManager: fakeContextManager as unknown as ContextManager,
      dispatcher: fakeDispatcher as unknown as import('../../../src/kernel/types.js').RuntimeDispatcher,
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
  // Test 1: ALL tools terminate=true → stop loop, no second LLM call
  // =====================================================================

  it('should stop the loop when ALL external tools return terminate=true', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-a', type: 'function', function: { name: 'tool-a', arguments: '{}' } },
      { id: 'call-b', type: 'function', function: { name: 'tool-b', arguments: '{}' } },
    ]

    // Both tools return terminate=true in their data
    fakeDispatcher.toolResults.set('call-a', { success: true, data: { terminate: true, result: 'done-a' } })
    fakeDispatcher.toolResults.set('call-b', { success: true, data: { terminate: true, result: 'done-b' } })

    // Only one LLM response — if loop continues, it will try to read a second response and fail
    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls)])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('tool-a', 'tool-b') }),
    )

    // RED FAIL: loop currently continues regardless of terminate flags →
    // capturedRequests length will be 2 (but adapter only has 1 response,
    // so it will clamp to last response — still captures 2 requests)
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)
    expect(adapter.capturedRequests).toHaveLength(1)
    expect(result.finalStatus).toBe('completed')
  })

  // =====================================================================
  // Test 2: SOME tools terminate=true + SOME terminate=false → continue
  // =====================================================================

  it('should continue the loop when only SOME tools return terminate=true', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-a', type: 'function', function: { name: 'tool-a', arguments: '{}' } },
      { id: 'call-b', type: 'function', function: { name: 'tool-b', arguments: '{}' } },
    ]

    // Only one tool terminates
    fakeDispatcher.toolResults.set('call-a', { success: true, data: { terminate: true, result: 'done-a' } })
    // call-b uses default (no terminate)

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Continue.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('tool-a', 'tool-b') }),
    )

    // RED FAIL: loop currently continues — capturedRequests length will be 2,
    // but the FAIL happens in test 1, not here. This test should still PASS
    // even in RED phase because the loop continues as before.
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)
    expect(adapter.capturedRequests).toHaveLength(2)
    expect(result.finalStatus).toBe('completed')
  })

  // =====================================================================
  // Test 3: NO tools set terminate → loop continues normally
  // =====================================================================

  it('should continue the loop when NO tools return terminate=true', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-a', type: 'function', function: { name: 'tool-a', arguments: '{}' } },
      { id: 'call-b', type: 'function', function: { name: 'tool-b', arguments: '{}' } },
    ]

    // Use default results (no terminate)
    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Continue.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('tool-a', 'tool-b') }),
    )

    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)
    expect(adapter.capturedRequests).toHaveLength(2)
    expect(result.finalStatus).toBe('completed')
  })

  // =====================================================================
  // Test 4: Single tool with terminate=true → stop loop, no second LLM call
  // =====================================================================

  it('should stop the loop when a single external tool returns terminate=true', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-solo', type: 'function', function: { name: 'solo-tool', arguments: '{}' } },
    ]

    // Single tool with terminate=true
    fakeDispatcher.toolResults.set('call-solo', { success: true, data: { terminate: true, result: 'done' } })

    // Only one LLM response
    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls)])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('solo-tool') }))

    // RED FAIL: loop currently continues regardless of terminate
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)
    expect(adapter.capturedRequests).toHaveLength(1)
    expect(result.finalStatus).toBe('completed')
  })
})
