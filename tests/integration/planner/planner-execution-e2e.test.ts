/**
 * T7 — Planner execution E2E via the real API + real mock LLM provider.
 *
 * Proves the full §3 execution contract through the real HTTP surface:
 *
 *   user message → ForegroundAgent.runTurn → AgentKernel tool loop
 *     → foreground_spawn_planner        (creates planner run + 3 steps)
 *     → foreground_mark_planner_step    (marks step_001/step_002 completed)
 *     → foreground_complete_planner     (run → COMPLETED, steps all completed)
 *     → final answer
 *
 * and that:
 *   - `status_query` (the builtin handler wired in context.ts) reports REAL
 *     progress (completedSteps/totalSteps as 'X%'), never the legacy '50%'
 *     placeholder;
 *   - a follow-up turn can `foreground_resume_planner` a non-terminal run and
 *     continue it to COMPLETED (the §5 验收路径 "可续跑" requirement).
 *
 * Harness: real `createApiContext` (:memory: SQLite) + real Fastify server +
 * real provider resolution for `providerType: 'mock'`. The MockProvider reads
 * the shared MockProviderRegistry response queue (same registry the
 * /api/v1/mock-provider/* routes control), so responses are pre-queued exactly
 * like the manual QA flow.
 *
 * NODE_ENV note: in vitest NODE_ENV is 'test', which forces the legacy
 * keyword-routing mock adapter in createApiContext. The scoped adapter that
 * resolves DB `providerType: 'mock'` configs into MockProvider is only chosen
 * outside test mode, so this file temporarily sets NODE_ENV='development' for
 * the duration of the suite and restores it in afterAll (per-worker isolation).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import { getMockProviderRegistry, type MockResponseConfig } from '../../../src/llm/mock-provider-registry.js'
import { createStatusQueryTool } from '../../../src/tools/builtins/status-query.js'
import type { ToolExecutionContext } from '../../../src/tools/types.js'
import { PLANNER_STATES } from '../../../src/shared/states.js'

const FINAL_ANSWER_1 = 'E2E_PLANNER_CHAIN_FINAL_ANSWER'
const FINAL_ANSWER_2 = 'E2E_PLANNER_RESUME_FINAL_ANSWER'

const TEST_ENCRYPTION_KEY = 't7-test-encryption-key-32-bytes-minimum!!'

// ─── Mock response builders ─────────────────────────────────────────────────

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
        arguments: JSON.stringify({ plannerRunId, summary: 'E2E plan summary' }),
      },
    ],
  }
}

function resumePlannerResponse(plannerRunId: string): MockResponseConfig {
  return {
    content: '',
    finishReason: 'tool_calls',
    toolCalls: [
      {
        name: 'foreground_resume_planner',
        arguments: JSON.stringify({
          plannerRunId,
          userMessage: 'continue the plan',
          timestamp: '2026-08-08T00:00:00.000Z',
        }),
      },
    ],
  }
}

function textResponse(content: string): MockResponseConfig {
  return { content, finishReason: 'stop' }
}

// ─── Harness ────────────────────────────────────────────────────────────────

describe('Planner execution E2E (real API + providerType mock)', () => {
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

  /** Real-progress query via the exact tool handler context.ts wires. */
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

  /** Last terminal kernel run for the session (turn completion signal). */
  function lastTerminalRunStatus(): string | undefined {
    const runs = ctx.stores.kernelRunStore.getBySession(sessionId)
    if (runs.length === 0) return undefined
    const last = runs[runs.length - 1]!
    return ['completed', 'failed', 'cancelled', 'timeout'].includes(last.status) ? last.status : undefined
  }

  /** Wait until the kernel run counter advanced past baseline AND the newest run is terminal. */
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
    // createApiContext only builds the provider-scoped adapter (which resolves
    // DB `providerType: 'mock'` configs into the registry-backed MockProvider)
    // outside NODE_ENV==='test'. Save + restore for worker isolation.
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

    // Seed the REAL owner's mock provider + a session-level override so the
    // provider/model resolution chain is deterministic.
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
    // Let any still-in-flight async message processing settle before closing
    // the DB connection (message POSTs return 202 and process off-thread).
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
    'single turn drives spawn → mark(step_001) → mark(step_002) → complete → final; real progress; run COMPLETED',
    { timeout: 60000 },
    async () => {
      const registry = getMockProviderRegistry()
      registry.reset()

      // Watcher: detects the run the spawn tool creates, refills the queue with
      // the real plannerRunId (unknown until spawn executes), and records
      // real-progress snapshots at each DB-state transition.
      const snapshots: string[] = []
      let plannerRunId = ''
      let stage: 'spawn' | 'mark1' | 'mark2' | 'complete' | 'done' = 'spawn'
      const completedSteps = (): number => {
        const run = ctx.stores.plannerRunStore.getById(plannerRunId)
        const plan = run ? ctx.stores.planStore.getPlan(run.planId) : null
        return plan?.steps.filter((step) => step.status === 'completed').length ?? 0
      }
      const snapshot = async (): Promise<void> => {
        snapshots.push((await queryProgress(plannerRunId)).progress ?? 'missing')
      }

      const watcher = (async () => {
        const deadline = Date.now() + 30000
        while (Date.now() < deadline) {
          if (stage === 'spawn') {
            const runs = ctx.stores.plannerRunStore.findByUser(userId)
            const planning = runs.find((run) => run.status === PLANNER_STATES.PLANNING)
            if (planning) {
              plannerRunId = planning.plannerRunId
              await snapshot() // '0%' — spawned, no step completed yet
              registry.setResponseQueue([
                markStepResponse(plannerRunId, 'step_001'),
                markStepResponse(plannerRunId, 'step_002'),
                completePlannerResponse(plannerRunId),
                textResponse(FINAL_ANSWER_1),
              ])
              stage = 'mark1'
            }
          } else if (stage === 'mark1' && completedSteps() >= 1) {
            await snapshot() // '33%'
            stage = 'mark2'
          } else if (stage === 'mark2' && completedSteps() >= 2) {
            await snapshot() // '67%'
            stage = 'complete'
          } else if (stage === 'complete') {
            const run = ctx.stores.plannerRunStore.getById(plannerRunId)
            if (run?.status === PLANNER_STATES.COMPLETED) {
              await snapshot() // '100%'
              stage = 'done'
            }
          }
          if (stage === 'done') return
          await sleep(2)
        }
        throw new Error(`chain watcher timed out at stage=${stage}`)
      })()

      // Fire the real message turn. The spawn response is queued up front; the
      // watcher refills mark/complete/final once the spawn tool created the run.
      registry.setResponseQueue([spawnResponse('生成工作区报告')])
      const messageResponse = await authenticatedPost(`/api/v1/sessions/${sessionId}/messages`, {
        text: '生成工作区报告',
      })
      expect(messageResponse.status).toBe(202)
      await messageResponse.text()

      await watcher
      expect(plannerRunId).not.toBe('')

      // The final answer response must be consumed too, then the turn settles.
      await waitFor(
        () => registry.getInteractions().length >= 5,
        30000,
        `5 mock LLM interactions (got ${registry.getInteractions().length})`,
      )
      await waitFor(() => lastTerminalRunStatus() === 'completed', 30000, 'turn kernel run completed')

      // ── planner_runs row reached terminal COMPLETED ──
      const run = ctx.stores.plannerRunStore.getById(plannerRunId)!
      expect(run.status).toBe(PLANNER_STATES.COMPLETED)

      // ── plans.steps all completed ──
      const plan = ctx.stores.planStore.getPlan(run.planId)!
      expect(plan.steps).toHaveLength(3)
      for (const step of plan.steps) {
        expect(step.status).toBe('completed')
      }

      // ── status_query returns REAL progress, never the '50%' placeholder ──
      const finalStatus = await queryProgress(plannerRunId)
      expect(finalStatus.status).toBe(PLANNER_STATES.COMPLETED)
      expect(finalStatus.progress).toBe('100%')
      expect(snapshots[0]).toBe('0%')
      expect(snapshots[snapshots.length - 1]).toBe('100%')
      expect(snapshots.some((progress) => progress !== '0%' && progress !== '100%')).toBe(true)
      for (const progress of snapshots) {
        expect(progress).not.toBe('50%')
      }

      // ── the tool-loop sequence actually ran through the real kernel ──
      const interactions = registry.getInteractions()
      const toolCallNames = interactions.flatMap((interaction) =>
        (interaction.response.toolCalls ?? []).map((toolCall) => toolCall.function.name),
      )
      expect(toolCallNames).toEqual([
        'foreground_spawn_planner',
        'foreground_mark_planner_step',
        'foreground_mark_planner_step',
        'foreground_complete_planner',
      ])
      expect(interactions[interactions.length - 1]!.response.content).toBe(FINAL_ANSWER_1)
    },
  )

  it(
    'resume path: foreground_resume_planner returns plan context and the run can be continued to COMPLETED',
    { timeout: 60000 },
    async () => {
      const registry = getMockProviderRegistry()
      registry.reset()

      // Turn A: spawn a second run (stays PLANNING — deterministic, no refill).
      registry.setResponseQueue([spawnResponse('生成工作区报告并持续跟踪'), textResponse(FINAL_ANSWER_2)])
      const kernelRunsBeforeSpawn = ctx.stores.kernelRunStore.getBySession(sessionId).length
      const spawnTurn = await authenticatedPost(`/api/v1/sessions/${sessionId}/messages`, {
        text: '请持续跟踪工作区报告',
      })
      expect(spawnTurn.status).toBe(202)
      await spawnTurn.text()

      await waitFor(
        () => ctx.stores.plannerRunStore.findByUser(userId).some((run) => run.status === PLANNER_STATES.PLANNING),
        30000,
        'second planner run to be created',
      )
      await waitFor(() => registry.getInteractions().length >= 2, 30000, 'spawn-only turn LLM interactions')
      await waitForTurnComplete(kernelRunsBeforeSpawn, 30000, 'spawn-only turn kernel run completed')

      const runs = ctx.stores.plannerRunStore.findByUser(userId)
      const runB = runs.find((run) => run.status === PLANNER_STATES.PLANNING)
      expect(runB).toBeDefined()
      const plannerRunId = runB!.plannerRunId

      // ── runtime contract through the real context wiring: resume returns context ──
      const resumeResult = ctx.plannerRuntime.resumePlannerRun(plannerRunId, {
        eventType: 'user_resume',
        payload: { userMessage: 'continue', timestamp: '2026-08-08T00:00:00.000Z' },
      })
      expect(resumeResult.context).toBeDefined()
      expect(resumeResult.context!.objective).toContain('工作区报告')
      expect(resumeResult.context!.steps).toHaveLength(3)
      expect(resumeResult.context!.checkpoint).toBeDefined()
      const resumedRun = ctx.stores.plannerRunStore.getById(plannerRunId)
      expect(resumedRun?.status).toBe(PLANNER_STATES.PLANNING)

      // ── Turn B: the agent resumes then completes the run via the real tool loop ──
      registry.reset()
      registry.setResponseQueue([
        resumePlannerResponse(plannerRunId),
        completePlannerResponse(plannerRunId),
        textResponse(FINAL_ANSWER_2),
      ])
      const kernelRunsBeforeResume = ctx.stores.kernelRunStore.getBySession(sessionId).length
      const resumeTurn = await authenticatedPost(`/api/v1/sessions/${sessionId}/messages`, {
        text: '继续执行这个计划',
      })
      expect(resumeTurn.status).toBe(202)
      await resumeTurn.text()

      await waitFor(() => registry.getInteractions().length >= 3, 30000, 'resume+complete turn LLM interactions')
      await waitForTurnComplete(kernelRunsBeforeResume, 30000, 'resume turn kernel run completed')

      // The LLM received the resume tool result (success) and the complete
      // result (success) as tool messages in the following requests.
      const interactions = registry.getInteractions()
      const toolCallNames = interactions.flatMap((interaction) =>
        (interaction.response.toolCalls ?? []).map((toolCall) => toolCall.function.name),
      )
      expect(toolCallNames).toEqual(['foreground_resume_planner', 'foreground_complete_planner'])
      const resumeArgs = interactions[0]!.response.toolCalls![0]!.function.arguments
      expect(JSON.parse(resumeArgs)).toMatchObject({ plannerRunId })
      const followupToolMessages = [interactions[1]!, interactions[2]!].flatMap((interaction) =>
        interaction.request.messages.filter((message) => message.role === 'tool'),
      )
      const resumeToolMessage = followupToolMessages.find((message) => message.content.includes('"resumed"'))
      expect(resumeToolMessage).toBeDefined()
      const completeToolMessage = followupToolMessages.find((message) => message.content.includes('"completed"'))
      expect(completeToolMessage).toBeDefined()
      expect(interactions[interactions.length - 1]!.response.content).toBe(FINAL_ANSWER_2)

      // ── run B reached terminal COMPLETED with all steps completed ──
      const completedRun = ctx.stores.plannerRunStore.getById(plannerRunId)!
      expect(completedRun.status).toBe(PLANNER_STATES.COMPLETED)
      const plan = ctx.stores.planStore.getPlan(completedRun.planId)!
      for (const step of plan.steps) {
        expect(step.status).toBe('completed')
      }
      const finalStatus = await queryProgress(plannerRunId)
      expect(finalStatus.status).toBe(PLANNER_STATES.COMPLETED)
      expect(finalStatus.progress).toBe('100%')
    },
  )
})
