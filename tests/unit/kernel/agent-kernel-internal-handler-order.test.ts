import { describe, it, expect, beforeEach } from 'vitest'
import type {
  KernelRunInput,
  KernelRunResult,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  InternalToolHandler,
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

/**
 * Batch-aware FakeDispatcher (same as batch-dispatch test).
 * Returns results as ToolExecutionResult[] when toolUses.length > 1,
 * so dispatchExternalBatch can map by toolCallId positionally.
 */
class FakeBatchDispatcher {
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

    const ta = request.action?.targetAction as
      | { toolDispatchRequest?: { toolUses?: Array<{ toolCallId: string }> } }
      | undefined
    const toolUses = ta?.toolDispatchRequest?.toolUses ?? []

    // Build per-tool results from toolUses
    const results: Array<{ success: boolean; data?: unknown; error?: { code: string; message: string; recoverable: boolean } }> = []
    for (const tu of toolUses) {
      results.push({ success: true, data: { toolCallId: tu.toolCallId, result: `result-${tu.toolCallId}` } })
    }

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

describe('Internal handler ordering (flush-buffer before internal; stop short-circuits)', () => {
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
  // Test 1: Internal stop prevents later external
  //
  // assistant emits [internal_stop_tool, external_tool]
  // → internal runs, stop=true → external NEVER dispatched
  // → run completed with structuredResult from internal handler
  // =====================================================================

  it('should stop before external tool when internal handler sets stop=true', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-stop-internal', type: 'function', function: { name: 'stop-handler', arguments: '{}' } },
      { id: 'call-external-after', type: 'function', function: { name: 'external-after', arguments: '{}' } },
    ]

    const stopHandler: InternalToolHandler = async (req) => ({
      toolResult: {
        toolCallId: req.toolCallId,
        result: { internal: true },
      },
      stop: true,
      structuredResult: { action: 'redirect', target: '/done' },
    })

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Should not reach.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('external-after'),
        internalToolHandlers: { 'stop-handler': stopHandler },
      }),
    )

    // (a) dispatcher was NEVER called — external tool was never processed
    expect(fakeDispatcher.dispatchCalls).toHaveLength(0)

    // (b) structuredResult from internal handler is present
    expect(result.structuredResult).toEqual({ action: 'redirect', target: '/done' })

    // (c) finalStatus is completed
    expect(result.finalStatus).toBe('completed')

    // (d) finalResponse should be absent (we stopped before generating text)
    expect(result.finalResponse).toBeUndefined()

    // (e) Two tool_results: real result for internal_stop + synthetic MISSING_TOOL_RESULT
    //     for external_tool from pairing guard flush (ensures no dangling tool_calls).
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    const internalResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-stop-internal',
    )!.content as { toolCallId: string; result: { internal: boolean } }
    expect(internalResult.toolCallId).toBe('call-stop-internal')
    expect(internalResult.result).toEqual({ internal: true })

    const externalResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-external-after',
    )!.content as { toolCallId: string; error?: { code: string; recoverable: boolean }; result: null }
    expect(externalResult.error!.code).toBe('MISSING_TOOL_RESULT')
    expect(externalResult.error!.recoverable).toBe(true)
    expect(externalResult.result).toBeNull()

    // (f) Only one tool_call entry (internal_stop_tool only; external was never
    //     reached in the for-loop because we returned on internal handler stop).
    //     The pairing guard still produces a synthetic tool_result for the untracked
    //     external tool, but no tool_call entry exists for it in transcript.
    const toolCallEntries = result.transcript.filter((e) => e.type === 'tool_call')
    expect(toolCallEntries).toHaveLength(1)
    const firstCall = toolCallEntries[0].content as { toolCallId: string }
    expect(firstCall.toolCallId).toBe('call-stop-internal')

    // (g) Pairing guard shows an orphan_result warning for the external tool
    //     (its synthetic MISSING_TOOL_RESULT has no matching tool_call entry
    //      because the for-loop returned before committing one).
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(false)
    expect(pairingResult.warnings).toHaveLength(1)
    expect(pairingResult.warnings[0].type).toBe('orphan_result')
    expect(pairingResult.warnings[0].toolCallId).toBe('call-external-after')
  })

  // =====================================================================
  // Test 2: External before internal
  //
  // [external_tool, internal_stop]
  // → external dispatched (batch flushed before internal)
  // → internal runs, stop → run completed
  // → External result in transcript
  // =====================================================================

  it('should flush external batch before running internal handler that stops', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-ext-first', type: 'function', function: { name: 'external-first', arguments: '{}' } },
      { id: 'call-stop-second', type: 'function', function: { name: 'stop-handler', arguments: '{}' } },
    ]

    const stopHandler: InternalToolHandler = async (req) => ({
      toolResult: {
        toolCallId: req.toolCallId,
        result: { stopped: true },
      },
      stop: true,
      structuredResult: { finalized: true },
    })

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Should not reach.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('external-first'),
        internalToolHandlers: { 'stop-handler': stopHandler },
      }),
    )

    // (a) dispatcher was called exactly once (external-first dispatched as batch before internal)
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)

    // (b) structuredResult present
    expect(result.structuredResult).toEqual({ finalized: true })

    // (c) finalStatus completed
    expect(result.finalStatus).toBe('completed')

    // (d) Both tool_results in transcript (external + internal)
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    const extResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-ext-first',
    )!.content as { result: { toolCallId: string } }
    expect(extResult.result).toBeDefined()

    const stopResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-stop-second',
    )!.content as { result: { stopped: boolean } }
    expect(stopResult.result).toEqual({ stopped: true })

    // (e) Both tool_call entries present
    const toolCallEntries = result.transcript.filter((e) => e.type === 'tool_call')
    expect(toolCallEntries).toHaveLength(2)

    // (f) Pairing is valid
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)
  })

  // =====================================================================
  // Test 3: External between internals
  //
  // [external_a, internal_nonstop, external_b]
  // → external_a batched and flushed before internal
  // → internal runs (no stop)
  // → external_b batched and flushed at end
  // → All three results in transcript, paired
  // =====================================================================

  it('should buffer external tools before and after a non-stopping internal handler', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-ext-a', type: 'function', function: { name: 'ext-a', arguments: '{}' } },
      { id: 'call-internal', type: 'function', function: { name: 'no-stop-handler', arguments: '{}' } },
      { id: 'call-ext-b', type: 'function', function: { name: 'ext-b', arguments: '{}' } },
    ]

    const noStopHandler: InternalToolHandler = async (req) => ({
      toolResult: {
        toolCallId: req.toolCallId,
        result: { passthrough: true },
      },
      stop: false,
    })

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('All done.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('ext-a', 'ext-b'),
        internalToolHandlers: { 'no-stop-handler': noStopHandler },
      }),
    )

    // (a) dispatcher called TWICE: once for ext-a (before internal), once for ext-b (at end)
    expect(fakeDispatcher.dispatchCalls).toHaveLength(2)

    // (b) All three tool_results in transcript
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(3)

    // ext-a result present
    const extAResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-ext-a',
    )!.content as { result: { toolCallId: string } }
    expect(extAResult.result).toBeDefined()

    // internal result present
    const internalResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-internal',
    )!.content as { result: { passthrough: boolean } }
    expect(internalResult.result).toEqual({ passthrough: true })

    // ext-b result present
    const extBResult = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-ext-b',
    )!.content as { result: { toolCallId: string } }
    expect(extBResult.result).toBeDefined()

    // (c) All three tool_call entries present
    const toolCallEntries = result.transcript.filter((e) => e.type === 'tool_call')
    expect(toolCallEntries).toHaveLength(3)

    // (d) finalStatus completed
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('All done.')

    // (e) Pairing valid
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)
  })

  // =====================================================================
  // Test 4: Internal error does not crash
  //
  // internal handler throws → INTERNAL_HANDLER_ERROR result
  // → pairing valid, loop continues to next tool
  // =====================================================================

  it('should produce INTERNAL_HANDLER_ERROR when internal handler throws, then continue', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-crash', type: 'function', function: { name: 'crash-handler', arguments: '{}' } },
      { id: 'call-normal', type: 'function', function: { name: 'normal-tool', arguments: '{}' } },
    ]

    const crashHandler: InternalToolHandler = async (_req) => {
      throw new Error('Something went wrong in handler')
    }

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Recovered.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        toolProjection: toolProjectionFor('normal-tool'),
        internalToolHandlers: { 'crash-handler': crashHandler },
      }),
    )

    // (a) No crash — kernel recovered gracefully

    // (b) Both tool_results in transcript
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    // (c) crashed tool gets INTERNAL_HANDLER_ERROR
    const crashEntry = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-crash',
    )!.content as { error: { code: string; message: string; recoverable: boolean }; result: null }
    expect(crashEntry.error!.code).toBe('INTERNAL_HANDLER_ERROR')
    expect(crashEntry.error!.message).toContain('Something went wrong in handler')
    expect(crashEntry.error!.recoverable).toBe(true)
    expect(crashEntry.result).toBeNull()

    // (d) normal tool executed normally (dispatched)
    expect(fakeDispatcher.dispatchCalls).toHaveLength(1)
    const normalEntry = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-normal',
    )!.content as { result: { toolCallId: string } }
    expect(normalEntry.result).toBeDefined()

    // (e) finalStatus completed
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Recovered.')

    // (f) Pairing valid
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)
  })

  // =====================================================================
  // Test 5: Multiple internals in sequence
  //
  // [internal_a, internal_b] both run in order, no externals, both paired
  // =====================================================================

  it('should run multiple internal handlers in order without any dispatch', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-internal-a', type: 'function', function: { name: 'handler-a', arguments: '{}' } },
      { id: 'call-internal-b', type: 'function', function: { name: 'handler-b', arguments: '{}' } },
    ]

    const executionOrder: string[] = []

    const handlerA: InternalToolHandler = async (req) => {
      executionOrder.push('handler-a')
      return {
        toolResult: {
          toolCallId: req.toolCallId,
          result: { from: 'a' },
        },
      }
    }

    const handlerB: InternalToolHandler = async (req) => {
      executionOrder.push('handler-b')
      return {
        toolResult: {
          toolCallId: req.toolCallId,
          result: { from: 'b' },
        },
      }
    }

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Internals done.')])
    const kernel = new AgentKernel(createConfig(adapter))
    const result: KernelRunResult = await kernel.run(
      createInput({
        internalToolHandlers: { 'handler-a': handlerA, 'handler-b': handlerB },
      }),
    )

    // (a) No dispatch calls
    expect(fakeDispatcher.dispatchCalls).toHaveLength(0)

    // (b) Executed in order
    expect(executionOrder).toEqual(['handler-a', 'handler-b'])

    // (c) Both tool_results in transcript
    const toolResultEntries = result.transcript.filter((e) => e.type === 'tool_result')
    expect(toolResultEntries).toHaveLength(2)

    const resultA = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-internal-a',
    )!.content as { result: { from: string } }
    expect(resultA.result).toEqual({ from: 'a' })

    const resultB = toolResultEntries.find(
      (e) => (e.content as { toolCallId: string }).toolCallId === 'call-internal-b',
    )!.content as { result: { from: string } }
    expect(resultB.result).toEqual({ from: 'b' })

    // (d) finalStatus completed
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Internals done.')

    // (e) Pairing valid
    const { validateToolResultPairing } = await import('../../../src/kernel/tool-result-pairing-guard.js')
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)
  })
})
