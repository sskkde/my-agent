import { describe, it, expect, beforeEach } from 'vitest'
import type {
  KernelRunInput,
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
} from '../../../src/kernel/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMResult, LLMRequest, ToolCall, LLMResponse } from '../../../src/llm/types.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { ContextItem, ContextBundle } from '../../../src/context/types.js'
import type { DispatchRequest } from '../../../src/dispatcher/types.js'
import type { ToolPlaneProjection } from '../../../src/kernel/model-input/model-input-types.js'
import type { ConsoleTimelineEvent, TokenStreamPayload } from '../../../src/api/types.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'
import { validateToolResultPairing } from '../../../src/kernel/tool-result-pairing-guard.js'

// ---------------------------------------------------------------------------
// Fakes
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

class FakeTimelineBroadcaster {
  timelineEvents: ConsoleTimelineEvent[] = []

  broadcastTokenStream(_sessionId: string, _token: TokenStreamPayload): void {}

  broadcast(_sessionId: string, event: ConsoleTimelineEvent): void {
    this.timelineEvents.push(event)
  }
}

class FakeToolExecutor implements ToolExecutor {
  async execute() {
    return { success: true, data: { result: 'ok' } }
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
 * Returns results as array of per-tool results when toolUses.length > 1.
 * Tracks all dispatch calls for assertion.
 */
class FakeBatchDispatcher {
  dispatchCalls: DispatchRequest[] = []
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

function toolProjectionFor(...toolNames: string[]): ToolPlaneProjection {
  const tools = toolNames.map((name) => ({
    type: 'function' as const,
    function: { name, description: 'Test tool: ' + name, parameters: { type: 'object' as const, properties: {} } },
  }))
  return { toolIds: toolNames, tools }
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

describe('Batch dispatch — timeline broadcast and pairing', () => {
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

  function createConfig(
    llmAdapter: FakeLLMAdapter,
    dispatcher?: FakeBatchDispatcher,
    broadcaster?: FakeTimelineBroadcaster,
    maxIterations = 10,
  ): KernelConfig {
    return {
      llmAdapter,
      toolExecutor: new FakeToolExecutor() as unknown as ToolExecutor,
      contextManager: fakeContextManager as unknown as ContextManager,
      dispatcher: (dispatcher ?? fakeDispatcher) as unknown as RuntimeDispatcher,
      modelInputBuilder,
      timelineBroadcaster: broadcaster,
      maxIterations,
      timeoutMs: 60000,
      // Non-streaming provider family prevents the streaming path from emitting
      // early tool_call events, giving us clean event counts for assertions.
      providerFamily: 'test-non-streaming',
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

  // =====================================================================
  // Test 1: N tools → N running events + N terminal events
  // =====================================================================

  it('fires N broadcastToolCallRunning and N broadcastToolResultTerminal events for batch of N', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-a', type: 'function', function: { name: 'tool-a', arguments: '{}' } },
      { id: 'call-b', type: 'function', function: { name: 'tool-b', arguments: '{}' } },
      { id: 'call-c', type: 'function', function: { name: 'tool-c', arguments: '{}' } },
    ]

    const broadcaster = new FakeTimelineBroadcaster()
    fakeDispatcher.toolResults.set('call-a', { success: true, data: { result: 'a' } })
    fakeDispatcher.toolResults.set('call-b', { success: true, data: { result: 'b' } })
    fakeDispatcher.toolResults.set('call-c', { success: true, data: { result: 'c' } })

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Batch done.')])

    const kernel = new AgentKernel(createConfig(adapter, fakeDispatcher, broadcaster))
    const result = await kernel.run(createInput({ toolProjection: toolProjectionFor('tool-a', 'tool-b', 'tool-c') }))

    expect(result.finalStatus).toBe('completed')

    const runningEvents = broadcaster.timelineEvents.filter((e) => e.eventType === 'tool_call')
    const terminalEvents = broadcaster.timelineEvents.filter((e) => e.eventType === 'tool_result')

    // 3 distinct running events
    expect(runningEvents).toHaveLength(3)
    const runningIds = runningEvents.map((e) => e.metadata?.toolCallId)
    expect(runningIds).toContain('call-a')
    expect(runningIds).toContain('call-b')
    expect(runningIds).toContain('call-c')
    // All distinct
    expect(new Set(runningIds).size).toBe(3)

    // 3 distinct terminal events
    expect(terminalEvents).toHaveLength(3)
    const terminalIds = terminalEvents.map((e) => e.metadata?.toolCallId)
    expect(terminalIds).toContain('call-a')
    expect(terminalIds).toContain('call-b')
    expect(terminalIds).toContain('call-c')
    expect(new Set(terminalIds).size).toBe(3)

    // All running events fire BEFORE any terminal event (batch is buffered, then dispatched)
    const allEventTypes = broadcaster.timelineEvents.map((e) => e.eventType)
    const lastRunning = allEventTypes.lastIndexOf('tool_call')
    const firstTerminal = allEventTypes.indexOf('tool_result')
    expect(lastRunning).toBeLessThan(firstTerminal)

    // Each toolCallId appears in both running and terminal
    for (const id of ['call-a', 'call-b', 'call-c']) {
      expect(runningIds).toContain(id)
      expect(terminalIds).toContain(id)
    }
  })

  // =====================================================================
  // Test 2: Pairing validation after batch dispatch
  // =====================================================================

  it('passes validateToolResultPairing after batch of 3 external tools', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-p1', type: 'function', function: { name: 'tool-pair', arguments: '{}' } },
      { id: 'call-p2', type: 'function', function: { name: 'tool-pair', arguments: '{}' } },
      { id: 'call-p3', type: 'function', function: { name: 'tool-pair', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Pair OK.')])

    const kernel = new AgentKernel(createConfig(adapter))
    const result = await kernel.run(createInput({ toolProjection: toolProjectionFor('tool-pair') }))

    expect(result.finalStatus).toBe('completed')

    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)
    expect(pairingResult.warnings).toHaveLength(0)
  })

  // =====================================================================
  // Test 3: Transcript order preserves assistant tool call order
  // =====================================================================

  it('preserves assistant tool call order in transcript despite reversed dispatch results', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-first', type: 'function', function: { name: 'tool-first', arguments: '{}' } },
      { id: 'call-second', type: 'function', function: { name: 'tool-second', arguments: '{}' } },
      { id: 'call-third', type: 'function', function: { name: 'tool-third', arguments: '{}' } },
    ]

    // Include toolCallId in data so dispatchExternalBatch can map results
    // by toolCallId rather than falling back to positional (since we reverse).
    fakeDispatcher.toolResults.set('call-first', {
      success: true,
      data: { toolCallId: 'call-first', result: 'first-output' },
    })
    fakeDispatcher.toolResults.set('call-second', {
      success: true,
      data: { toolCallId: 'call-second', result: 'second-output' },
    })
    fakeDispatcher.toolResults.set('call-third', {
      success: true,
      data: { toolCallId: 'call-third', result: 'third-output' },
    })

    // Swap results array to simulate out-of-order dispatch return
    const origDispatch = fakeDispatcher.dispatch.bind(fakeDispatcher)
    fakeDispatcher.dispatch = async (req) => {
      const result = await origDispatch(req)
      const ta = req.action?.targetAction as
        | { toolDispatchRequest?: { toolUses?: Array<{ toolCallId: string }> } }
        | undefined
      const tu = ta?.toolDispatchRequest?.toolUses
      if (tu && tu.length > 1 && Array.isArray(result.result)) {
        // Reverse the results array to simulate out-of-order return
        result.result = [result.result[2], result.result[1], result.result[0]]
      }
      return result
    }

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Order preserved.')])

    const kernel = new AgentKernel(createConfig(adapter, fakeDispatcher))
    const result = await kernel.run(
      createInput({ toolProjection: toolProjectionFor('tool-first', 'tool-second', 'tool-third') }),
    )

    expect(result.finalStatus).toBe('completed')

    // Transcript tool_call entries in original assistant order
    const transcriptToolCalls = result.transcript.filter((e) => e.type === 'tool_call')
    expect(transcriptToolCalls).toHaveLength(3)
    const callIds = transcriptToolCalls.map((e) => (e.content as { toolCallId: string }).toolCallId)
    expect(callIds).toEqual(['call-first', 'call-second', 'call-third'])

    // Transcript tool_result entries in same order (dispatchExternalBatch iterates batch in order)
    const transcriptResults = result.transcript.filter((e) => e.type === 'tool_result')
    expect(transcriptResults).toHaveLength(3)
    const resultIds = transcriptResults.map((e) => (e.content as { toolCallId: string }).toolCallId)
    expect(resultIds).toEqual(['call-first', 'call-second', 'call-third'])

    // Each result carries the correct data despite reversed dispatch return order
    const firstResult = transcriptResults[0].content as { result: { toolCallId: string; result: string } }
    expect(firstResult.result).toMatchObject({ result: 'first-output' })

    const secondResult = transcriptResults[1].content as { result: { toolCallId: string; result: string } }
    expect(secondResult.result).toMatchObject({ result: 'second-output' })

    const thirdResult = transcriptResults[2].content as { result: { toolCallId: string; result: string } }
    expect(thirdResult.result).toMatchObject({ result: 'third-output' })
  })

  // =====================================================================
  // Test 4: flushPairingGuard leaves no pending calls after batch path
  // =====================================================================

  it('leaves no pending calls after batch flush and iteration_end', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-g1', type: 'function', function: { name: 'tool-g', arguments: '{}' } },
      { id: 'call-g2', type: 'function', function: { name: 'tool-g', arguments: '{}' } },
      { id: 'call-g3', type: 'function', function: { name: 'tool-g', arguments: '{}' } },
    ]

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Flushed.')])

    const kernel = new AgentKernel(createConfig(adapter))
    const result = await kernel.run(createInput({ toolProjection: toolProjectionFor('tool-g') }))

    expect(result.finalStatus).toBe('completed')

    // Equal count of tool_call and tool_result entries → all paired, no pending
    const toolCallCount = result.transcript.filter((e) => e.type === 'tool_call').length
    const toolResultCount = result.transcript.filter((e) => e.type === 'tool_result').length
    expect(toolCallCount).toBe(toolResultCount)

    // validateToolResultPairing also confirms no missing results or orphans
    const pairingResult = validateToolResultPairing(result.transcript)
    expect(pairingResult.valid).toBe(true)
  })

  // =====================================================================
  // Test 5: Early tool live map — Scheme-1 contract metadata
  // =====================================================================

  it('includes toolCallIndex in broadcast events for Scheme-1 early event upsert', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-early-1', type: 'function', function: { name: 'tool-early', arguments: '{}' } },
      { id: 'call-early-2', type: 'function', function: { name: 'tool-early', arguments: '{}' } },
    ]

    const broadcaster = new FakeTimelineBroadcaster()
    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Early done.')])

    const kernel = new AgentKernel(createConfig(adapter, fakeDispatcher, broadcaster))
    const result = await kernel.run(createInput({ toolProjection: toolProjectionFor('tool-early') }))

    expect(result.finalStatus).toBe('completed')

    const runningEvents = broadcaster.timelineEvents.filter((e) => e.eventType === 'tool_call')
    expect(runningEvents).toHaveLength(2)

    // Each broadcastToolCallRunning event carries toolCallIndex for Scheme-1 upsert
    for (const event of runningEvents) {
      expect(event.metadata).toBeDefined()
      expect(event.metadata!.toolCallIndex).toBeDefined()
      expect(typeof event.metadata!.toolCallIndex).toBe('number')
      expect(event.metadata!.toolCallId).toBeDefined()
      expect(event.metadata!.status).toBe('running')
    }

    // toolCallIndexes are 0 and 1 (assistant order)
    const indices = runningEvents.map((e) => e.metadata!.toolCallIndex as number).sort()
    expect(indices).toEqual([0, 1])

    // Each event has a formal eventId (no early provisional → uses buildToolCallEventId)
    for (const event of runningEvents) {
      expect(event.eventId).toBeDefined()
      expect(typeof event.eventId).toBe('string')
      expect(event.eventId).toContain(event.metadata!.turnId ?? 'test-run-id')
    }
  })

  // =====================================================================
  // Test 6: Mixed — one dispatch error in batch still produces correct broadcast
  // =====================================================================

  it('handles dispatch error broadcast for all tools in batch', async () => {
    const toolCalls: ToolCall[] = [
      { id: 'call-x', type: 'function', function: { name: 'tool-x', arguments: '{}' } },
      { id: 'call-y', type: 'function', function: { name: 'tool-y', arguments: '{}' } },
    ]

    const broadcaster = new FakeTimelineBroadcaster()

    // Make dispatch throw to test error broadcast path
    fakeDispatcher.dispatch = async () => {
      throw new Error('Network failure')
    }

    const adapter = new FakeLLMAdapter([createToolUseResponse(toolCalls), createTextResponse('Error handled.')])

    const kernel = new AgentKernel(createConfig(adapter, fakeDispatcher, broadcaster))
    const result = await kernel.run(createInput({ toolProjection: toolProjectionFor('tool-x', 'tool-y') }))

    expect(result.finalStatus).toBe('completed')

    // Running events still fire BEFORE dispatch (in the for loop)
    const runningEvents = broadcaster.timelineEvents.filter((e) => e.eventType === 'tool_call')
    expect(runningEvents).toHaveLength(2)

    // Terminal events fire after dispatch throws (in the catch block)
    const terminalEvents = broadcaster.timelineEvents.filter((e) => e.eventType === 'tool_result')
    expect(terminalEvents).toHaveLength(2)

    const terminalIds = terminalEvents.map((e) => e.metadata?.toolCallId)
    expect(terminalIds).toContain('call-x')
    expect(terminalIds).toContain('call-y')

    // All DISPATCH_ERROR results are recoverable
    for (const event of terminalEvents) {
      expect(event.metadata?.status).toBe('failed')
    }
  })
})
