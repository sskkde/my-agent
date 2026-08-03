/**
 * Child task lifecycle SSE — integration tests (Todo 12 of
 * opencode-like-subagent-sessions).
 *
 * Proves, over the REAL Fastify API (createApiContext + createApiServer with
 * an injected scripted mock provider) + the REAL timeline broadcaster and
 * EventStore:
 *
 *   - the parent SSE stream receives the deterministic lifecycle sequence
 *     (run_started → run_completed) with stable metadata and NO child content
 *     or child token/tool events
 *   - the child SSE stream receives the child's own live events, scoped to the
 *     child session id (the child kernel runs with sessionId = childSessionId
 *     via the Todo 7 sessionId carrier)
 *   - lifecycle events are persisted to the EventStore with deterministic
 *     idempotency keys under the PARENT session, so a reconnect snapshot
 *     reconstructs the terminal task card exactly once
 *   - a throwing lifecycle broadcaster (observability failure) leaves the run
 *     successful and persistence intact
 *
 * The child task runtime is wired manually over the API context's stores and
 * broadcaster — Todo 17 owns the full createApiContext wiring.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { AddressInfo } from 'node:net'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import { createLLMAdapter, type LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMProvider, ProviderHealthStatus, ProviderStats } from '../../../src/llm/provider.js'
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js'
import type { CircuitBreaker } from '../../../src/llm/circuit-breaker.js'
import {
  createChildSessionTaskRuntime,
  type ChildSessionTaskRuntime,
  type ChildTaskLifecycleBroadcaster,
} from '../../../src/subagents/child-session-task-runtime.js'
import { createSubagentKernelAdapter } from '../../../src/subagents/kernel-adapter.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type { ConsoleTimelineEvent } from '../../../src/api/types.js'
import type { EventRecord } from '../../../src/storage/event-store.js'

const CHILD_INTERMEDIATE_TEXT = 'CHILD_INTERMEDIATE_THOUGHT_DRAFT_SENTINEL'
const CHILD_FINAL_TEXT = 'CHILD_FINAL_ANSWER_SENTINEL'

// ---------------------------------------------------------------------------
// Scripted mock provider — queue based; records every LLM request.
// ---------------------------------------------------------------------------

interface QueueEntry {
  content?: string
  delayMs?: number
}

class ScriptedLifecycleProvider implements LLMProvider {
  readonly id = 'mock'
  readonly queue: QueueEntry[] = []
  readonly requests: LLMRequest[] = []

  readonly config = {
    id: 'mock',
    name: 'Scripted Lifecycle Provider',
    enabled: true,
    priority: 1,
    timeoutMs: 60000,
    retries: 0,
    capabilities: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsVision: false,
      maxTokens: 65536,
      supportedModels: ['mock-model'],
    },
  }

  readonly circuitBreaker: CircuitBreaker = {
    get state() {
      return 'CLOSED' as const
    },
    get config() {
      return { failureThreshold: 5, resetTimeoutMs: 30000, successThreshold: 2 }
    },
    get stats() {
      return {
        state: 'CLOSED' as const,
        failureCount: 0,
        successCount: 0,
        totalRequests: 0,
        rejectedRequests: 0,
      }
    },
    recordSuccess: () => {},
    recordFailure: () => {},
    canExecute: () => true,
    reset: () => {},
    forceOpen: () => {},
    forceClose: () => {},
  }

  readonly health: ProviderHealthStatus = 'healthy'

  readonly stats: ProviderStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timeoutRequests: 0,
    averageLatencyMs: 0,
    healthStatus: 'healthy',
  }

  enqueue(entry: QueueEntry): void {
    this.queue.push(entry)
  }

  isHealthy(): boolean {
    return true
  }

  getStats(): ProviderStats {
    return { ...this.stats }
  }

  updateConfig(): void {}
  resetStats(): void {}

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.requests.push(request)
    const next = this.queue.shift()
    if (!next) {
      throw new Error(`Scripted provider out of queued responses (request ${this.requests.length})`)
    }
    if (next.delayMs && next.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs))
    }
    return {
      success: true,
      response: {
        id: `mock-${Date.now()}-${this.requests.length}`,
        model: request.model,
        content: next.content ?? '',
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: this.id,
    }
  }
}

// ---------------------------------------------------------------------------
// SSE helper — opens the real timeline stream and accumulates parsed frames.
// ---------------------------------------------------------------------------

interface SseFrame {
  type: string
  event?: ConsoleTimelineEvent
  token?: { sessionId?: string }
  events?: ConsoleTimelineEvent[]
  timestamp: string
}

class SseStream {
  private controller = new AbortController()
  private reader!: ReadableStreamDefaultReader<Uint8Array>
  raw = ''
  frames: SseFrame[] = []

  constructor(
    private baseUrl: string,
    private sessionId: string,
    private authCookie: string,
  ) {}

  async open(timeoutMs = 5000): Promise<void> {
    const timeout = setTimeout(() => this.controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/sessions/${this.sessionId}/timeline/stream`, {
        headers: { Cookie: this.authCookie },
        signal: this.controller.signal,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      this.reader = response.body!.getReader()
    } finally {
      clearTimeout(timeout)
    }
    void this.consume()
  }

  private async consume(): Promise<void> {
    const decoder = new TextDecoder()
    while (true) {
      let chunk: { done: boolean; value?: Uint8Array }
      try {
        chunk = await this.reader.read()
      } catch {
        break
      }
      if (chunk.done) break
      this.raw += decoder.decode(chunk.value, { stream: true })
      this.parseFrames()
    }
  }

  private parseFrames(): void {
    const blocks = this.raw.split('\n\n')
    this.raw = blocks.pop() ?? ''
    for (const block of blocks) {
      const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      try {
        this.frames.push(JSON.parse(dataLine.slice('data: '.length)) as SseFrame)
      } catch {
        // partial/empty data frame — ignore
      }
    }
  }

  async until(predicate: (frames: SseFrame[]) => boolean, timeoutMs: number, label: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate(this.frames)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out waiting for: ${label}`)
  }

  async close(): Promise<void> {
    this.controller.abort()
    try {
      await this.reader.cancel()
    } catch {
      // stream may already be closed
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures / harness
// ---------------------------------------------------------------------------

function makeParentBundle(userId: string): ContextBundle {
  return {
    bundleId: 'bundle-parent',
    runId: 'krun_parent',
    agentId: 'main.foreground.default',
    agentType: 'main',
    userId,
    invocationSource: 'gateway_intent',
    pinnedItems: [],
    orderedItems: [],
    tokenEstimate: 100,
  }
}

describe('Child task lifecycle SSE (Todo 12)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let context: ApiContext
  let authCookie: string
  let ownerUserId: string
  let provider: ScriptedLifecycleProvider
  let sessionSeq = 0

  beforeAll(async () => {
    provider = new ScriptedLifecycleProvider()
    const llmAdapter: LLMAdapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 60000,
      enableCircuitBreaker: false,
      enableLogging: false,
    })
    llmAdapter.addProvider(provider)

    const ctx = createApiContext({ dbPath: ':memory:', llmAdapter })
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`)
    }
    context = ctx
    server = await createApiServer(context)
    await server.listen({ port: 0 })
    const address = server.server.address() as AddressInfo | null
    baseUrl = `http://localhost:${address?.port ?? 0}`

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    })
    expect(setupResponse.status).toBe(201)
    authCookie = setupResponse.headers.get('set-cookie')!

    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, { headers: { Cookie: authCookie } })
    expect(meRes.status).toBe(200)
    const meBody = (await meRes.json()) as { data: { user: { userId: string } } }
    ownerUserId = meBody.data.user.userId

    context.providerConfigStore.create({
      providerId: 'mock',
      userId: ownerUserId,
      providerType: 'mock',
      displayName: 'Mock',
      enabled: true,
      selectedModel: 'mock-model',
    })
  }, 60000)

  afterAll(async () => {
    await server.close()
    context.connection.close()
  })

  function createParentSession(): string {
    const sessionId = `sess_parent_t12_${Date.now()}_${sessionSeq++}`
    context.stores.sessionStore.create({ sessionId, userId: ownerUserId, title: 'Parent' })
    return sessionId
  }

  function createChildRuntime(extra?: {
    lifecycleBroadcaster?: ChildTaskLifecycleBroadcaster
  }): ChildSessionTaskRuntime {
    const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()
    const adapter = createSubagentKernelAdapter({
      agentKernel: context.agentKernel,
      subagentRegistry: context.subagentRegistry,
      providerConfigStore: context.providerConfigStore,
      agentConfigStore: context.agentConfigStore,
      sessionStore: context.stores.sessionStore,
      toolRegistry: context.toolRegistry,
      envelopeRegistry,
    })
    return createChildSessionTaskRuntime({
      sessionStore: context.stores.sessionStore,
      runStore: context.subagentRunStore,
      transcriptStore: context.subagentTranscriptStore,
      kernelAdapter: adapter,
      registry: context.subagentRegistry,
      toolRegistry: context.toolRegistry,
      envelopeRegistry,
      eventStore: context.stores.eventStore,
      lifecycleBroadcaster: extra?.lifecycleBroadcaster ?? context.timelineBroadcaster,
      defaultMaxIterations: 4,
      defaultTimeoutMs: 30000,
    })
  }

  function launchTaskSpec(parentSessionId: string) {
    return {
      objective: 'Synthesize the quarterly report',
      profileId: 'document_processor',
      parentSessionId,
      launchMode: 'foreground' as const,
      maxIterations: 4,
      timeoutMs: 30000,
    }
  }

  function persistedLifecycleEvents(sessionId: string): EventRecord[] {
    return context.stores.eventStore
      .query({ sessionId })
      .filter((e) =>
        ['run_started', 'run_progress', 'run_completed', 'run_failed', 'run_cancelled'].includes(e.eventType),
      )
  }

  it(
    'parent stream receives the deterministic lifecycle sequence (no child content); child stream receives child-scoped live events',
    { timeout: 60000 },
    async () => {
      const parentSessionId = createParentSession()
      const runtime = createChildRuntime()

      // Open the PARENT stream first so the run_started broadcast is live.
      const parentStream = new SseStream(baseUrl, parentSessionId, authCookie)
      await parentStream.open()
      await parentStream.until((f) => f.some((fr) => fr.type === 'snapshot'), 5000, 'parent snapshot')

      const launch = runtime.launchTask({
        parentContext: makeParentBundle(ownerUserId),
        taskSpec: launchTaskSpec(parentSessionId),
        depth: 1,
        launchesInParentTurn: 0,
      })
      expect(launch.taskId).toBe(launch.childSessionId)

      // The child session now exists — open the CHILD stream before executing.
      const childStream = new SseStream(baseUrl, launch.childSessionId, authCookie)
      await childStream.open()
      await childStream.until((f) => f.some((fr) => fr.type === 'snapshot'), 5000, 'child snapshot')

      provider.enqueue({ content: CHILD_INTERMEDIATE_TEXT })
      provider.enqueue({ content: CHILD_FINAL_TEXT })

      const result = await runtime.executeRun(launch.subagentRunId)
      expect(result.status).toBe('completed')

      await parentStream.until(
        (f) => f.some((fr) => fr.type === 'timeline_event' && fr.event?.eventType === 'run_completed'),
        15000,
        'parent run_completed',
      )
      await childStream.until((f) => f.some((fr) => fr.type === 'token_stream'), 15000, 'child token stream')

      // ---- Parent: deterministic lifecycle sequence only.
      const parentEvents = parentStream.frames.filter((fr) => fr.type === 'timeline_event').map((fr) => fr.event!)
      expect(parentEvents.map((e) => e.eventType)).toEqual(['run_started', 'run_completed'])

      const started = parentEvents[0]!
      const completed = parentEvents[1]!
      for (const event of [started, completed]) {
        expect(event.sessionId).toBe(parentSessionId)
        expect(event.metadata?.taskId).toBe(launch.taskId)
        expect(event.metadata?.childSessionId).toBe(launch.childSessionId)
        expect(event.metadata?.runId).toBe(launch.subagentRunId)
        expect(event.metadata?.agentProfile).toBe('document_processor')
        expect(event.metadata?.launchMode).toBe('foreground')
      }
      expect(started.eventType).toBe('run_started')
      expect(started.metadata?.status).toBe('running')
      expect(completed.eventType).toBe('run_completed')
      expect(completed.metadata?.status).toBe('completed')

      // ---- Parent: NO child content, NO child token/tool events.
      expect(parentStream.frames.some((fr) => fr.type === 'token_stream')).toBe(false)
      const parentRaw = JSON.stringify(parentStream.frames)
      expect(parentRaw).not.toContain(CHILD_INTERMEDIATE_TEXT)
      expect(parentRaw).not.toContain(CHILD_FINAL_TEXT)

      // ---- Child: live events are child-scoped (kernel sessionId = childSessionId).
      const childTokens = childStream.frames.filter((fr) => fr.type === 'token_stream')
      expect(childTokens.length).toBeGreaterThan(0)
      for (const frame of childTokens) {
        expect(frame.token?.sessionId).toBe(launch.childSessionId)
      }
      expect(childStream.frames.some((fr) => fr.type === 'timeline_event')).toBe(false)

      // ---- Persistence: deterministic idempotency keys under the PARENT session,
      //      and broadcast eventIds equal the persisted ones.
      const persisted = persistedLifecycleEvents(parentSessionId)
      expect(persisted.map((e) => e.eventType)).toEqual(['run_started', 'run_completed'])
      expect(persisted[0]!.idempotencyKey).toBe(`child-task-lifecycle:${launch.taskId}:started`)
      expect(persisted[1]!.idempotencyKey).toBe(`child-task-lifecycle:${launch.taskId}:completed`)
      expect(started.eventId).toBe(persisted[0]!.eventId)
      expect(completed.eventId).toBe(persisted[1]!.eventId)
      // The child session never received the parent-scoped lifecycle events.
      expect(persistedLifecycleEvents(launch.childSessionId)).toHaveLength(0)

      await parentStream.close()
      await childStream.close()
    },
  )

  it(
    'reconnect snapshot reconstructs the terminal task card exactly once from persisted events',
    { timeout: 60000 },
    async () => {
      const parentSessionId = createParentSession()
      const runtime = createChildRuntime()

      const launch = runtime.launchTask({
        parentContext: makeParentBundle(ownerUserId),
        taskSpec: launchTaskSpec(parentSessionId),
        depth: 1,
        launchesInParentTurn: 0,
      })
      provider.enqueue({ content: CHILD_FINAL_TEXT })
      const result = await runtime.executeRun(launch.subagentRunId)
      expect(result.status).toBe('completed')

      // Disconnect + reconnect: the fresh snapshot is rebuilt from the EventStore
      // and reconstructs ONE terminal task card (started + completed).
      const stream = new SseStream(baseUrl, parentSessionId, authCookie)
      await stream.open()
      await stream.until((f) => f.some((fr) => fr.type === 'snapshot'), 5000, 'reconnect snapshot')

      const snapshot = stream.frames.find((fr) => fr.type === 'snapshot')
      const lifecycle = (snapshot?.events ?? []).filter((e) => e.eventType.startsWith('run_'))
      // Snapshot sorts newest-first (DESC) — the terminal card is reconstructed
      // from BOTH persisted events, exactly one of each.
      expect(lifecycle.map((e) => e.eventType).sort()).toEqual(['run_completed', 'run_started'])
      expect(lifecycle).toHaveLength(2)
      for (const event of lifecycle) {
        expect(event.metadata?.taskId).toBe(launch.taskId)
        expect(event.metadata?.childSessionId).toBe(launch.childSessionId)
        expect(event.metadata?.runId).toBe(launch.subagentRunId)
        expect(event.metadata?.agentProfile).toBe('document_processor')
        expect(event.metadata?.launchMode).toBe('foreground')
      }
      expect(JSON.stringify(snapshot)).not.toContain(CHILD_INTERMEDIATE_TEXT)

      await stream.close()
    },
  )

  it(
    'a throwing lifecycle broadcaster (observability failure) leaves the run successful and persistence intact',
    { timeout: 60000 },
    async () => {
      const parentSessionId = createParentSession()
      const runtime = createChildRuntime({
        lifecycleBroadcaster: {
          broadcast: () => {
            throw new Error('observability broadcast boom')
          },
        },
      })

      const launch = runtime.launchTask({
        parentContext: makeParentBundle(ownerUserId),
        taskSpec: launchTaskSpec(parentSessionId),
        depth: 1,
        launchesInParentTurn: 0,
      })
      provider.enqueue({ content: CHILD_FINAL_TEXT })

      // Broadcast throws on BOTH the started and the completed emission — the
      // run must still complete successfully and persist every event.
      const result = await runtime.executeRun(launch.subagentRunId)
      expect(result.status).toBe('completed')
      expect(result.response).toBe(CHILD_FINAL_TEXT)

      const runs = context.subagentRunStore.query({ taskId: launch.taskId })
      expect(runs).toHaveLength(1)
      expect(runs[0]!.status).toBe('completed')

      const persisted = persistedLifecycleEvents(parentSessionId)
      expect(persisted.map((e) => e.eventType)).toEqual(['run_started', 'run_completed'])
    },
  )
})
