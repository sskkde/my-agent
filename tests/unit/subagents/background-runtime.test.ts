import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { BackgroundRunStore, BackgroundRun } from '../../../src/storage/background-run-store.js'
import type { EventRecord } from '../../../src/storage/event-store.js'
import { createBackgroundRuntime, type ParentTurnTrigger } from '../../../src/subagents/background-runtime.js'
import type { BackgroundRunInput } from '../../../src/subagents/background-runtime.js'

function createMockBackgroundRunStore(): BackgroundRunStore {
  const runs = new Map<string, BackgroundRun>()
  return {
    create: vi.fn((run) => {
      const fullRun: BackgroundRun = {
        ...run,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        retryCount: run.retryCount ?? 0,
      }
      runs.set(run.backgroundRunId, fullRun)
    }),
    getById: vi.fn((id) => runs.get(id) ?? null),
    updateStatus: vi.fn((id, status) => {
      const run = runs.get(id)
      if (run) {
        run.status = status
        run.updatedAt = new Date().toISOString()
      }
    }),
    saveCheckpoint: vi.fn((id, checkpoint) => {
      const run = runs.get(id)
      if (run) {
        run.checkpointData = checkpoint
        run.updatedAt = new Date().toISOString()
      }
    }),
    saveRecoveryPoint: vi.fn(),
    saveResult: vi.fn(),
    incrementRetryCount: vi.fn(),
    saveErrorMessage: vi.fn(),
    saveTaskSpec: vi.fn(),
    linkChildTask: vi.fn(),
    saveNotification: vi.fn(),
    markNotificationDelivered: vi.fn(),
    claimNotification: vi.fn(() => true),
    unclaimNotification: vi.fn(),
    getPendingNotifications: vi.fn(() => []),
    getByUserAndStatus: vi.fn(() => []),
    getBySessionAndStatus: vi.fn(() => []),
    getBySubagentRunId: vi.fn(() => []),
    getByLaunchSource: vi.fn(() => []),
    getByStatus: vi.fn(() => []),
    getExpiredRuns: vi.fn(() => []),
  }
}

function createMockEventStore() {
  const events: EventRecord[] = []
  return {
    append: vi.fn((event) => {
      const evts = Array.isArray(event) ? event : [event]
      events.push(...evts)
    }),
    query: vi.fn(() => []),
    findByCorrelationId: vi.fn(() => []),
    findByCausationId: vi.fn(() => []),
    updateUserIdForSession: vi.fn(() => 0),
    events,
  }
}

function makeRunInput(overrides: Partial<BackgroundRunInput> = {}): BackgroundRunInput {
  return {
    userId: 'user-1',
    sessionId: 'sess-1',
    agentType: 'document_processor',
    taskSpec: { objective: 'Process document' },
    launchSource: 'test',
    ...overrides,
  }
}

describe('BackgroundRuntime parentTurnTrigger', () => {
  let backgroundRunStore: BackgroundRunStore
  let eventStore: ReturnType<typeof createMockEventStore>

  beforeEach(() => {
    backgroundRunStore = createMockBackgroundRunStore()
    eventStore = createMockEventStore()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function makeRuntime(trigger?: ParentTurnTrigger) {
    return createBackgroundRuntime({
      backgroundRunStore,
      eventStore,
      maxConcurrentRuns: 5,
      watchdogTimeoutMs: 10000,
      parentTurnTrigger: trigger,
    })
  }

  function enqueueStartedRun(
    runtime: ReturnType<typeof makeRuntime>,
    input: BackgroundRunInput = makeRunInput(),
  ): string {
    const bgRunId = runtime.enqueueBackgroundRun(input)
    void runtime.startBackgroundRun(bgRunId)
    return bgRunId
  }

  it('fires the trigger exactly once with correct params after completeBackgroundRun', async () => {
    const trigger = vi.fn<ParentTurnTrigger>()
    const runtime = makeRuntime(trigger)
    const bgRunId = enqueueStartedRun(runtime)

    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Report ready',
      toolCalls: [],
      iterationsUsed: 3,
    })

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenCalledWith({
      userId: 'user-1',
      sessionId: 'sess-1',
      backgroundRunId: bgRunId,
      type: 'completed',
      summary: 'Report ready',
    })
  })

  it('does NOT fire the trigger twice on repeated completeBackgroundRun (status guard)', async () => {
    const trigger = vi.fn<ParentTurnTrigger>()
    const runtime = makeRuntime(trigger)
    const bgRunId = enqueueStartedRun(runtime)

    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Report ready',
      toolCalls: [],
      iterationsUsed: 3,
    })
    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Report ready',
      toolCalls: [],
      iterationsUsed: 3,
    })

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ type: 'completed' }))
  })

  it('does not fire the trigger when no parentTurnTrigger is configured', async () => {
    const runtime = makeRuntime()
    const bgRunId = enqueueStartedRun(runtime)

    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Report ready',
      toolCalls: [],
      iterationsUsed: 3,
    })

    expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('completed')
    expect(backgroundRunStore.saveNotification).toHaveBeenCalledTimes(1)
  })

  it('does not fire the trigger for a run with an empty sessionId', async () => {
    const trigger = vi.fn<ParentTurnTrigger>()
    const runtime = makeRuntime(trigger)
    const bgRunId = enqueueStartedRun(runtime, makeRunInput({ sessionId: '' }))

    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Report ready',
      toolCalls: [],
      iterationsUsed: 3,
    })

    expect(trigger).not.toHaveBeenCalled()
    expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('completed')
  })

  it('returns normally when the trigger callback throws', async () => {
    const trigger = vi.fn<ParentTurnTrigger>(() => {
      throw new Error('callback exploded')
    })
    const runtime = makeRuntime(trigger)
    const bgRunId = enqueueStartedRun(runtime)

    expect(() =>
      runtime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Report ready',
        toolCalls: [],
        iterationsUsed: 3,
      }),
    ).not.toThrow()

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('completed')
    expect(backgroundRunStore.saveNotification).toHaveBeenCalledTimes(1)
  })

  it('fires the trigger with type failed after failBackgroundRun', async () => {
    const trigger = vi.fn<ParentTurnTrigger>()
    const runtime = makeRuntime(trigger)
    const bgRunId = enqueueStartedRun(runtime)

    runtime.failBackgroundRun(bgRunId, { code: 'EXECUTION_ERROR', message: 'child task crashed' })

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'sess-1',
        backgroundRunId: bgRunId,
        type: 'failed',
      }),
    )
  })

  it('fires the trigger with type cancelled after cancelBackgroundRun', async () => {
    const trigger = vi.fn<ParentTurnTrigger>()
    const runtime = makeRuntime(trigger)
    const bgRunId = enqueueStartedRun(runtime)

    runtime.cancelBackgroundRun(bgRunId)
    runtime.cancelBackgroundRun(bgRunId)

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        sessionId: 'sess-1',
        backgroundRunId: bgRunId,
        type: 'cancelled',
        summary: 'The background task was cancelled',
      }),
    )
  })
})
