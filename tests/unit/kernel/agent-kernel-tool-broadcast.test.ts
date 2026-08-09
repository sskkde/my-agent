import { describe, it, expect } from 'vitest'
import type { LLMResult, LLMRequest } from '../../../src/llm/types.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type {
  KernelConfig,
  ToolExecutor,
  ContextManager,
  RuntimeDispatcher,
  InternalToolHandler,
} from '../../../src/kernel/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type { LLMAdapter, LLMAdapterConfig } from '../../../src/llm/adapter.js'
import type { LLMProvider } from '../../../src/llm/provider.js'
import type { ConsoleTimelineEvent, TokenStreamPayload } from '../../../src/api/types.js'
import { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { PromptTemplateRegistry } from '../../../src/prompt/prompt-template-registry.js'
import { TemplateLoader } from '../../../src/prompt/template-loader.js'

class FakeLLMAdapter implements LLMAdapter {
  completeCallCount = 0
  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  }
  providers: LLMProvider[] = []

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.completeCallCount++
    if (this.completeCallCount === 1) {
      return {
        success: true,
        response: {
          id: 'r1',
          model: request.model,
          content: 'Looking up.',
          role: 'assistant',
          finishReason: 'tool_calls',
          createdAt: new Date().toISOString(),
          toolCalls: [
            {
              id: 'tc-live-1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"secret-value"}' },
            },
          ],
        },
        providerId: 'fake',
      }
    }
    return {
      success: true,
      response: {
        id: 'r2',
        model: request.model,
        content: 'Done.',
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

  addProvider(): void {}
  removeProvider(): void {}
  getProvider(): LLMProvider | undefined {
    return undefined
  }
  getHealthyProviders(): LLMProvider[] {
    return []
  }
  updateProviderPriority(): void {}
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

class FakeContextManager implements ContextManager {
  assembleBundle(): ContextBundle {
    return {
      bundleId: 'test-bundle',
      runId: 'turn-live-1',
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
      status: 'completed' as const,
      targetRuntime: 'tool_plane' as const,
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

describe('AgentKernel live tool broadcast', () => {
  it('broadcasts running tool_call then completed tool_result without raw secrets', async () => {
    const broadcaster = new FakeTimelineBroadcaster()
    const eventOrder: string[] = []
    const originalBroadcast = broadcaster.broadcast.bind(broadcaster)
    broadcaster.broadcast = (sessionId, event) => {
      eventOrder.push(`${event.eventType}:${String(event.metadata?.status ?? '')}`)
      originalBroadcast(sessionId, event)
    }

    let sawRunningBeforeResolve = false
    const searchHandler: InternalToolHandler = async (request) => {
      sawRunningBeforeResolve = broadcaster.timelineEvents.some(
        (e) => e.eventType === 'tool_call' && e.metadata?.status === 'running',
      )
      return {
        toolResult: {
          toolCallId: request.toolCallId,
          result: { hits: 1 },
        },
      }
    }

    const config: KernelConfig = {
      llmAdapter: new FakeLLMAdapter(),
      toolExecutor: new FakeToolExecutor(),
      contextManager: new FakeContextManager(),
      dispatcher: new FakeDispatcher(),
      modelInputBuilder: createModelInputBuilder(),
      maxIterations: 5,
      timeoutMs: 10000,
      timelineBroadcaster: broadcaster,
      defaultModel: 'test-model',
    }

    const kernel = new AgentKernel(config)
    const result = await kernel.run({
      contextBundle: {
        bundleId: 'test-bundle',
        runId: 'turn-live-1',
        agentId: 'test-agent',
        agentType: 'main',
        userId: 'test-user',
        invocationSource: 'gateway_intent',
        pinnedItems: [],
        orderedItems: [],
        tokenEstimate: 100,
      },
      runId: 'turn-live-1',
      agentId: 'test-agent',
      agentType: 'main',
      userId: 'test-user',
      sessionId: 'session-live-1',
      maxIterations: 5,
      timeoutMs: 10000,
      toolProjection: {
        toolIds: ['search'],
        tools: [
          {
            type: 'function',
            function: {
              name: 'search',
              description: 'search the web',
              parameters: {
                type: 'object',
                properties: { q: { type: 'string' } },
              },
            },
          },
        ],
      },
      internalToolHandlers: {
        search: searchHandler,
      },
    })
    expect(result.finalStatus).toBe('completed')
    expect(sawRunningBeforeResolve).toBe(true)
    expect(eventOrder[0]).toBe('tool_call:running')
    expect(eventOrder).toContain('tool_result:completed')
    expect(eventOrder.indexOf('tool_call:running')).toBeLessThan(eventOrder.indexOf('tool_result:completed'))

    const call = broadcaster.timelineEvents.find((e) => e.eventType === 'tool_call')
    const toolResult = broadcaster.timelineEvents.find((e) => e.eventType === 'tool_result')
    expect(call?.metadata?.toolCallId).toBe('tc-live-1')
    expect(toolResult?.metadata?.toolCallId).toBe('tc-live-1')
    expect(JSON.stringify(broadcaster.timelineEvents)).not.toContain('secret-value')
  })
})
