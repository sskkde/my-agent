/**
 * Planner auto-execution E2E via the real API + real mock LLM provider.
 *
 * Proves the auto-closing planner loop through the real HTTP surface:
 *
 *   user message → foreground_spawn_planner (creates run + enqueues background)
 *     → background worker → planner child
 *       → LLM plan generation (mock returns structured plan JSON)
 *       → setPlanSteps (plan_store gets real steps)
 *       → child kernel loop executes, marking steps via internal handlers
 *       → complete → planner_runs COMPLETED, plans.steps all completed
 *
 * and that:
 *   - `status_query` reports REAL progress (0% → 100%), never '50%';
 *   - the resume contract still returns plan context (retained capability);
 *   - no foreground mark_step/complete tool calls are needed anymore.
 *
 * Harness: real `createApiContext` (:memory: SQLite) + real Fastify server +
 * real provider resolution for `providerType: 'mock'`. NODE_ENV='development'
 * so the background worker starts and the provider-scoped adapter resolves DB
 * mock configs (same pattern as the legacy foreground-driven e2e).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import { getMockProviderRegistry, type MockResponseConfig } from '../../../src/llm/mock-provider-registry.js'
import { createStatusQueryTool } from '../../../src/tools/builtins/status-query.js'
import type { ToolExecutionContext } from '../../../src/tools/types.js'
import { PLANNER_STATES } from '../../../src/shared/states.js'

const FINAL_ANSWER = 'E2E_PLANNER_AUTO_LOOP_FINAL_ANSWER'

const TEST_ENCRYPTION_KEY = 't7-test-encryption-key-32-bytes-minimum!!'

const GENERATED_PLAN_JSON = JSON.stringify({
  id: 'plan_e2e',
  goal: '生成工作区报告',
  steps: [
    {
      id: 'step_001',
      kind: 'tool_call',
      title: '搜索趋势',
      description: '搜索 AI agent 最新发展趋势',
      executor: 'agent_kernel',
      toolName: 'web_search',
    },
    {
      id: 'step_002',
      kind: 'final_response',
      title: '总结',
      description: '汇总搜索要点',
      executor: 'foreground',
    },
  ],
  successCriteria: ['搜索完成', '汇总输出'],
})

function spawnResponse(objective: string): MockResponseConfig {
  return {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [
      {
        name: 'foreground_spawn_planner',
        arguments: JSON.stringify({ objective }),
      },
    ],
  }
}

function planGenerationResponse(): MockResponseConfig {
  return { content: GENERATED_PLAN_JSON, finishReason: 'stop' }
}

function markStepResponse(plannerRunId: string, stepId: string): MockResponseConfig {
  return {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [
      {
        name: 'foreground_mark_planner_step',
        arguments: JSON.stringify({ plannerRunId, stepId, status: 'completed' }),
      },
    ],
  }
}

function completePlannerResponse(plannerRunId: string): MockResponseConfig {
  return {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [
      {
        name: 'foreground_complete_planner',
        arguments: JSON.stringify({ plannerRunId, summary: 'E2E auto loop summary' }),
      },
    ],
  }
}

function textResponse(content: string): MockResponseConfig {
  return { content, finishReason: 'stop' }
}

// ─── Harness ────────────────────────────────────────────────────────────────

describe('Planner auto-execution E2E (real API + providerType mock)', () => {
  let server: FastifyInstance
  let baseUrl: string
  let ctx: ApiContext
  let authCookie: string
  let sessionId: string
  let userId: string
  let savedNodeEnv: string | undefined
  let hadSecretKey: string | undefined

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  function authenticatedPost(path: string, body: unknown): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: authCookie },
      body: JSON.stringify(body),
    })
  }

  async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (predicate()) return
      await sleep(25)
    }
    throw new Error(`Timed out waiting for: ${label}`)
  }

  function queryProgressTool(): ReturnType<typeof createStatusQueryTool> {
    return createStatusQueryTool({
      plannerRunStore: ctx.stores.plannerRunStore,
      planStore: ctx.stores.planStore,
    })
  }

  async function queryProgress(plannerRunId: string): Promise<{ status: string; progress?: string }> {
    const tool = queryProgressTool()
    const context = { userId } as ToolExecutionContext
    const result = await tool.handler({ targetId: plannerRunId }, context)
    const data = result.data as {
      activeWork: { plannerRuns: Array<{ status: string; progress?: string }> }
    }
    return data.activeWork.plannerRuns[0] ?? { status: 'missing' }
  }

  function lastTerminalRunStatus(): string | undefined {
    const runs = ctx.stores.kernelRunStore.getBySession(sessionId)
    if (runs.length === 0) return undefined
    const last = runs[runs.length - 1]!
    return ['completed', 'failed', 'cancelled', 'timeout'].includes(last.status) ? last.status : undefined
  }

  async function waitForTurnComplete(baselineRunCount: number, timeoutMs: number, label: string): Promise<void> {
    await waitFor(
      () => {
        const runs = ctx.stores.kernelRunStore.getBySession(sessionId)
        return runs.length > baselineRunCount && lastTerminalRunStatus() !== undefined
      },
      timeoutMs,
      label,
    )
  }

  beforeAll(async () => {
    savedNodeEnv = process.env.NODE_ENV
    hadSecretKey = process.env.APP_SECRET_KEY
    process.env.NODE_ENV = 'development'
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY

    const contextResult = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(contextResult)) {
      throw new Error(`Failed to create API context: ${contextResult.message}`)
    }
    ctx = contextResult

    server = await createApiServer(ctx)
    await server.listen({ port: 0 })
    const address = server.server.address()
    baseUrl = `http://localhost:${(address as { port: number }).port}`

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'testpassword123' }),
    })
    expect(setupResponse.status).toBe(201)
    authCookie = setupResponse.headers.get('set-cookie')!
    await setupResponse.text()

    const createSessionResponse = await authenticatedPost('/api/v1/sessions', {})
    expect(createSessionResponse.status).toBe(201)
    const createSessionBody = (await createSessionResponse.json()) as {
      data: { session: { sessionId: string; userId: string } }
    }
    sessionId = createSessionBody.data.session.sessionId
    userId = createSessionBody.data.session.userId

    ctx.providerConfigStore.create({
      providerId: 'mock',
      userId,
      providerType: 'mock',
      displayName: 'Mock',
      enabled: true,
      selectedModel: 'mock-model',
    })
    ctx.stores.sessionStore.setModel(sessionId, 'mock-model', 'mock')

    getMockProviderRegistry().reset()
  }, 60000)

  afterAll(async () => {
    getMockProviderRegistry().reset()
    const settleDeadline = Date.now() + 5000
    let lastInteractionCount = -1
    while (Date.now() < settleDeadline) {
      const interactionCount = getMockProviderRegistry().getInteractions().length
      if (interactionCount === lastInteractionCount) {
        await sleep(200)
        if (getMockProviderRegistry().getInteractions().length === interactionCount) break
      }
      lastInteractionCount = interactionCount
      await sleep(100)
    }
    try {
      server?.server.closeAllConnections?.()
    } catch {
      /* ignore */
    }
    try {
      await server?.close()
    } catch {
      /* ignore */
    }
    if (ctx && 'connection' in ctx) {
      ;(ctx as { connection: { close: () => void } }).connection.close()
    }
    if (savedNodeEnv !== undefined) {
      process.env.NODE_ENV = savedNodeEnv
    } else {
      delete process.env.NODE_ENV
    }
    if (hadSecretKey !== undefined) {
      process.env.APP_SECRET_KEY = hadSecretKey
    } else {
      delete process.env.APP_SECRET_KEY
    }
  })

  it(
    'spawn → background child generates plan → executes → writes back → run COMPLETED, real progress',
    { timeout: 90000 },
    async () => {
      const registry = getMockProviderRegistry()
      registry.reset()

      // Watcher: once the spawn tool creates the planner run, append the
      // background-child response sequence (plan generation + mark/complete
      // internal handlers) to the shared queue.
      const snapshots: string[] = []
      let plannerRunId = ''
      let stage: 'spawn' | 'plan' | 'mark1' | 'mark2' | 'complete' | 'done' = 'spawn'
      const completedSteps = (): number => {
        const run = ctx.stores.plannerRunStore.getById(plannerRunId)
        const plan = run ? ctx.stores.planStore.getPlan(run.planId) : null
        return plan?.steps.filter((step) => step.status === 'completed').length ?? 0
      }
      const snapshot = async (): Promise<void> => {
        snapshots.push((await queryProgress(plannerRunId)).progress ?? 'missing')
      }

      const watcher = (async () => {
        const deadline = Date.now() + 45000
        while (Date.now() < deadline) {
          if (stage === 'spawn') {
            const runs = ctx.stores.plannerRunStore.findByUser(userId)
            const planning = runs.find((run) => run.status === PLANNER_STATES.PLANNING)
            if (planning) {
              plannerRunId = planning.plannerRunId
              registry.setResponseQueue([
                ...registry.getResponseQueue(),
                planGenerationResponse(),
                markStepResponse(plannerRunId, 'step_001'),
                markStepResponse(plannerRunId, 'step_002'),
                completePlannerResponse(plannerRunId),
                textResponse('child done'),
              ])
              stage = 'plan'
            }
          } else if (stage === 'plan') {
            const run = ctx.stores.plannerRunStore.getById(plannerRunId)
            const plan = run ? ctx.stores.planStore.getPlan(run.planId) : null
            if (plan && plan.steps.some((step) => step.stepId.startsWith('step_00'))) {
              await snapshot() // generated plan replaced placeholder
              stage = 'mark1'
            }
          } else if (stage === 'mark1' && completedSteps() >= 1) {
            await snapshot() // 50%
            stage = 'mark2'
          } else if (stage === 'mark2' && completedSteps() >= 2) {
            await snapshot() // 100%
            stage = 'complete'
          } else if (stage === 'complete') {
            const run = ctx.stores.plannerRunStore.getById(plannerRunId)
            if (run?.status === PLANNER_STATES.COMPLETED) {
              await snapshot() // still 100%
              stage = 'done'
            }
          }
          if (stage === 'done') return
          await sleep(5)
        }
        throw new Error(`auto-loop watcher timed out at stage=${stage}`)
      })()

      // Fire the real message turn: spawn only (no manual mark/complete).
      registry.setResponseQueue([spawnResponse('生成工作区报告'), textResponse(FINAL_ANSWER)])
      const kernelRunsBefore = ctx.stores.kernelRunStore.getBySession(sessionId).length
      const messageResponse = await authenticatedPost(`/api/v1/sessions/${sessionId}/messages`, {
        text: '生成工作区报告',
      })
      expect(messageResponse.status).toBe(202)
      await messageResponse.text()

      await watcher
      expect(plannerRunId).not.toBe('')

      // Parent turn settles; background worker picks the run and the child
      // consumes the appended responses (plan + mark ×2 + complete + text).
      await waitForTurnComplete(kernelRunsBefore, 30000, 'parent turn kernel run completed')
      await waitFor(
        () => {
          const run = ctx.stores.plannerRunStore.getById(plannerRunId)
          return run?.status === PLANNER_STATES.COMPLETED
        },
        45000,
        'planner run COMPLETED via background child',
      )

      // ── planner_runs reached terminal COMPLETED ──
      const run = ctx.stores.plannerRunStore.getById(plannerRunId)!
      expect(run.status).toBe(PLANNER_STATES.COMPLETED)

      // ── plans.steps are the GENERATED steps (not the 3-step placeholder), all completed ──
      const plan = ctx.stores.planStore.getPlan(run.planId)!
      expect(plan.steps).toHaveLength(2)
      for (const step of plan.steps) {
        expect(step.status).toBe('completed')
      }

      // ── status_query returns REAL progress, never '50%' ──
      const finalStatus = await queryProgress(plannerRunId)
      expect(finalStatus.status).toBe(PLANNER_STATES.COMPLETED)
      expect(finalStatus.progress).toBe('100%')
      for (const progress of snapshots) {
        expect(progress).not.toBe('50%')
        expect(progress).not.toBe('missing')
      }
      expect(snapshots.some((progress) => progress === '0%' || progress === '100%')).toBe(true)

      // ── the parent tool loop only called spawn (auto-close, no manual drive) ──
      const interactions = registry.getInteractions()
      const parentToolCalls = interactions
        .slice(0, 2)
        .flatMap((interaction) => (interaction.response.toolCalls ?? []).map((toolCall) => toolCall.function.name))
      expect(parentToolCalls).toEqual(['foreground_spawn_planner'])
      expect(interactions[1]!.response.content).toBe(FINAL_ANSWER)

      // ── child ran against the generated plan and wrote back (marks in child turns) ──
      const allToolCalls = interactions.flatMap((interaction) =>
        (interaction.response.toolCalls ?? []).map((toolCall) => toolCall.function.name),
      )
      expect(allToolCalls).toContain('foreground_mark_planner_step')
    },
  )

  it(
    'resume contract retained: resumePlannerRun returns plan context for a non-terminal run',
    { timeout: 60000 },
    async () => {
      const registry = getMockProviderRegistry()
      registry.reset()

      // Spawn a second run via the tool loop; the background child will consume
      // a plan-generation response then complete. Keep the child sequence short:
      // plan JSON + text so the loop closes without step marks.
      registry.setResponseQueue([
        spawnResponse('生成工作区报告并持续跟踪'),
        textResponse(FINAL_ANSWER),
        planGenerationResponse(),
        textResponse('child done'),
      ])
      const kernelRunsBeforeSpawn = ctx.stores.kernelRunStore.getBySession(sessionId).length
      const spawnTurn = await authenticatedPost(`/api/v1/sessions/${sessionId}/messages`, {
        text: '请持续跟踪工作区报告',
      })
      expect(spawnTurn.status).toBe(202)
      await spawnTurn.text()

      await waitFor(
        () =>
          ctx.stores.plannerRunStore
            .findByUser(userId)
            .some((run) => run.status === PLANNER_STATES.COMPLETED && run.plannerRunId !== ''),
        45000,
        'second planner run completed via background child',
      )
      await waitForTurnComplete(kernelRunsBeforeSpawn, 30000, 'spawn turn kernel run completed')

      // Resume contract on a fresh run: create directly via runtime (the tool
      // path is covered by the unit tests), assert context is returned.
      const freshRun = ctx.plannerRuntime.createPlannerRun({
        objective: '工作区报告跟踪',
        userId,
        sessionId,
      })
      const resumeResult = ctx.plannerRuntime.resumePlannerRun(freshRun.plannerRunId, {
        eventType: 'user_resume',
        payload: { userMessage: 'continue', timestamp: '2026-08-08T00:00:00.000Z' },
      })
      expect(resumeResult.context).toBeDefined()
      expect(resumeResult.context!.objective).toContain('工作区报告')
      expect(resumeResult.context!.steps.length).toBeGreaterThanOrEqual(1)
      expect(resumeResult.context!.checkpoint).toBeDefined()
      const resumedRun = ctx.stores.plannerRunStore.getById(freshRun.plannerRunId)
      expect(resumedRun?.status).toBe(PLANNER_STATES.PLANNING)
    },
  )
})
