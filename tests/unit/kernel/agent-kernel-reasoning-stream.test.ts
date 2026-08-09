import { describe, it, expect, beforeEach } from 'vitest'
import type { LLMRequest, LLMResult, LLMStreamChunk } from '../../../src/llm/types.js'
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

// ─── Fake Streaming LLM Adapter with reasoning support ───────────────────────

const REASONING_FIXTURE = 'REASONING_FIXTURE_12345'
const ANSWER_TEXT = 'The answer is 42.'

/**
 * Fake LLM adapter that streams `kind: 'reasoning'` chunks BEFORE `kind: 'text'`
 * chunks, mirroring real provider behavior (deepseek/openrouter emit
 * reasoning_content before content). T3 added `reasoningContent` to
 * MockResponseConfig; this fake exercises the same contract at the kernel layer.
 */
class ReasoningStreamingLLMAdapter implements LLMAdapter {
  private reasoningDeltas: string[]
  private textDeltas: string[]
  protected lastRequest: LLMRequest | undefined

  config: LLMAdapterConfig = {
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
  }
  providers: LLMProvider[] = []

  constructor(reasoningDeltas: string[], textDeltas: string[]) {
    this.reasoningDeltas = reasoningDeltas
    this.textDeltas = textDeltas
  }

  streamCallCount = 0
  completeCallCount = 0

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.lastRequest = request
    this.completeCallCount++
    return {
      success: true,
      response: {
        id: 'resp-test',
        model: request.model,
        content: this.textDeltas.join(''),
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: 'fake-reasoning',
    }
  }

  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    this.lastRequest = request
    this.streamCallCount++

    // Reasoning chunks first (matches real provider order)
    for (const delta of this.reasoningDeltas) {
      yield {
        kind: 'reasoning',
        delta,
        providerId: 'fake-reasoning',
        model: request.model,
      }
    }
    // Then text chunks
    for (const delta of this.textDeltas) {
      yield {
        kind: 'text',
        delta,
        providerId: 'fake-reasoning',
        model: request.model,
      }
    }
    yield {
      kind: 'finish',
      finishReason: 'stop',
      providerId: 'fake-reasoning',
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
}

// ─── Fake Timeline Broadcaster (captures token stream + timeline events) ──────

interface BroadcastCall {
  sessionId: string
  token: TokenStreamPayload
}

class FakeTimelineBroadcaster {
  private broadcasts: BroadcastCall[] = []
  private timelineEvents: Array<{
    sessionId: string
    event: import('../../../src/api/types.js').ConsoleTimelineEvent
  }> = []

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
    llmAdapter: new ReasoningStreamingLLMAdapter([], []),
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

describe('AgentKernel reasoning stream broadcast (T4)', () => {
  let fakeBroadcaster: FakeTimelineBroadcaster

  beforeEach(() => {
    fakeBroadcaster = defaultBroadcaster
    fakeBroadcaster.clear()
  })

  it('broadcasts reasoning deltas on channel:reasoning and assistant text on channel:assistant', async () => {
    const reasoningDeltas = ['Thinking ', 'about ', REASONING_FIXTURE]
    const textDeltas = [ANSWER_TEXT]
    const adapter = new ReasoningStreamingLLMAdapter(reasoningDeltas, textDeltas)

    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    const result = await kernel.run(makeRunInput())

    // Sanity: run completed
    expect(result.finalStatus).toBe('completed')

    const broadcasts = fakeBroadcaster.getBroadcasts()

    // (a) assistant joined deltas EXCLUDE the reasoning fixture
    const assistantBroadcasts = broadcasts.filter(
      (b) => b.token.channel === 'assistant' || b.token.channel === undefined,
    )
    const assistantJoined = assistantBroadcasts
      .map((b) => b.token.delta)
      .filter((d) => d.length > 0)
      .join('')
    expect(assistantJoined).not.toContain(REASONING_FIXTURE)
    expect(assistantJoined).toBe(ANSWER_TEXT)

    // (b) a reasoning-channel broadcast payload CONTAINS the fixture
    const reasoningBroadcasts = broadcasts.filter((b) => b.token.channel === 'reasoning')
    expect(reasoningBroadcasts.length).toBeGreaterThan(0)
    const reasoningJoined = reasoningBroadcasts
      .map((b) => b.token.delta)
      .filter((d) => d.length > 0)
      .join('')
    expect(reasoningJoined).toContain(REASONING_FIXTURE)
    expect(reasoningJoined).toBe('Thinking about REASONING_FIXTURE_12345')

    // Reasoning broadcasts must never carry channel:assistant
    for (const b of reasoningBroadcasts) {
      expect(b.token.channel).toBe('reasoning')
    }
    // Assistant broadcasts must never carry channel:reasoning
    for (const b of assistantBroadcasts) {
      expect(b.token.channel).not.toBe('reasoning')
    }
  })

  it('assistant finalResponse / aggregator content is answer-only (no reasoning fixture)', async () => {
    const reasoningDeltas = ['Let me reason. ', REASONING_FIXTURE, ' Done.']
    const textDeltas = ['Final ', ANSWER_TEXT]
    const adapter = new ReasoningStreamingLLMAdapter(reasoningDeltas, textDeltas)

    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    const result = await kernel.run(makeRunInput())

    expect(result.finalStatus).toBe('completed')
    // finalResponse must be answer-only — reasoning fixture must NOT leak
    expect(result.finalResponse).toBe(`Final ${ANSWER_TEXT}`)
    expect(result.finalResponse).not.toContain(REASONING_FIXTURE)
  })

  it('reasoning accumulated field reflects reasoning so far on each reasoning broadcast', async () => {
    const reasoningDeltas = ['Step1 ', 'Step2 ', REASONING_FIXTURE]
    const textDeltas = ['answer']
    const adapter = new ReasoningStreamingLLMAdapter(reasoningDeltas, textDeltas)

    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    await kernel.run(makeRunInput())

    const reasoningBroadcasts = fakeBroadcaster
      .getBroadcasts()
      .filter((b) => b.token.channel === 'reasoning' && b.token.delta.length > 0)

    expect(reasoningBroadcasts.length).toBe(3)
    // Each reasoning broadcast's accumulated field should reflect reasoning so far
    expect(reasoningBroadcasts[0].token.accumulated).toBe('Step1 ')
    expect(reasoningBroadcasts[1].token.accumulated).toBe('Step1 Step2 ')
    expect(reasoningBroadcasts[2].token.accumulated).toBe('Step1 Step2 REASONING_FIXTURE_12345')
  })

  it('does NOT emit empty reasoning UI blocks when no reasoning existed', async () => {
    // No reasoning deltas — only text
    const adapter = new ReasoningStreamingLLMAdapter([], [ANSWER_TEXT])

    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    await kernel.run(makeRunInput())

    const broadcasts = fakeBroadcaster.getBroadcasts()
    const reasoningBroadcasts = broadcasts.filter((b) => b.token.channel === 'reasoning')
    // No reasoning chunks → zero reasoning-channel broadcasts (no empty blocks)
    expect(reasoningBroadcasts.length).toBe(0)

    // Assistant path still works
    const assistantBroadcasts = broadcasts.filter(
      (b) => b.token.channel === 'assistant' || b.token.channel === undefined,
    )
    const assistantJoined = assistantBroadcasts
      .map((b) => b.token.delta)
      .filter((d) => d.length > 0)
      .join('')
    expect(assistantJoined).toBe(ANSWER_TEXT)
  })

  it('reasoning fixture never appears in any assistant-channel payload', async () => {
    const reasoningDeltas = [REASONING_FIXTURE, ' more reasoning']
    const textDeltas = ['answer text']
    const adapter = new ReasoningStreamingLLMAdapter(reasoningDeltas, textDeltas)

    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    await kernel.run(makeRunInput())

    const broadcasts = fakeBroadcaster.getBroadcasts()
    const assistantBroadcasts = broadcasts.filter(
      (b) => b.token.channel === 'assistant' || b.token.channel === undefined,
    )
    // Every assistant-channel payload (delta AND accumulated) must exclude the fixture
    for (const b of assistantBroadcasts) {
      expect(b.token.delta).not.toContain(REASONING_FIXTURE)
      if (b.token.accumulated !== undefined) {
        expect(b.token.accumulated).not.toContain(REASONING_FIXTURE)
      }
    }
  })

  it('projects reasoning as live thinking_summary timeline events (single-source streaming)', async () => {
    const reasoningDeltas = ['Step1 ', 'Step2 ', REASONING_FIXTURE]
    const textDeltas = ['answer']
    const adapter = new ReasoningStreamingLLMAdapter(reasoningDeltas, textDeltas)

    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    await kernel.run(makeRunInput())

    const thinkingEvents = fakeBroadcaster
      .getTimelineEvents()
      .filter((entry) => entry.event.eventType === 'thinking_summary')

    // One live block per reasoning delta, keyed by stable per-turn eventId
    expect(thinkingEvents.length).toBe(3)
    for (const entry of thinkingEvents) {
      expect(entry.sessionId).toBe('test-session')
      expect(entry.event.eventId).toBe('turn-test-run-thinking-live')
      expect(entry.event.metadata?.live).toBe(true)
      expect(entry.event.metadata?.turnId).toBe('test-run')
    }
    // Content accumulates reasoning so far
    expect(thinkingEvents[0].event.content).toBe('Step1 ')
    expect(thinkingEvents[1].event.content).toBe('Step1 Step2 ')
    expect(thinkingEvents[2].event.content).toBe(`Step1 Step2 ${REASONING_FIXTURE}`)
  })

  it('does NOT emit live thinking_summary events when no reasoning existed', async () => {
    const adapter = new ReasoningStreamingLLMAdapter([], [ANSWER_TEXT])

    const config = makeBaseConfig({ llmAdapter: adapter })
    const kernel = new AgentKernel(config)

    await kernel.run(makeRunInput())

    const thinkingEvents = fakeBroadcaster
      .getTimelineEvents()
      .filter((entry) => entry.event.eventType === 'thinking_summary')
    expect(thinkingEvents.length).toBe(0)
  })
})
