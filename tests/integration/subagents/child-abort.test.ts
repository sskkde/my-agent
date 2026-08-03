/**
 * Child Abort Integration Test
 *
 * Regression coverage for Todo 4 (opencode-like-subagent-sessions):
 *  1. HTTP cancel-active-run actually fires the live AbortSignal (abort registry
 *     key consistency — correlationId vs internal kr-... runId).
 *  2. The dispatcher's RuntimeAdapterExecutionContext.signal is threaded through
 *     SubagentRuntime/KernelAdapter into KernelRunInput.signal, so the child
 *     kernel's existing signal checks abort a held-open child LLM request.
 *  3. Parent cancellation cascades to the descendant child subagent run.
 *  4. Late terminal writes are idempotent: a second cancel against an
 *     already-terminal session is a safe not-found, and no worker-loop
 *     exception is thrown.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import { createLLMAdapter } from '../../../src/llm/adapter.js'
import type {
  LLMProvider,
  ProviderHealthStatus,
  ProviderStats,
} from '../../../src/llm/provider.js'
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js'
import type { CircuitBreaker } from '../../../src/llm/circuit-breaker.js'

const PARENT_TEXT_RESPONSE = 'Parent final answer after child cancellation.'

/**
 * Scripted LLM provider:
 *  - call 1 (parent): returns a tool_call for foreground_launch_subagent.
 *  - call 2 (child): HOLDS OPEN (never resolves) until releaseChild() is called.
 *  - call 3+ (parent again): returns plain text.
 *
 * Only `complete()` is implemented; the LLMAdapter falls back to it for
 * streaming, so both the streaming and non-streaming kernel paths hang on the
 * child request and can only be released via the AbortSignal.
 */
class ScriptedChildAbortProvider implements LLMProvider {
  readonly id = 'mock'
  callCount = 0
  childStarted = false
  childReleased = false
  private readonly hangResolvers: Array<() => void> = []

  readonly config = {
    id: 'mock',
    name: 'Scripted Child Abort Provider',
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

  isHealthy(): boolean {
    return true
  }

  getStats(): ProviderStats {
    return { ...this.stats }
  }

  updateConfig(): void {}
  resetStats(): void {}

  releaseChild(): void {
    this.childReleased = true
    for (const resolve of this.hangResolvers) resolve()
  }

  private parentLaunchResponse(request: LLMRequest): LLMResult {
    return {
      success: true,
      response: {
        id: `mock-${Date.now()}`,
        model: request.model,
        content: '',
        role: 'assistant',
        finishReason: 'tool_calls',
        toolCalls: [
          {
            id: 'call_launch_1',
            type: 'function',
            function: {
              name: 'foreground_launch_subagent',
              arguments: JSON.stringify({ objective: 'research the topic', agentType: 'research_processor' }),
            },
          },
        ],
        createdAt: new Date().toISOString(),
      },
      providerId: this.id,
    }
  }

  private textResponse(request: LLMRequest): LLMResult {
    return {
      success: true,
      response: {
        id: `mock-${Date.now()}`,
        model: request.model,
        content: PARENT_TEXT_RESPONSE,
        role: 'assistant',
        finishReason: 'stop',
        createdAt: new Date().toISOString(),
      },
      providerId: this.id,
    }
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.callCount++

    if (this.callCount === 1) {
      return this.parentLaunchResponse(request)
    }

    if (this.callCount === 2) {
      // Child LLM request: hold open until released.
      this.childStarted = true
      await new Promise<void>((resolve) => this.hangResolvers.push(resolve))
      this.childReleased = true
      // If released without abort (should not happen in the happy path), return text.
      return this.textResponse(request)
    }

    return this.textResponse(request)
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

describe('Child subagent cancellation via cancel-active-run', () => {
  let server: FastifyInstance
  let baseUrl: string
  let apiContext: ApiContext
  let authCookie: string
  let sessionId: string
  let provider: ScriptedChildAbortProvider

  async function post(path: string, body: unknown, options: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify(body),
      ...options,
    })
  }

  beforeAll(async () => {
    provider = new ScriptedChildAbortProvider()
    const llmAdapter = createLLMAdapter({
      providers: [],
      defaultTimeoutMs: 60000,
      enableCircuitBreaker: false,
      enableLogging: false,
    })
    llmAdapter.addProvider(provider)

    const ctx = createApiContext({
      dbPath: ':memory:',
      llmAdapter,
    })
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`)
    }
    apiContext = ctx

    server = await createApiServer(apiContext)
    await server.listen({ port: 0 })
    const address = server.server.address()
    baseUrl = `http://localhost:${(address as any).port}`

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'testpassword123' }),
    })
    expect(setupResponse.status).toBe(201)
    authCookie = setupResponse.headers.get('set-cookie')!
    await setupResponse.text()
  })

  afterAll(async () => {
    // Release any still-hanging child request so the worker loop can unwind.
    provider.releaseChild()
    try {
      server.server.closeAllConnections?.()
    } catch {
      /* ignore */
    }
    try {
      await server.close()
    } catch {
      /* ignore */
    }
    if (apiContext && 'connection' in apiContext) {
      ;(apiContext as any).connection.close()
    }
  })

  it('aborts a live child LLM request and marks parent/child runs cancelled exactly once', async () => {
    const createResponse = await post('/api/v1/sessions', {})
    expect(createResponse.status).toBe(201)
    const createBody = (await createResponse.json()) as any
    sessionId = createBody.data.session.sessionId

    // Seed a provider for the REAL owner of the session (userId is a random UUID)
    // so child subagent provider resolution succeeds deterministically.
    const persistedSession = apiContext.stores.sessionStore.getById(sessionId)!
    apiContext.providerConfigStore.create({
      providerId: 'mock',
      userId: persistedSession.userId,
      providerType: 'mock',
      displayName: 'Mock',
      enabled: true,
      selectedModel: 'mock-model',
    })

    // Seed a session-level provider/model so subagent provider resolution is deterministic.
    apiContext.stores.sessionStore.setModel(sessionId, 'mock-model', 'mock')

    const messageResponse = await post(`/api/v1/sessions/${sessionId}/messages`, {
      text: 'research this topic please',
    })
    expect(messageResponse.status).toBe(202)
    await messageResponse.text()

    // Wait until the child kernel's LLM request is actually held open.
    await waitFor(() => provider.childStarted, 10000, 'child LLM request to be held open')

    // Confirm the child subagent run exists and is non-terminal before cancel.
    const childRunsBefore = apiContext.subagentRunStore.query({})
    expect(childRunsBefore.length).toBe(1)
    expect(childRunsBefore[0]!.status).not.toBe('cancelled')

    // HTTP cancel should fire the live AbortSignal (not just flip a DB status).
    const cancelResponse = await post(`/api/v1/sessions/${sessionId}/cancel-active-run`, {})
    expect(cancelResponse.status).toBe(200)
    const cancelBody = (await cancelResponse.json()) as any
    expect(cancelBody.data.status).toBe('cancelled')

    // The child run must reach cancelled WITHOUT the held LLM request resolving.
    await waitFor(
      () => apiContext.subagentRunStore.query({})[0]?.status === 'cancelled',
      10000,
      'child subagent run to become cancelled',
    )
    expect(provider.childReleased).toBe(false)
    expect(provider.callCount).toBe(2)

    // Parent kernel run (session task state) cancelled exactly once.
    const parentRuns = apiContext.stores.kernelRunStore.getBySession(sessionId)
    expect(parentRuns.length).toBe(1)
    expect(parentRuns[0]!.status).toBe('cancelled')

    // Child subagent result is cancelled (not failed/completed).
    const childRun = apiContext.subagentRunStore.query({})[0]!
    const childResult = apiContext.subagentRuntime.getSubagentResult(childRun.subagentRunId)
    expect(childResult?.status).toBe('cancelled')
    expect(childResult?.error?.code).toBe('CANCELLED')

    // Late terminal writes must not overwrite the cancelled state.
    const parentRunAfter = apiContext.stores.kernelRunStore.getBySession(sessionId)
    expect(parentRunAfter[0]!.status).toBe('cancelled')

    // A second cancel against the now-terminal session is a safe idempotent 404.
    const secondCancelResponse = await post(`/api/v1/sessions/${sessionId}/cancel-active-run`, {})
    expect(secondCancelResponse.status).toBe(404)
    await secondCancelResponse.text()
  })

  it('returns safe not-found for a nonexistent session cancel', async () => {
    const missingResponse = await post('/api/v1/sessions/sess_does_not_exist/cancel-active-run', {})
    expect(missingResponse.status).toBe(404)
    await missingResponse.text()
  })
})
