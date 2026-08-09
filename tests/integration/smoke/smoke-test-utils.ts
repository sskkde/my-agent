import { vi, expect } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import { createApiServer } from '../../../src/api/server.js'
import type { ForegroundDecision } from '../../../src/foreground/types.js'
import type { LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMRequest } from '../../../src/llm/types.js'

export interface SmokeHarness {
  baseCtx: ApiContext
  testCtx: ApiContext
  server: FastifyInstance
  baseUrl: string
  authCookie: string
  userId: string
  originalOpenRouterApiKey?: string
}

function createSafeEventStore(eventStore: ApiContext['stores']['eventStore']): ApiContext['stores']['eventStore'] {
  return {
    append: (eventOrEvents) => {
      const events = Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]
      const normalized = events.map((event) => ({
        ...event,
        payload: event.payload ?? {},
      }))
      eventStore.append(Array.isArray(eventOrEvents) ? normalized : normalized[0]!)
    },
    query: (filters) => eventStore.query(filters),
    findByCorrelationId: (correlationId) => eventStore.findByCorrelationId(correlationId),
    findByCausationId: (causationId) => eventStore.findByCausationId(causationId),
    updateUserIdForSession: (sessionId, newUserId) => eventStore.updateUserIdForSession(sessionId, newUserId),
  }
}

export function createStubbedForegroundAgent(
  decision: ForegroundDecision,
  stores?: ApiContext['stores'],
): ApiContext['foregroundAgent'] {
  return {
    runTurn: vi.fn().mockImplementation(async (input: { userId: string; sessionId: string }) => {
      const now = new Date().toISOString()

      if (decision.route === 'spawn_planner' && stores) {
        const planId = `plan-smoke-${Date.now()}`
        const plannerRunId = `pl-run-smoke-${Date.now()}`

        stores.planStore.createPlan({
          planId,
          userId: input.userId,
          sessionId: input.sessionId,
          objective: decision.reason ?? 'Smoke test plan',
          status: 'draft',
          currentVersion: 1,
          plannerRunIds: [plannerRunId],
          steps: [
            { stepId: 'step-1', description: 'Analyze objective', status: 'pending' },
            { stepId: 'step-2', description: 'Execute actions', status: 'pending' },
            { stepId: 'step-3', description: 'Summarize results', status: 'pending' },
          ],
          createdAt: now,
          updatedAt: now,
        })

        stores.plannerRunStore.create({
          plannerRunId,
          planId,
          userId: input.userId,
          sessionId: input.sessionId,
          status: 'initializing',
          checkpoint: null,
          createdAt: now,
          updatedAt: now,
        })
      }

      if (decision.route === 'dispatch_tool' && stores) {
        const toolCallId = `tc-smoke-${Date.now()}`
        const actionId = `action-${Date.now()}`

        stores.runtimeActionStore.save({
          actionId,
          actionType: 'execute_tool',
          source: { sourceModule: 'foreground' },
          targetRuntime: 'local',
          targetAction: 'execute_tool',
          payload: {
            toolName: decision.suggestedTools?.[0] ?? 'docs_search',
            toolCallId,
          },
          sessionId: input.sessionId,
          userId: input.userId,
          status: 'completed',
          createdAt: now,
          updatedAt: now,
        })

        stores.toolExecutionStore.create({
          toolCallId,
          toolName: decision.suggestedTools?.[0] ?? 'docs_search',
          userId: input.userId,
          sessionId: input.sessionId,
          status: 'completed',
          sensitivity: 'low',
        })
      }

      return {
        status: 'completed' as const,
        finalResponse: decision.userVisibleResponse ?? '',
        decisionTrace: decision,
      }
    }),
  } as unknown as ApiContext['foregroundAgent']
}

export function createMockLlmAdapter(options: { enableToolCall?: boolean } = {}): LLMAdapter {
  let toolCallReturned = false

  return {
    providers: [{ providerId: 'smoke-provider' }],
    complete: vi.fn(async (request: LLMRequest) => {
      const hasTools = request.tools && request.tools.length > 0

      if (options.enableToolCall && hasTools && !toolCallReturned) {
        const firstTool = request.tools![0]
        const toolCallId = `tc-smoke-${Date.now()}`
        const args = firstTool.function.name === 'docs_search' ? JSON.stringify({ query: 'smoke test query' }) : '{}'
        toolCallReturned = true
        return {
          success: true,
          response: {
            id: 'smoke-llm-response',
            content: '',
            finishReason: 'tool_calls' as const,
            toolCalls: [
              {
                id: toolCallId,
                type: 'function' as const,
                function: {
                  name: firstTool.function.name,
                  arguments: args,
                },
              },
            ],
          },
          usage: {
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
          },
        }
      }

      return {
        success: true,
        response: {
          id: 'smoke-llm-response',
          content: 'Smoke kernel response',
          finishReason: 'stop' as const,
        },
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
        },
      }
    }),
    getProviderHealth: vi.fn().mockReturnValue({ healthy: true }),
  } as unknown as LLMAdapter
}

export async function createSmokeHarness(options: {
  username: string
  foregroundDecision?: ForegroundDecision
  enableToolCall?: boolean
}): Promise<SmokeHarness> {
  const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY ??= 'smoke-test-key'

  const baseCtx = createApiContext({ dbPath: ':memory:' })
  if (isApiContextError(baseCtx)) {
    throw new Error(`Failed to create base context: ${baseCtx.message}`)
  }

  const testCtx = createApiContext({
    dbPath: ':memory:',
    existingStores: {
      ...baseCtx.stores,
      eventStore: createSafeEventStore(baseCtx.stores.eventStore),
    },
    foregroundAgent: options.foregroundDecision
      ? createStubbedForegroundAgent(options.foregroundDecision, baseCtx.stores)
      : undefined,
    timelineBroadcaster: baseCtx.timelineBroadcaster,
    channelRegistry: baseCtx.channelRegistry,
    llmAdapter: createMockLlmAdapter({ enableToolCall: options.enableToolCall }),
  })
  if (isApiContextError(testCtx)) {
    throw new Error(`Failed to create test context: ${testCtx.message}`)
  }

  const server = await createApiServer(testCtx)
  await server.listen()
  const address = server.server.address()
  const baseUrl = `http://localhost:${(address as { port: number }).port}`

  const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: options.username, password: 'password123' }),
  })
  expect(setupResponse.status).toBe(201)
  const authCookie = setupResponse.headers.get('set-cookie')
  expect(authCookie).toBeTruthy()

  const users = baseCtx.stores.userStore.list()
  const user = users.find((candidate) => candidate.username === options.username)
  expect(user).toBeDefined()

  return {
    baseCtx,
    testCtx,
    server,
    baseUrl,
    authCookie: authCookie!,
    userId: user!.userId,
    originalOpenRouterApiKey,
  }
}

export async function closeSmokeHarness(harness: SmokeHarness): Promise<void> {
  try {
    await harness.server.close()
    harness.testCtx.connection.close()
    harness.baseCtx.connection.close()
  } finally {
    if (harness.originalOpenRouterApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY
    } else {
      process.env.OPENROUTER_API_KEY = harness.originalOpenRouterApiKey
    }
  }
}

export async function createSession(harness: SmokeHarness): Promise<string> {
  const response = await fetch(`${harness.baseUrl}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: harness.authCookie },
    body: JSON.stringify({}),
  })
  expect(response.status).toBe(201)
  const body = (await response.json()) as { data: { session: { sessionId: string } } }
  return body.data.session.sessionId
}

export async function waitForCondition(
  assertion: () => void,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15000
  const intervalMs = options.intervalMs ?? 50
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }

  if (lastError instanceof Error) {
    throw lastError
  }
  throw new Error('Condition was not met before timeout')
}
