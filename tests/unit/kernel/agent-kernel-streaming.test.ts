import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { LLMResult, LLMRequest } from '../../../src/llm/types.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type { KernelRunInput, KernelConfig, ToolExecutor, ContextManager, RuntimeDispatcher } from '../../../src/kernel/types.js'
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
  private lastRequest: LLMRequest | undefined
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

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.lastRequest = request
    
    if (this.shouldFail) {
      return {
        success: false,
        error: {
          errorId: 'err-stream-fallback',
          category: 'model_error',
          code: 'STREAMING_FAILED',
          message: 'Streaming failed, fallback to complete',
          recoverability: 'retryable_later',
          source: { module: 'test' },
          createdAt: new Date().toISOString(),
        },
        providerId: 'fake-streaming',
      }
    }

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
  ): AsyncGenerator<{ delta: string; providerId: string; model?: string; usage?: any }> {
    this.lastRequest = request
    
    for (let i = 0; i < this.deltas.length; i++) {
      if (this.shouldFail && this.failureAfterDelta !== undefined && i >= this.failureAfterDelta) {
        throw new Error('Streaming failed mid-stream')
      }
      
      yield {
        delta: this.deltas[i],
        providerId: 'fake-streaming',
        model: request.model,
      }
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

  broadcastTokenStream(sessionId: string, token: TokenStreamPayload): void {
    this.broadcasts.push({ sessionId, token })
  }

  getBroadcasts(): BroadcastCall[] {
    return this.broadcasts
  }

  clear(): void {
    this.broadcasts = []
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

// ─── Test Setup ───────────────────────────────────────────────────────────────

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
    llmAdapter: new FakeStreamingLLMAdapter(),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentKernel streaming behavior', () => {
  let fakeLLM: FakeStreamingLLMAdapter
  let fakeBroadcaster: FakeTimelineBroadcaster

  beforeEach(() => {
    fakeLLM = new FakeStreamingLLMAdapter()
    fakeBroadcaster = new FakeTimelineBroadcaster()
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
      
      // Should emit one broadcast per delta
      expect(broadcasts.length).toBe(deltas.length)
      
      // Each broadcast should have increasing sequence
      for (let i = 0; i < broadcasts.length; i++) {
        expect(broadcasts[i].token.sequence).toBe(i)
        expect(broadcasts[i].token.delta).toBe(deltas[i])
      }
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
      
      expect(broadcasts.length).toBe(3)
      expect(broadcasts[0].token.isFinal).toBe(false)
      expect(broadcasts[1].token.isFinal).toBe(false)
      expect(broadcasts[2].token.isFinal).toBe(true)
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
      expect(broadcasts.length).toBe(1)
      expect(broadcasts[0].token.isFinal).toBe(true)
    })
  })

  describe('Streaming failure handling', () => {
    it('produces controlled error when streaming fails mid-stream', async () => {
      fakeLLM.setDeltas(['Start', ' ', 'middle', ' ', 'end'])
      fakeLLM.setShouldFail(true, 2) // Fail after 2 deltas
      
      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)
      
      const result = await kernel.run(makeRunInput())

      // Should fail gracefully
      expect(result.finalStatus).toBe('failed')
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('STREAMING_ERROR')
    })

    it('fallback to complete() when streaming not supported', async () => {
      // Create adapter that only supports complete(), not stream()
      class NonStreamingAdapter extends FakeStreamingLLMAdapter {
        async *stream() {
          // Empty generator - no streaming support
          return
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
      
      await kernel.run(makeRunInput())

      const broadcasts = fakeBroadcaster.getBroadcasts()
      
      // Should only have broadcasts up to the failure point
      // No duplicate error messages
      expect(broadcasts.length).toBe(1) // Only 'A' before failure
      
      // Last broadcast should NOT be marked as final since it failed
      expect(broadcasts[0].token.isFinal).toBe(false)
    })

    it('preserves partial deltas before streaming failure', async () => {
      fakeLLM.setDeltas(['Part1', ' ', 'Part2', ' ', 'Part3'])
      fakeLLM.setShouldFail(true, 2) // Fail after 2 deltas
      
      const config = makeBaseConfig({ llmAdapter: fakeLLM })
      const kernel = new AgentKernel(config)
      
      await kernel.run(makeRunInput())

      const broadcasts = fakeBroadcaster.getBroadcasts()
      
      // Should have broadcasts for 'Part1' and ' '
      expect(broadcasts.length).toBe(2)
      expect(broadcasts[0].token.delta).toBe('Part1')
      expect(broadcasts[1].token.delta).toBe(' ')
    })
  })

  describe('Streaming with tool calls', () => {
    it('does not stream when tool calls are present', async () => {
      // Create adapter that returns tool calls
      class ToolCallStreamingAdapter extends FakeStreamingLLMAdapter {
        async complete(request: LLMRequest): Promise<LLMResult> {
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
                  id: 'tc-1',
                  type: 'function',
                  function: {
                    name: 'test_tool',
                    arguments: JSON.stringify({ arg: 'value' }),
                  },
                },
              ],
            },
            providerId: 'fake-streaming',
          }
        }
      }
      
      const toolCallAdapter = new ToolCallStreamingAdapter()
      const config = makeBaseConfig({ llmAdapter: toolCallAdapter })
      const kernel = new AgentKernel(config)
      
      await kernel.run(makeRunInput())

      const broadcasts = fakeBroadcaster.getBroadcasts()
      
      // Should not emit any token streams when tool calls are present
      expect(broadcasts.length).toBe(0)
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
      
      // Each delta should be broadcast individually
      const broadcasts = fakeBroadcaster.getBroadcasts()
      expect(broadcasts.length).toBe(1000)
    })
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
        yield { delta: 'Slow', providerId: 'slow', model: request.model }
        // Simulate slow streaming
        await new Promise((resolve) => setTimeout(resolve, 10000))
        yield { delta: 'End', providerId: 'slow', model: request.model }
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
