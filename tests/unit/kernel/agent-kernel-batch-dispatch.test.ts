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
// Test fakes (mirror truncation-guard test pattern)
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
 * Returns results as ToolExecutionResult[] when toolUses.length > 1,
 * so dispatchExternalBatch can map by toolCallId positionally.
 * Tracks all dispatch calls for assertion.
 */
class FakeBatchDispatcher {
  dispatchCalls: DispatchRequest[] = []
  /** Per-toolCallId result overrides for testing distinct/reversed outputs */
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

    // Return array for multi-tool, single for single-tool (dispatchTool expects single)
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

describe('Batch dispatch (external tools flushed as one batch)', () => {
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
  // Test 1: Two external tools → ONE dispatch call (fail in RED because
  // serial dispatch makes 2 calls)
  // =====================================================================

  it('should dispatch two external tools as a single batch (RED: fails on serial dispatch count)', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-a', type: 'function', function: { name: 'tool-a', arguments: '{}' } },
      { id: 'call-b', type: 'function', function: { name: 'tool-b', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Batch done.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('tool-a', 'tool-b') }),
    )

    // RED FAIL: serial dispatches 2 times — this asserts 1 (batch)
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)
    expect(result.finalStatus).toBe('completed')
  })

  // =====================================================================
  // Test 2: Distinct outputs per toolCallId
  // =====================================================================

  it('should produce distinct tool results per toolCallId', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-alpha', type: 'function', function: { name: 'tool-alpha', arguments: '{}' } },
      { id: 'call-beta', type: 'function', function: { name: 'tool-beta', arguments: '{}' } },
    ]

    // Register distinct results per toolCallId
    fakeDispatcher.toolResults.set('call-alpha', { success: true, data: { result: 'alpha-output' } })
    fakeDispatcher.toolResults.set('call-beta', { success: true, data: { result: 'beta-output' } })

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Both distinct.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('tool-alpha', 'tool-beta') }),
    )

    expect(result.finalStatus).toBe('completed')

    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    const alphaEntry = toolResultEntries.find((e) => (e.content as { toolCallId: string }).toolCallId === 'call-alpha')!
      .content as { result: unknown }
    expect(alphaEntry.result).toEqual({ result: 'alpha-output' })

    const betaEntry = toolResultEntries.find((e) => (e.content as { toolCallId: string }).toolCallId === 'call-beta')!
      .content as { result: unknown }
    expect(betaEntry.result).toEqual({ result: 'beta-output' })
  })

  // =====================================================================
  // Test 3: Reverse order results still map by toolCallId
  // =====================================================================

  it('should map results by toolCallId even when dispatch returns in reverse order', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-first', type: 'function', function: { name: 'tool-first', arguments: '{}' } },
      { id: 'call-second', type: 'function', function: { name: 'tool-second', arguments: '{}' } },
    ]

    // We rely on the default behavior: fakeDispatcher builds per-tool results
    // using toolCallId from toolUses so mapping is always correct.
    // To simulate reverse-order: register results where call-first gets wrong data
    // if mapped by position but correct data if mapped by toolCallId.
    // The batch dispatcher maps by toolCallId (NOT position), so even if the
    // results array has [second-data, first-data], each tool gets its own data.
    const origDispatch = fakeDispatcher.dispatch.bind(fakeDispatcher)
    fakeDispatcher.dispatch = async (req) => {
      const result = await origDispatch(req)
      // For multi-tool, swap the order in the result array to simulate reverse
      const targetAction = req.action?.targetAction as
        | { toolDispatchRequest?: { toolUses?: Array<{ toolCallId: string }> } }
        | undefined
      const tu = targetAction?.toolDispatchRequest?.toolUses
      if (tu && tu.length > 1 && Array.isArray(result.result)) {
        result.result = [result.result[1], result.result[0]]
      }
      return result
    }

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Reversed mapped.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('tool-first', 'tool-second') }),
    )

    expect(result.finalStatus).toBe('completed')

    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    // Each tool must have its own correct result despite the reverse-order array
    // call-first maps to toolCallId='call-first' → data.toolCallId === 'call-first'
    // call-second maps to toolCallId='call-second' → data.toolCallId === 'call-second'
    const firstEntry = toolResultEntries.find((e) => (e.content as { toolCallId: string }).toolCallId === 'call-first')!
      .content as { result: { toolCallId: string } }
    expect(firstEntry.result.toolCallId).toBe('call-first')

    const secondEntry = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-second',
    )!.content as { result: { toolCallId: string } }
    expect(secondEntry.result.toolCallId).toBe('call-second')
  })

  // =====================================================================
  // Test 4: One unprojected + one projected → mixed results
  // =====================================================================

  it('should pair unprojected error with projected batch result', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-valid', type: 'function', function: { name: 'projected-tool', arguments: '{}' } },
      { id: 'call-sneaky', type: 'function', function: { name: 'unprojected-tool', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Mixed.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('projected-tool') }),
    )

    expect(result.finalStatus).toBe('completed')

    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    // Projected tool dispatched in batch -> 1 dispatch call
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)

    // Valid tool gets a real result
    const validEntry = toolResultEntries.find((e) => (e.content as { toolCallId: string }).toolCallId === 'call-valid')!
      .content as { result: unknown; error?: undefined }
    expect(validEntry.result).toBeDefined()
    expect(validEntry.error).toBeUndefined()

    // Unprojected tool gets synthetic UNPROJECTED_TOOL_CALL error
    const sneakyEntry = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-sneaky',
    )!.content as { result: null; error: { code: string; recoverable: boolean } }
    expect(sneakyEntry.result).toBeNull()
    expect(sneakyEntry.error!.code).toBe('UNPROJECTED_TOOL_CALL')
    expect(sneakyEntry.error!.recoverable).toBe(false)
  })

  // =====================================================================
  // Test 5: validateToolResultPairing passes
  // =====================================================================

  it('should maintain valid tool-result pairing after batch dispatch', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-pair-a', type: 'function', function: { name: 'tool-pair', arguments: '{}' } },
      { id: 'call-pair-b', type: 'function', function: { name: 'tool-pair', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Pair ok.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('tool-pair') }))

    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)

    expect(result.finalStatus).toBe('completed')
  })

  // =====================================================================
  // Test 6: Single external tool works (batch of 1)
  // =====================================================================

  it('should dispatch a single external tool as a batch of 1', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-solo', type: 'function', function: { name: 'solo-tool', arguments: '{}' } },
    ]

    fakeDispatcher.toolResults.set('call-solo', { success: true, data: { solo: true } })

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Solo done.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(createInput({ toolProjection: toolProjectionFor('solo-tool') }))

    // Single dispatch call (batch of 1)
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)
    expect(result.finalStatus).toBe('completed')

    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(1)

    const soloEntry = toolResultEntries[0].content as { result: { solo: boolean }; error?: undefined }
    expect(soloEntry.result).toEqual({ solo: true })
    expect(soloEntry.error).toBeUndefined()
  })
})
