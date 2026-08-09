/**
 * Background auto-continue turns — full-chain integration coverage (plan todo #7).
 *
 * When a background child task reaches a terminal state (completed / failed /
 * cancelled) the platform auto-continues the PARENT session with a synthetic
 * notification turn: the LLM wakes up, processes the persisted notification and
 * replies — no user message required. This suite drives the REAL wiring:
 *
 *   createApiContext (in-memory SQLite, injected scripted LLM adapter,
 *   injected channel registry) → real messageProcessor → real
 *   backgroundRuntime (wired with the parentTurnTrigger closure) → real
 *   scheduleBackgroundNotificationTurn → real stores / channels / timeline.
 *
 * Scenarios:
 *   (a) full chain     — user turn launches a background task; completing the
 *                        run auto-produces one assistant turn with NO user
 *                        message, marks notification_delivered_at, and the
 *                        webui SSE timeline receives the assistant event
 *   (b) exactly-once   — duplicate completeBackgroundRun => ONE auto turn
 *   (c) failure rollback — the auto turn's LLM throws => unclaim restores the
 *                        notification to pending + an error envelope is sent
 *   (d) busy + drain   — completion while the session is busy queues no auto
 *                        turn; one onIdle retry fires it after the turn drains
 *   (e) recursion guard — a launch attempted from the auto turn is rejected
 *                        (SUBAGENT_LAUNCH_FROM_NOTIFICATION_TURN) and no new
 *                        background run is enqueued
 *   (f) channels       — external channel 'test_ext' gets zero deliveries;
 *                        webui receives the text envelope (and the SSE event)
 *   (g) switch off     — AUTO_CONTINUE_ON_BACKGROUND_COMPLETE=false leaves the
 *                        notification pending for the collect fallback
 */

import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import {
  createChannelRegistry,
  createWebUIChannelHandler,
  type ChannelRegistry,
} from '../../../src/gateway/channel-registry.js'
import type { OutboundEnvelope } from '../../../src/gateway/types.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { CircuitBreaker, CircuitBreakerState, CircuitBreakerStats } from '../../../src/llm/circuit-breaker.js'
import type { LLMProvider, ProviderHealthStatus, ProviderStats } from '../../../src/llm/provider.js'
import type { LLMRequest, LLMResult, LLMResponse, LLMStreamChunk, ProviderConfig } from '../../../src/llm/types.js'
import type { SseEnvelope } from '../../../src/api/timeline-broadcaster.js'
import type { ConsoleTimelineEvent } from '../../../src/api/types.js'
import type { SubagentResult } from '../../../src/subagents/types.js'

const USER_ID = 'user_auto_continue'
const SESSION_ID = 'sess_auto_continue'
const LAUNCH_OBJECTIVE = 'Compile the quarterly report'
const USER_TURN_FINAL = 'User turn final text'
const AUTO_REPLY = 'AUTO_CONTINUE_REPLY_SENTINEL'
const USER_INPUT = {
  correlationId: 'user-turn-auto-continue',
  userId: USER_ID,
  sessionId: SESSION_ID,
  text: 'Please launch a background report task',
  timestamp: '2026-08-09T00:00:00.000Z',
}
const COMPLETE_RESULT: SubagentResult = {
  status: 'completed',
  response: 'The quarterly report is ready with 42 findings',
  toolCalls: [],
  iterationsUsed: 3,
}

// ---------------------------------------------------------------------------
// Scripted LLM provider — queue-based; each kernel LLM call shifts one entry.
// ---------------------------------------------------------------------------

type ScriptedEntry =
  | { kind: 'tool'; name: string; args: Record<string, unknown>; delayMs?: number }
  | { kind: 'text'; content: string; delayMs?: number }
  | { kind: 'throw'; message: string }

class ScriptedLLMProvider implements LLMProvider {
  readonly id = 'scripted'
  readonly queue: ScriptedEntry[]
  readonly requests: LLMRequest[] = []
  private responseCount = 0
  private statsImpl: ProviderStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timeoutRequests: 0,
    averageLatencyMs: 0,
    healthStatus: 'healthy',
  }

  readonly config: ProviderConfig = {
    id: 'scripted',
    name: 'Scripted Provider',
    enabled: true,
    priority: 1,
    timeoutMs: 60000,
    retries: 0,
    capabilities: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsVision: false,
      maxTokens: 4096,
      supportedModels: ['scripted-model'],
    },
  }

  constructor(queue: ScriptedEntry[]) {
    this.queue = queue
  }

  get circuitBreaker(): CircuitBreaker {
    const stats: CircuitBreakerStats = {
      state: 'CLOSED' as CircuitBreakerState,
      failureCount: 0,
      successCount: 0,
      totalRequests: 0,
      rejectedRequests: 0,
    }
    return {
      get state() {
        return 'CLOSED' as CircuitBreakerState
      },
      get config() {
        return { failureThreshold: 5, resetTimeoutMs: 30000, successThreshold: 2 }
      },
      get stats() {
        return { ...stats }
      },
      recordSuccess: () => {},
      recordFailure: () => {},
      canExecute: () => true,
      reset: () => {},
      forceOpen: () => {},
      forceClose: () => {},
    }
  }

  get health(): ProviderHealthStatus {
    return 'healthy'
  }

  get stats(): ProviderStats {
    return { ...this.statsImpl }
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.requests.push(request)
    this.statsImpl.totalRequests++
    // Memory-extraction (and any other structured-JSON) requests share this
    // injected adapter after every successful turn; answer them benignly
    // without consuming the scripted foreground queue.
    if (request.responseFormat?.type === 'json_object') {
      this.statsImpl.successfulRequests++
      return {
        success: true,
        response: {
          id: `mem-${this.responseCount++}`,
          model: request.model,
          content: '{"candidates": []}',
          role: 'assistant',
          finishReason: 'stop',
          createdAt: new Date().toISOString(),
        },
        providerId: this.id,
      }
    }
    const entry = this.queue.shift()
    if (!entry) {
      throw new Error(`ScriptedLLMProvider: queue exhausted after ${this.requests.length} requests`)
    }
    if (entry.kind !== 'throw' && entry.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, entry.delayMs))
    }
    if (entry.kind === 'throw') {
      this.statsImpl.failedRequests++
      throw new Error(entry.message)
    }
    this.statsImpl.successfulRequests++

    const response: LLMResponse =
      entry.kind === 'tool'
        ? {
            id: `resp-${this.responseCount++}`,
            model: request.model,
            content: '',
            role: 'assistant',
            toolCalls: [
              {
                id: `tool-call-${this.responseCount}`,
                type: 'function',
                function: { name: entry.name, arguments: JSON.stringify(entry.args) },
              },
            ],
            finishReason: 'tool_calls',
            createdAt: new Date().toISOString(),
          }
        : {
            id: `resp-${this.responseCount++}`,
            model: request.model,
            content: entry.content,
            role: 'assistant',
            finishReason: 'stop',
            createdAt: new Date().toISOString(),
          }

    return { success: true, response, providerId: this.id }
  }

  async *stream(request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    const result = await this.complete(request)
    if (!result.success) return
    const { response, providerId } = result
    if (response.content) {
      for (const chunk of response.content.match(/.{1,4}/gs) ?? []) {
        yield { kind: 'text', delta: chunk, providerId, model: request.model }
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }
    if (response.toolCalls) {
      for (let index = 0; index < response.toolCalls.length; index++) {
        const tc = response.toolCalls[index]!
        yield {
          kind: 'tool_call_delta',
          index,
          id: tc.id,
          name: tc.function.name,
          argumentsDelta: tc.function.arguments,
          providerId,
          model: request.model,
        }
      }
    }
    yield { kind: 'finish', finishReason: response.finishReason, providerId, model: request.model }
  }

  isHealthy(): boolean {
    return true
  }

  getStats(): ProviderStats {
    return { ...this.statsImpl }
  }

  updateConfig(): void {}

  resetStats(): void {
    this.statsImpl = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeoutRequests: 0,
      averageLatencyMs: 0,
      healthStatus: 'healthy',
    }
  }
}

function createScriptedLLMAdapter(provider: ScriptedLLMProvider): LLMAdapter {
  return {
    get config() {
      return { providers: [], defaultTimeoutMs: 30000, enableCircuitBreaker: false, enableLogging: false }
    },
    get providers() {
      return [provider]
    },
    complete: (request: LLMRequest) => provider.complete(request),
    stream: (request: LLMRequest) => provider.stream(request),
    addProvider: () => {},
    removeProvider: () => {},
    getProvider: () => provider,
    getHealthyProviders: () => [provider],
    updateProviderPriority: () => {},
  }
}

// ---------------------------------------------------------------------------
// Harness — real createApiContext over in-memory SQLite + real channels.
// ---------------------------------------------------------------------------

interface Harness {
  ctx: ApiContext
  provider: ScriptedLLMProvider
  webuiDeliveries: OutboundEnvelope[]
  extDeliveries: OutboundEnvelope[]
  /** Timeline events received over a real SSE subscription (timeline_event envelopes). */
  sseEvents: ConsoleTimelineEvent[]
}

const harnessConnections: ApiContext[] = []

function parseSseEnvelopes(raw: string, sink: ConsoleTimelineEvent[]): void {
  const dataLine = raw.split('\n').find((line) => line.startsWith('data: '))
  if (!dataLine) return
  try {
    const parsed = JSON.parse(dataLine.slice('data: '.length)) as SseEnvelope
    if (parsed && typeof parsed === 'object' && parsed.type === 'timeline_event') {
      sink.push(parsed.event)
    }
  } catch {
    // Non-JSON keep-alive frames are ignored.
  }
}

function createHarness(entries: ScriptedEntry[]): Harness {
  const provider = new ScriptedLLMProvider(entries)
  const webuiDeliveries: OutboundEnvelope[] = []
  const extDeliveries: OutboundEnvelope[] = []
  const sseEvents: ConsoleTimelineEvent[] = []

  const channelRegistry: ChannelRegistry = createChannelRegistry()
  const result = createApiContext({
    dbPath: ':memory:',
    llmAdapter: createScriptedLLMAdapter(provider),
    channelRegistry,
  })
  if (isApiContextError(result)) {
    throw new Error(`createApiContext failed: ${result.message}`)
  }
  const ctx = result
  harnessConnections.push(ctx)

  // Register webui with the REAL handler so deliveries broadcast to SSE, then
  // count the envelopes the auto-continue turn delivers to it.
  const realWebuiHandler = createWebUIChannelHandler({
    timelineBroadcaster: ctx.timelineBroadcaster,
    consoleTimelineService: ctx.consoleTimelineService,
  })
  channelRegistry.register(
    'webui',
    {
      deliver: (envelope) => {
        webuiDeliveries.push(envelope)
        return realWebuiHandler.deliver(envelope)
      },
    },
    { type: 'webui', status: 'active', configured: true },
  )
  channelRegistry.register(
    'test_ext',
    {
      deliver: (envelope) => {
        extDeliveries.push(envelope)
        return { success: true }
      },
    },
    { type: 'external', status: 'active', configured: true },
  )

  // Subscribe to the REAL SSE broadcaster before any turn runs.
  ctx.timelineBroadcaster.subscribe(SESSION_ID, {
    write: (raw) => {
      parseSseEnvelopes(raw, sseEvents)
      return true
    },
  })

  ctx.providerConfigStore.create({
    providerId: 'prov-scripted-auto-continue',
    userId: USER_ID,
    providerType: 'ollama',
    displayName: 'Scripted Provider',
    baseUrl: 'http://localhost:11434',
    selectedModel: 'scripted-model',
  })
  ctx.stores.sessionStore.create({ sessionId: SESSION_ID, userId: USER_ID, title: 'Auto-continue test' })

  return { ctx, provider, webuiDeliveries, extDeliveries, sseEvents }
}

async function waitFor(producer: () => unknown, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (producer()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

async function waitForValue<T>(producer: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = producer()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function findLaunchedRunId(ctx: ApiContext): string | undefined {
  const events = ctx.stores.eventStore.query({ eventType: 'BackgroundRunEnqueued', sessionId: SESSION_ID })
  return events[0]?.relatedRefs?.backgroundRunId
}

function autoTurns(ctx: ApiContext): Array<{ turnId: string; userMessageSummary?: string }> {
  return ctx.stores.transcriptStore
    .findBySession(SESSION_ID)
    .filter((turn) => turn.turnId.startsWith('turn-bg-'))
    .map((turn) => ({ turnId: turn.turnId, userMessageSummary: turn.input.userMessageSummary }))
}

/**
 * User turn launches a background task and returns its backgroundRunId.
 * The turn is driven through the REAL messageProcessor with the scripted LLM
 * (first response = foreground_launch_subagent background=true).
 */
async function launchBackgroundRun(ctx: ApiContext): Promise<string> {
  const output = await ctx.messageProcessor.process({ ...USER_INPUT })
  expect(output.success).toBe(true)
  return waitForValue(() => findLaunchedRunId(ctx), 5000, 'background run enqueued by launch tool')
}

async function completeRun(ctx: ApiContext, bgRunId: string): Promise<void> {
  await ctx.backgroundRuntime.startBackgroundRun(bgRunId)
  ctx.backgroundRuntime.completeBackgroundRun(bgRunId, COMPLETE_RESULT)
}

const ORIGINAL_AUTO_CONTINUE = process.env.AUTO_CONTINUE_ON_BACKGROUND_COMPLETE

beforeEach(() => {
  delete process.env.AUTO_CONTINUE_ON_BACKGROUND_COMPLETE
})

afterAll(() => {
  if (ORIGINAL_AUTO_CONTINUE === undefined) {
    delete process.env.AUTO_CONTINUE_ON_BACKGROUND_COMPLETE
  } else {
    process.env.AUTO_CONTINUE_ON_BACKGROUND_COMPLETE = ORIGINAL_AUTO_CONTINUE
  }
})

afterEach(() => {
  while (harnessConnections.length > 0) {
    harnessConnections.pop()?.connection.close()
  }
})

describe('background auto-continue turns (todo #7)', () => {
  it('(a) full chain: completion auto-continues the parent turn end-to-end', { timeout: 30000 }, async () => {
    const h = createHarness([
      { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: LAUNCH_OBJECTIVE, background: true } },
      { kind: 'text', content: USER_TURN_FINAL },
      { kind: 'text', content: AUTO_REPLY },
    ])
    const bgRunId = await launchBackgroundRun(h.ctx)

    await completeRun(h.ctx, bgRunId)

    // A synthetic assistant turn appears WITHOUT a user message.
    await waitFor(() => autoTurns(h.ctx).length === 1, 5000, 'auto-continue turn persisted')
    const autoTurnsList = autoTurns(h.ctx)
    expect(autoTurnsList[0]!.userMessageSummary ?? '').toBe('')
    const autoTurn = h.ctx.stores.transcriptStore
      .findBySession(SESSION_ID)
      .find((t) => t.turnId === autoTurnsList[0]!.turnId)
    expect(autoTurn?.output.visibleMessages.some((m) => m.role === 'assistant' && m.content === AUTO_REPLY)).toBe(true)

    // The claim sticks: notification_delivered_at is set.
    expect(h.ctx.stores.backgroundRunStore.getById(bgRunId)?.notificationDeliveredAt).toBeTruthy()

    // The webui SSE timeline received that turn's assistant event.
    await waitFor(
      () => h.sseEvents.some((e) => e.eventType === 'assistant_message' && e.content === AUTO_REPLY),
      5000,
      'assistant SSE event for the auto turn',
    )
  })

  it('(b) exactly-once: duplicate completeBackgroundRun yields ONE auto turn', { timeout: 30000 }, async () => {
    const h = createHarness([
      { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: LAUNCH_OBJECTIVE, background: true } },
      { kind: 'text', content: USER_TURN_FINAL },
      { kind: 'text', content: AUTO_REPLY },
    ])
    const bgRunId = await launchBackgroundRun(h.ctx)
    await h.ctx.backgroundRuntime.startBackgroundRun(bgRunId)

    h.ctx.backgroundRuntime.completeBackgroundRun(bgRunId, COMPLETE_RESULT)
    h.ctx.backgroundRuntime.completeBackgroundRun(bgRunId, COMPLETE_RESULT)

    await waitFor(() => autoTurns(h.ctx).length === 1, 5000, 'first auto turn persisted')
    await settle(200)
    expect(autoTurns(h.ctx)).toHaveLength(1)
    expect(h.ctx.stores.backgroundRunStore.getById(bgRunId)?.notificationDeliveredAt).toBeTruthy()
  })

  it(
    '(c) failure rollback: auto-turn LLM throw unclaims the notification (stays pending)',
    { timeout: 30000 },
    async () => {
      const h = createHarness([
        { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: LAUNCH_OBJECTIVE, background: true } },
        { kind: 'text', content: USER_TURN_FINAL },
        { kind: 'throw', message: 'Synthetic LLM failure during auto turn' },
      ])
      const bgRunId = await launchBackgroundRun(h.ctx)
      await completeRun(h.ctx, bgRunId)

      // The auto turn attempted delivery of an error envelope...
      await waitFor(
        () => h.webuiDeliveries.some((e) => e.messageType === 'error' && e.recipient.sessionId === SESSION_ID),
        5000,
        'error envelope delivered for failed auto turn',
      )
      // ...and rolled the claim back: delivered_at is NULL again and the
      // notification stays pending for the collect fallback.
      await waitFor(
        () => h.ctx.stores.backgroundRunStore.getById(bgRunId)?.notificationDeliveredAt === undefined,
        5000,
        'notification unclaimed after failure',
      )
      const pending = h.ctx.stores.backgroundRunStore.getPendingNotifications(SESSION_ID)
      expect(pending.some((run) => run.backgroundRunId === bgRunId)).toBe(true)
    },
  )

  it(
    '(d) busy + drain: completion during a busy session waits for the turn to finish',
    { timeout: 30000 },
    async () => {
      const h = createHarness([
        { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: LAUNCH_OBJECTIVE, background: true } },
        // Keep the session busy while the test completes the background run.
        { kind: 'text', content: USER_TURN_FINAL, delayMs: 1500 },
        { kind: 'text', content: AUTO_REPLY },
      ])
      const userTurnPromise = h.ctx.sessionBusyTracker.withBusy(SESSION_ID, () =>
        h.ctx.messageProcessor.process({ ...USER_INPUT }),
      )
      expect(h.ctx.sessionBusyTracker.isBusy(SESSION_ID)).toBe(true)

      const bgRunId = await waitForValue(() => findLaunchedRunId(h.ctx), 5000, 'background run enqueued while busy')
      await h.ctx.backgroundRuntime.startBackgroundRun(bgRunId)
      h.ctx.backgroundRuntime.completeBackgroundRun(bgRunId, COMPLETE_RESULT)

      // No immediate auto turn: the session is busy and the claim must wait.
      await settle(150)
      expect(autoTurns(h.ctx)).toHaveLength(0)
      expect(h.ctx.stores.backgroundRunStore.getById(bgRunId)?.notificationDeliveredAt).toBeUndefined()

      await userTurnPromise

      // Once the user turn drains, the one-shot onIdle retry fires the auto turn.
      await waitFor(() => autoTurns(h.ctx).length === 1, 5000, 'onIdle drain auto turn')
      expect(h.ctx.stores.backgroundRunStore.getById(bgRunId)?.notificationDeliveredAt).toBeTruthy()
    },
  )

  it('(e) recursion guard: a launch from the auto turn is rejected and not enqueued', { timeout: 30000 }, async () => {
    const h = createHarness([
      { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: LAUNCH_OBJECTIVE, background: true } },
      { kind: 'text', content: USER_TURN_FINAL },
      { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: 'RECURSIVE_LAUNCH', background: true } },
      { kind: 'text', content: AUTO_REPLY },
    ])
    const bgRunId = await launchBackgroundRun(h.ctx)
    await completeRun(h.ctx, bgRunId)

    await waitFor(() => autoTurns(h.ctx).length === 1, 5000, 'auto turn with rejected launch persisted')

    // The auto turn still completed and delivered its reply (the rejection did
    // not abort the turn)...
    await waitFor(
      () => h.sseEvents.some((e) => e.eventType === 'assistant_message' && e.content === AUTO_REPLY),
      5000,
      'assistant SSE event after rejected launch',
    )

    // ...but the recursive launch was rejected at the tool boundary: a FAILED
    // execution row exists for the RECURSIVE_LAUNCH attempt (tool error codes
    // are redacted from persisted surfaces, so the rejection is observable via
    // the failed row + the absence of a second enqueue).
    const executions = h.ctx.stores.toolExecutionStore.getBySession(SESSION_ID)
    const rejected = executions.find(
      (e) =>
        e.toolName === 'foreground_launch_subagent' &&
        e.params &&
        typeof e.params === 'object' &&
        (e.params as { objective?: string }).objective === 'RECURSIVE_LAUNCH',
    )
    expect(rejected).toBeDefined()
    expect(rejected!.status).toBe('failed')

    // Exactly ONE background run was ever enqueued (the user turn's launch).
    const enqueued = h.ctx.stores.eventStore.query({ eventType: 'BackgroundRunEnqueued', sessionId: SESSION_ID })
    expect(enqueued).toHaveLength(1)
  })

  it(
    '(f) channels: external channel receives zero deliveries, webui gets the text envelope',
    { timeout: 30000 },
    async () => {
      const h = createHarness([
        { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: LAUNCH_OBJECTIVE, background: true } },
        { kind: 'text', content: USER_TURN_FINAL },
        { kind: 'text', content: AUTO_REPLY },
      ])
      const bgRunId = await launchBackgroundRun(h.ctx)
      await completeRun(h.ctx, bgRunId)

      await waitFor(() => autoTurns(h.ctx).length === 1, 5000, 'auto turn persisted')

      const textEnvelope = h.webuiDeliveries.find(
        (e) => e.messageType === 'text' && e.content.text === AUTO_REPLY && e.recipient.sessionId === SESSION_ID,
      )
      expect(textEnvelope).toBeDefined()
      expect(textEnvelope!.recipient).toMatchObject({ userId: USER_ID, sessionId: SESSION_ID, channel: 'webui' })
      expect(h.extDeliveries).toHaveLength(0)
      await waitFor(
        () => h.sseEvents.some((e) => e.eventType === 'assistant_message' && e.content === AUTO_REPLY),
        5000,
        'webui SSE timeline event',
      )
    },
  )

  it(
    '(g) switch off: AUTO_CONTINUE_ON_BACKGROUND_COMPLETE=false disables the auto turn',
    { timeout: 30000 },
    async () => {
      process.env.AUTO_CONTINUE_ON_BACKGROUND_COMPLETE = 'false'
      const h = createHarness([
        { kind: 'tool', name: 'foreground_launch_subagent', args: { objective: LAUNCH_OBJECTIVE, background: true } },
        { kind: 'text', content: USER_TURN_FINAL },
      ])
      const bgRunId = await launchBackgroundRun(h.ctx)
      await completeRun(h.ctx, bgRunId)

      await settle(300)
      expect(autoTurns(h.ctx)).toHaveLength(0)
      expect(h.webuiDeliveries).toHaveLength(0)
      const bgRun = h.ctx.stores.backgroundRunStore.getById(bgRunId)
      expect(bgRun?.notificationDeliveredAt).toBeUndefined()
      const pending = h.ctx.stores.backgroundRunStore.getPendingNotifications(SESSION_ID)
      expect(pending.some((run) => run.backgroundRunId === bgRunId)).toBe(true)
    },
  )
})
