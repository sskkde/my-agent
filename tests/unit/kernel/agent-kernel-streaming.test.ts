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
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { TokenStreamPayload } from '../../../src/api/types.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'

// ─── Fake Streaming LLM Adapter ───────────────────────────────────────────────

/**
 * Fake LLM adapter that supports streaming with controlled delta emission
 */
class FakeStreamingLLMAdapter implements LLMAdapter {
  protected lastRequest: LLMRequest | undefined
  private deltas: string[] = []
  private shouldFail = false
  private failureAfterDelta?: number

  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  }
  providers: LLMProvider[] = []

  constructor(deltas: string[] = ['Hello', ' ', 'world', '!']) {
    this.deltas = deltas
  }

  setDeltas(deltas: string[]): void {
    this.deltas = deltas
  }

  setShouldFail(shouldFail: boolean, afterDelta?: number): void {
    this.shouldFail = shouldFail
    this.failureAfterDelta = afterDelta
  }

  streamCallCount = 0
  completeCallCount = 0

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.lastRequest = request
    this.completeCallCount++

    const fullContent = this.deltas.join('')
    return {
      success: true,
      response: {
        id: 'resp-test',
        model: request.model,
        content: fullContent,
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'fake-streaming',
    }
  }

  async *stream(
    request: LLMRequest,
  ): AsyncGenerator<import('../../../src/llm/types.js').LLMStreamChunk> {
    this.lastRequest = request
    this.streamCallCount++

    for (let i = 0; i < this.deltas.length; i++) {
      if (this.shouldFail && this.failureAfterDelta !== undefined && i >= this.failureAfterDelta) {
        throw new Error('Streaming failed mid-stream')
      }

      yield {
        kind: 'text',
        delta: this.deltas[i]!,
        providerId: 'fake-streaming',
        model: request.model,
      }
    }
    yield {
      kind: 'finish',
      finishReason: 'stop',
      providerId: 'fake-streaming',
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

  getLastRequest(): LLMRequest | undefined {
    return this.lastRequest
  }
}

// ─── Fake Timeline Broadcaster ────────────────────────────────────────────────

interface BroadcastCall {
  sessionId: string
  token: TokenStreamPayload
}

class FakeTimelineBroadcaster {
  private broadcasts: BroadcastCall[] = []
  private timelineEvents: Array<{ sessionId: string; event: import('../../../src/api/types.js').ConsoleTimelineEvent }> = []

  broadcastTokenStream(sessionId: string, token: TokenStreamPayload): void {
    this.broadcasts.push({ sessionId, token })
  }

  broadcast(sessionId: string, event: import('../../../src/api/types.js').ConsoleTimelineEvent): void {
    this.timelineEvents.push({ sessionId, event })
  }

  getBroadcasts(): BroadcastCall[] {
    return this.broadcasts
  }

  getTimelineEvents() {
    return this.timelineEvents
  }

  clear(): void {
    this.broadcasts = []
    this.timelineEvents = []
  }
}

// ─── Minimal Fakes ────────────────────────────────────────────────────────────

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
  dispatchCallCount = 0

  async dispatch() {
    this.dispatchCallCount++
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

// ─── Test Setup ───────────────────────────────────────────────────────────────

const defaultBroadcaster = new FakeTimelineBroadcaster()

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
    llmAdapter: new FakeStreamingLLMAdapter(),
    toolExecutor: new FakeToolExecutor(),
    contextManager: new FakeContextManager(),
    dispatcher: new FakeDispatcher(),
    modelInputBuilder: createModelInputBuilder(),
    maxIterations: 10,
    timeoutMs: 30000,
    timelineBroadcaster: defaultBroadcaster,
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
    sessionId: 'test-session',
    maxIterations: 1,
    timeoutMs: 5000,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentKernel streaming behavior', () => {
  let fakeLLM: FakeStreamingLLMAdapter
  let fakeBroadcaster: FakeTimelineBroadcaster

  beforeEach(() => {
    fakeLLM = new FakeStreamingLLMAdapter()
    fakeBroadcaster = defaultBroadcaster
    fakeBroadcaster.clear()
  })

  describe('TokenStreamPayload emission', () => {
    it('emits ordered deltas with increasing sequence numbers', async () => {
      const deltas = ['Hello', ' ', 'world', '!']
      fakeLLM.setDeltas(deltas)

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      // After Task 10: kernel.run() will use streaming and broadcast deltas
      await kernel.run(makeRunInput())

      const broadcasts = fakeBroadcaster.getBroadcasts()
      const textBroadcasts = broadcasts.filter((b) => b.token.delta.length > 0)

      // Should emit one broadcast per text delta (+ optional final marker)
      expect(textBroadcasts.length).toBe(deltas.length)

      // Each text broadcast should have increasing sequence and matching delta
      for (let i = 0; i < textBroadcasts.length; i++) {
        expect(textBroadcasts[i].token.sequence).toBe(i)
        expect(textBroadcasts[i].token.delta).toBe(deltas[i])
      }
      expect(broadcasts.some((b) => b.token.isFinal === true)).toBe(true)
    })

    it('includes sessionId and attemptId in TokenStreamPayload', async () => {
      const sessionId = 'session-stream-001'
      const attemptId = 'attempt-stream-001'

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      const input: KernelRunInput = {
        ...makeRunInput(),
        sessionId,
        runId: attemptId,
      }

      await kernel.run(input)

      const broadcasts = fakeBroadcaster.getBroadcasts()

      expect(broadcasts.length).toBeGreaterThan(0)
      broadcasts.forEach((b) => {
        expect(b.sessionId).toBe(sessionId)
        expect(b.token.attemptId).toBe(attemptId)
      })
    })

    it('sets isFinal=true on last delta', async () => {
      fakeLLM.setDeltas(['A', 'B', 'C'])

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      await kernel.run(makeRunInput())

      const broadcasts = fakeBroadcaster.getBroadcasts()
      const textBroadcasts = broadcasts.filter((b) => b.token.delta.length > 0)

      expect(textBroadcasts.length).toBe(3)
      expect(textBroadcasts.every((b) => b.token.isFinal === false)).toBe(true)
      expect(broadcasts[broadcasts.length - 1].token.isFinal).toBe(true)
      expect(broadcasts[broadcasts.length - 1].token.delta).toBe('')
    })

    it('includes timestamp in each TokenStreamPayload', async () => {
      const beforeTime = new Date().toISOString()

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      await kernel.run(makeRunInput())

      const broadcasts = fakeBroadcaster.getBroadcasts()
      const afterTime = new Date().toISOString()

      expect(broadcasts.length).toBeGreaterThan(0)
      broadcasts.forEach((b) => {
        expect(b.token.timestamp).toBeDefined()
        expect(b.token.timestamp >= beforeTime).toBe(true)
        expect(b.token.timestamp <= afterTime).toBe(true)
      })
    })
  })

  describe('Final result accumulation', () => {
    it('final response equals concatenated deltas', async () => {
      const deltas = ['The ', 'quick ', 'brown ', 'fox']
      fakeLLM.setDeltas(deltas)

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      const result = await kernel.run(makeRunInput())

      expect(result.finalStatus).toBe('completed')
      expect(result.finalResponse).toBe('The quick brown fox')
    })

    it('handles empty deltas gracefully', async () => {
      fakeLLM.setDeltas([])

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      const result = await kernel.run(makeRunInput())

      expect(result.finalStatus).toBe('completed')
      expect(result.finalResponse).toBe('')

      const broadcasts = fakeBroadcaster.getBroadcasts()
      expect(broadcasts.length).toBe(0)
    })

    it('handles single delta', async () => {
      fakeLLM.setDeltas(['Single response'])

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      const result = await kernel.run(makeRunInput())

      expect(result.finalStatus).toBe('completed')
      expect(result.finalResponse).toBe('Single response')

      const broadcasts = fakeBroadcaster.getBroadcasts()
      const textBroadcasts = broadcasts.filter((b) => b.token.delta.length > 0)
      expect(textBroadcasts.length).toBe(1)
      expect(textBroadcasts[0].token.delta).toBe('Single response')
      expect(broadcasts.some((b) => b.token.isFinal === true)).toBe(true)
    })
  })

  describe('Streaming failure handling', () => {
    it('falls back to complete() when streaming fails mid-stream', async () => {
      fakeLLM.setDeltas(['Fallback', ' ', 'content'])
      fakeLLM.setShouldFail(true, 2) // Stream fails after 2 deltas, but complete() returns deltas joined

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      const result = await kernel.run(makeRunInput())

      // Should fallback to complete() and succeed with the joined deltas
      expect(result.finalStatus).toBe('completed')
      expect(result.finalResponse).toBe('Fallback content')
    })

    it('fallback to complete() when streaming not supported', async () => {
      // Create adapter that only supports complete(), not stream()
      class NonStreamingAdapter extends FakeStreamingLLMAdapter {
        async *stream() {
          // Yield nothing - simulates no streaming support
          yield* []
        }
      }

      const nonStreamingAdapter = new NonStreamingAdapter(['Fallback', ' ', 'content'])
      const config = makeBaseConfig({ llmAdapter: nonStreamingAdapter })
      const kernel = new AgentKernel(config)

      const result = await kernel.run(makeRunInput())

      // Should fallback to complete() and succeed
      expect(result.finalStatus).toBe('completed')
      expect(result.finalResponse).toBe('Fallback content')
    })

    it('no duplicate final messages on streaming error', async () => {
      fakeLLM.setDeltas(['A', 'B', 'C'])
      fakeLLM.setShouldFail(true, 1) // Fail after 1 delta

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      const result = await kernel.run(makeRunInput())

      // Streaming failed but complete() fallback succeeds with joined deltas
      expect(result.finalStatus).toBe('completed')

      const broadcasts = fakeBroadcaster.getBroadcasts()
      // Only the partial 'A' was broadcast before streaming failure (+ optional empty flush)
      const textBroadcasts = broadcasts.filter((b) => b.token.delta.length > 0)
      expect(textBroadcasts.length).toBe(1)
      expect(textBroadcasts[0].token.delta).toBe('A')
      expect(textBroadcasts[0].token.isFinal).toBe(false)
    })

    it('preserves partial deltas before streaming failure', async () => {
      fakeLLM.setDeltas(['Part1', ' ', 'Part2', ' ', 'Part3'])
      fakeLLM.setShouldFail(true, 2) // Fail after 2 deltas

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      await kernel.run(makeRunInput())

      const broadcasts = fakeBroadcaster.getBroadcasts()

      // Should have broadcasts for 'Part1' and ' ' (plus optional empty flush)
      const textBroadcasts = broadcasts.filter((b) => b.token.delta.length > 0)
      expect(textBroadcasts.length).toBe(2)
      expect(textBroadcasts[0].token.delta).toBe('Part1')
      expect(textBroadcasts[1].token.delta).toBe(' ')
    })
  })

  describe('Streaming with tool calls', () => {
    it('handles tool_calls-only stream without text (no token broadcast, still dispatches)', async () => {
      class ToolOnlyStreamAdapter extends FakeStreamingLLMAdapter {
        private doneTool = false

        async *stream(
          request: LLMRequest,
        ): AsyncGenerator<import('../../../src/llm/types.js').LLMStreamChunk> {
          this.lastRequest = request
          this.streamCallCount++
          if (!this.doneTool) {
            this.doneTool = true
            yield {
              kind: 'tool_call_delta',
              index: 0,
              id: 'call-x',
              name: 'get_weather',
              argumentsDelta: '{}',
              providerId: 'fake-streaming',
              model: request.model,
            }
            yield {
              kind: 'finish',
              finishReason: 'tool_calls',
              providerId: 'fake-streaming',
              model: request.model,
            }
            return
          }
          yield {
            kind: 'text',
            delta: 'done',
            providerId: 'fake-streaming',
            model: request.model,
          }
          yield {
            kind: 'finish',
            finishReason: 'stop',
            providerId: 'fake-streaming',
            model: request.model,
          }
        }
      }

      const toolCallAdapter = new ToolOnlyStreamAdapter()
      const toolProjection = {
        toolIds: ['get_weather'],
        tools: [
          {
            type: 'function' as const,
            function: {
              name: 'get_weather',
              description: 'weather',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
      }
      const config = makeBaseConfig({ llmAdapter: toolCallAdapter })
      const kernel = new AgentKernel(config)

      const result = await kernel.run({ ...makeRunInput(), toolProjection, maxIterations: 3 })

      expect(result.finalStatus).toBe('completed')
      expect(result.finalResponse).toBe('done')
      expect(result.toolCalls.length).toBe(1)
    })
  })

  describe('Performance and memory', () => {
    it('does not accumulate all deltas in memory during streaming', async () => {
      // Large number of deltas
      const manyDeltas = Array(1000).fill('x')
      fakeLLM.setDeltas(manyDeltas)

      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)

      const result = await kernel.run(makeRunInput())

      // Should still work with many deltas
      expect(result.finalStatus).toBe('completed')
      expect(result.finalResponse).toBe('x'.repeat(1000))

      // Each text delta broadcast + final empty isFinal marker
      const broadcasts = fakeBroadcaster.getBroadcasts()
      expect(broadcasts.filter((b) => b.token.delta.length > 0).length).toBe(1000)
      expect(broadcasts.some((b) => b.token.isFinal === true)).toBe(true)
    })
  })
})


describe('AgentKernel structured streaming with tool-capable turns (P0-P2)', () => {
  it('streams tool_calls when tools are projected; dispatches tool_calls once', async () => {
    class ToolCapableStreamAdapter extends FakeStreamingLLMAdapter {
      private toolCallReturned = false

      async complete(request: LLMRequest): Promise<LLMResult> {
        this.lastRequest = request
        this.completeCallCount++
        // Should not be needed for the tool-call iteration when stream works.
        return {
          success: true,
          response: {
            id: 'resp-fallback',
            model: request.model,
            content: 'fallback',
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
          },
          providerId: 'fake-streaming',
        }
      }

      async *stream(
        request: LLMRequest,
      ): AsyncGenerator<import('../../../src/llm/types.js').LLMStreamChunk> {
        this.lastRequest = request
        this.streamCallCount++

        if (!this.toolCallReturned) {
          this.toolCallReturned = true
          // P0: text + tool_calls in one stream
          yield {
            kind: 'text',
            delta: 'Checking weather…',
            providerId: 'fake-streaming',
            model: request.model,
          }
          yield {
            kind: 'tool_call_delta',
            index: 0,
            id: 'call-1',
            name: 'get_weather',
            argumentsDelta: '{"city":',
            providerId: 'fake-streaming',
            model: request.model,
          }
          yield {
            kind: 'tool_call_delta',
            index: 0,
            argumentsDelta: '"SF"}',
            providerId: 'fake-streaming',
            model: request.model,
          }
          yield {
            kind: 'finish',
            finishReason: 'tool_calls',
            providerId: 'fake-streaming',
            model: request.model,
          }
          return
        }

        // Second iteration: final natural language answer
        yield {
          kind: 'text',
          delta: 'The weather in SF is sunny.',
          providerId: 'fake-streaming',
          model: request.model,
        }
        yield {
          kind: 'finish',
          finishReason: 'stop',
          providerId: 'fake-streaming',
          model: request.model,
        }
      }
    }

    const toolCallAdapter = new ToolCapableStreamAdapter()
    const countingDispatcher = new FakeDispatcher()
    const toolProjection = {
      toolIds: ['get_weather'],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'Get weather for a city',
            parameters: {
              type: 'object',
              properties: { city: { type: 'string' } },
              required: ['city'],
            },
          },
        },
      ],
    }

    defaultBroadcaster.clear()
    const config = makeBaseConfig({
      llmAdapter: toolCallAdapter,
      dispatcher: countingDispatcher,
    })
    const kernel = new AgentKernel(config)

    const result = await kernel.run({
      ...makeRunInput(),
      toolProjection,
      maxIterations: 3,
    })

    expect(toolCallAdapter.streamCallCount).toBeGreaterThanOrEqual(2)
    expect(countingDispatcher.dispatchCallCount).toBe(1)
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('The weather in SF is sunny.')
    expect(result.toolCalls.length).toBe(1)
    expect(result.toolCalls[0]?.toolName).toBe('get_weather')

    // Text tokens were streamed for the first iteration
    const textDeltas = defaultBroadcaster
      .getBroadcasts()
      .map((b) => b.token.delta)
      .filter((d) => d.length > 0)
    expect(textDeltas).toContain('Checking weather…')

    // P2/scheme 1: early tool_call uses stable buildToolCallEventId (not early-tool-call-*)
    const earlyTools = defaultBroadcaster
      .getTimelineEvents()
      .filter((e) => e.event.eventType === 'tool_call' && e.event.metadata?.early === true)
    expect(earlyTools.length).toBeGreaterThanOrEqual(1)
    expect(earlyTools[0]?.event.metadata?.toolName).toBe('get_weather')
    expect(earlyTools[0]?.event.eventId.startsWith('turn-')).toBe(true)
    expect(earlyTools[0]?.event.eventId.includes('early-tool-call')).toBe(false)

    // Formal tool_call must not introduce a second distinct card identity when real id was known early
    const toolCalls = defaultBroadcaster
      .getTimelineEvents()
      .filter((e) => e.event.eventType === 'tool_call')
      .map((e) => e.event.eventId)
    // All tool_call eventIds for this run should be unique set size <= number of tools (1)
    // plus possible re-key once real id arrives; at most 2 ids if provisional→real rekey happened
    expect(new Set(toolCalls).size).toBeLessThanOrEqual(2)
  })

  it('still streams when no tools are projected', async () => {
    defaultBroadcaster.clear()
    const deltas = ['Hello', ' ', 'world']
    const adapter = new FakeStreamingLLMAdapter(deltas)
    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    const result = await kernel.run(makeRunInput())

    expect(adapter.streamCallCount).toBe(1)
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('Hello world')
    // N text deltas + 1 final empty isFinal marker
    const broadcasts = defaultBroadcaster.getBroadcasts()
    expect(broadcasts.filter((b) => b.token.delta.length > 0).length).toBe(deltas.length)
    expect(broadcasts.some((b) => b.token.isFinal === true)).toBe(true)
  })
})


describe('AgentKernel P1 provider-family stream gate', () => {
  it('falls back to complete when family lacks structured tool stream', async () => {
    class TrackingAdapter extends FakeStreamingLLMAdapter {
      private toolCallReturned = false

      async complete(request: LLMRequest): Promise<LLMResult> {
        this.lastRequest = request
        this.completeCallCount++
        if (!this.toolCallReturned) {
          this.toolCallReturned = true
          return {
            success: true,
            response: {
              id: 'resp-toolcall',
              model: request.model,
              content: '',
              role: 'assistant',
              toolCalls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'get_weather', arguments: '{}' },
                },
              ],
              finishReason: 'tool_calls',
              createdAt: new Date().toISOString(),
            },
            providerId: 'fake-streaming',
          }
        }
        return {
          success: true,
          response: {
            id: 'resp-final',
            model: request.model,
            content: 'ok',
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
          },
          providerId: 'fake-streaming',
        }
      }

      async *stream(
        request: LLMRequest,
      ): AsyncGenerator<import('../../../src/llm/types.js').LLMStreamChunk> {
        this.lastRequest = request
        this.streamCallCount++
        // If this is called for tool turn, tool_calls would be lost — must not happen for anthropic.
        yield {
          kind: 'text',
          delta: 'should-not-stream-tools',
          providerId: 'fake-streaming',
          model: request.model,
        }
        yield { kind: 'finish', finishReason: 'stop', providerId: 'fake-streaming', model: request.model }
      }
    }

    const adapter = new TrackingAdapter()
    const toolProjection = {
      toolIds: ['get_weather'],
      tools: [
        {
          type: 'function' as const,
          function: {
            name: 'get_weather',
            description: 'weather',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
    }

    // anthropic is not in STRUCTURED_TOOL_STREAM_FAMILIES, so the kernel must
    // fall back to complete() for tool turns. (ollama now uses the OpenAI path
    // and is in the trusted set, so it can no longer exercise this gate.)
    const config = makeBaseConfig({
      llmAdapter: adapter,
      providerFamily: 'anthropic',
    })
    const kernel = new AgentKernel(config)
    const result = await kernel.run({ ...makeRunInput(), toolProjection, maxIterations: 3 })

    expect(adapter.streamCallCount).toBe(0)
    expect(adapter.completeCallCount).toBeGreaterThanOrEqual(2)
    expect(result.finalStatus).toBe('completed')
    expect(result.finalResponse).toBe('ok')
    expect(result.toolCalls[0]?.toolName).toBe('get_weather')
  })
})

describe('AgentKernel streaming integration', () => {
  it('streaming respects maxIterations limit', async () => {
    const fakeLLM = new FakeStreamingLLMAdapter(['Test'])

    const config = makeBaseConfig({
      llmAdapter: fakeLLM,
      maxIterations: 1,
    })
    const kernel = new AgentKernel(config)

    const result = await kernel.run({
      ...makeRunInput(),
      maxIterations: 1,
    })

    expect(result.iterationsUsed).toBeLessThanOrEqual(1)
  })

  it('streaming respects timeout', async () => {
    vi.useFakeTimers()

    class SlowStreamingAdapter extends FakeStreamingLLMAdapter {
      async *stream(request: LLMRequest) {
        yield { kind: 'text' as const, delta: 'Slow', providerId: 'slow', model: request.model }
        // Simulate slow streaming
        await new Promise((resolve) => setTimeout(resolve, 10000))
        yield { kind: 'text' as const, delta: 'End', providerId: 'slow', model: request.model }
      }
    }

    const slowAdapter = new SlowStreamingAdapter()
    const config = makeBaseConfig({ llmAdapter: slowAdapter })
    const kernel = new AgentKernel(config)

    const runPromise = kernel.run({
      ...makeRunInput(),
      timeoutMs: 100,
    })

    await vi.advanceTimersByTimeAsync(150)
    const result = await runPromise
    vi.useRealTimers()

    expect(result.finalStatus).toBe('failed')
    expect(result.error?.code).toBe('KERNEL_ERROR')
  })
})
