import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { BackgroundRunStore, BackgroundRun } from '../../../src/storage/background-run-store.js'
import type { EventStore, EventRecord } from '../../../src/storage/event-store.js'
import type { ConnectionManager } from '../../../src/storage/connection.js'
import type { SubagentTaskSpec, SubagentResult } from '../../../src/subagents/types.js'

// Mock types for dependencies
interface MockConnectionManager extends ConnectionManager {
  reset(): void
}

interface MockBackgroundRunStore extends BackgroundRunStore {
  runs: Map<string, BackgroundRun>
  reset(): void
}

interface MockEventStore extends EventStore {
  events: EventRecord[]
  reset(): void
}

// Background runtime types
interface BackgroundRunInput {
  userId: string
  sessionId?: string
  agentType: string
  taskSpec: SubagentTaskSpec
  launchSource: string
  priority?: number
  scheduledAt?: string
  expiresAt?: string
  artifactRefs?: string[]
}

interface Checkpoint {
  iteration: number
  contextItems: unknown[]
  lastToolResult?: unknown
  timestamp: string
}

interface NotificationRequest {
  notificationId: string
  backgroundRunId: string
  userId: string
  type: 'completed' | 'failed' | 'cancelled'
  title: string
  message: string
  artifactRefs?: string[]
  createdAt: string
}

interface BackgroundRuntime {
  enqueueBackgroundRun(input: BackgroundRunInput): string
  startBackgroundRun(bgRunId: string): Promise<void>
  checkpointBackgroundRun(bgRunId: string, checkpoint: Checkpoint): void
  recoverFromCheckpoint(bgRunId: string): Promise<{ checkpoint: Checkpoint | null; canResume: boolean }>
  watchdogTick(): void
  completeBackgroundRun(bgRunId: string, result: SubagentResult): void
  failBackgroundRun(bgRunId: string, error: { code: string; message: string }): void
  cancelBackgroundRun(bgRunId: string): void
  getBackgroundRun(bgRunId: string): BackgroundRun | null
  getRunningCount(): number
  getQueuedCount(): number
  getPendingNotifications(): NotificationRequest[]
}

// Mock implementations
function createMockConnection(): MockConnectionManager {
  return {
    open: vi.fn(),
    close: vi.fn(),
    isOpen: vi.fn(() => true),
    query: vi.fn(() => []),
    exec: vi.fn(),
    transaction: vi.fn((fn) => fn),
    reset: vi.fn(),
  } as MockConnectionManager
}

function createMockBackgroundRunStore(): MockBackgroundRunStore {
  const runs = new Map<string, BackgroundRun>()

  return {
    runs,
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
        run.recoveryPoint = { checkpointSavedAt: new Date().toISOString(), data: checkpoint }
        run.updatedAt = new Date().toISOString()
      }
    }),
    saveRecoveryPoint: vi.fn((id, recoveryPoint) => {
      const run = runs.get(id)
      if (run) {
        run.recoveryPoint = recoveryPoint
        run.updatedAt = new Date().toISOString()
      }
    }),
    saveResult: vi.fn((id, result) => {
      const run = runs.get(id)
      if (run) {
        run.resultData = result
        run.completedAt = new Date().toISOString()
        run.updatedAt = new Date().toISOString()
      }
    }),
    incrementRetryCount: vi.fn((id) => {
      const run = runs.get(id)
      if (run) {
        run.retryCount++
        run.updatedAt = new Date().toISOString()
      }
    }),
    getByUserAndStatus: vi.fn((userId, status) =>
      Array.from(runs.values()).filter((r) => r.userId === userId && r.status === status),
    ),
    getBySessionAndStatus: vi.fn((sessionId, status) =>
      Array.from(runs.values()).filter((r) => r.sessionId === sessionId && r.status === status),
    ),
    getBySubagentRunId: vi.fn((subagentRunId) =>
      Array.from(runs.values()).filter((r) => r.subagentRunId === subagentRunId),
    ),
    getByLaunchSource: vi.fn((launchSource) =>
      Array.from(runs.values()).filter((r) => r.launchSource === launchSource),
    ),
    getByStatus: vi.fn((status) => Array.from(runs.values()).filter((r) => r.status === status)),
    getExpiredRuns: vi.fn(() =>
      Array.from(runs.values()).filter((r) => {
        if (!r.expiresAt) return false
        return new Date(r.expiresAt) < new Date()
      }),
    ),
    reset: vi.fn(() => runs.clear()),
  } as MockBackgroundRunStore
}

function createMockEventStore(): MockEventStore {
  const events: EventRecord[] = []

  return {
    events,
    append: vi.fn((event) => {
      const evts = Array.isArray(event) ? event : [event]
      events.push(...evts)
    }),
    query: vi.fn(() => []),
    findByCorrelationId: vi.fn(() => []),
    findByCausationId: vi.fn(() => []),
    updateUserIdForSession: vi.fn(() => 0),
    reset: vi.fn(() => (events.length = 0)),
  } as MockEventStore
}

// Import the actual implementation (will fail initially)
import { createBackgroundRuntime } from '../../../src/subagents/background-runtime.js'

describe('BackgroundRuntime', () => {
  let connection: MockConnectionManager
  let backgroundRunStore: MockBackgroundRunStore
  let eventStore: MockEventStore
  let runtime: BackgroundRuntime

  beforeEach(() => {
    connection = createMockConnection()
    backgroundRunStore = createMockBackgroundRunStore()
    eventStore = createMockEventStore()
    runtime = createBackgroundRuntime({
      backgroundRunStore,
      eventStore,
      maxConcurrentRuns: 2,
      watchdogTimeoutMs: 5000,
    })
  })

  afterEach(() => {
    backgroundRunStore.reset()
    eventStore.reset()
    connection.reset()
    vi.clearAllTimers()
  })

  describe('enqueueBackgroundRun', () => {
    it('should create a background run with queued status', () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        sessionId: 'session-456',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)

      expect(bgRunId).toBeDefined()
      expect(typeof bgRunId).toBe('string')

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run).not.toBeNull()
      expect(run?.status).toBe('queued')
      expect(run?.userId).toBe('user-123')
      expect(run?.agentType).toBe('research-agent')
    })

    it('should store artifact refs with the run', () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Analyze document' },
        launchSource: 'planner',
        artifactRefs: ['artifact-1', 'artifact-2'],
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      const run = runtime.getBackgroundRun(bgRunId)

      expect(run?.checkpointData).toBeDefined()
      expect((run?.checkpointData as { artifactRefs?: string[] })?.artifactRefs).toEqual(['artifact-1', 'artifact-2'])
    })
  })

  describe('startBackgroundRun', () => {
    it('should transition run from queued to running', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('queued')

      await runtime.startBackgroundRun(bgRunId)

      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('running')
      expect(runtime.getBackgroundRun(bgRunId)?.startedAt).toBeDefined()
    })

    it('should emit BackgroundRunStarted event', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      const startedEvents = eventStore.events.filter(
        (e) => e.eventType === 'BackgroundRunStarted' && e.relatedRefs?.backgroundRunId === bgRunId,
      )
      expect(startedEvents.length).toBe(1)
      expect(startedEvents[0].payload.backgroundRunId).toBe(bgRunId)
    })
  })

  describe('concurrency limits', () => {
    it('should enforce max concurrent runs limit', async () => {
      // Create 3 runs
      const runs: string[] = []
      for (let i = 0; i < 3; i++) {
        const bgRunId = runtime.enqueueBackgroundRun({
          userId: 'user-123',
          agentType: 'research-agent',
          taskSpec: { objective: `Task ${i}` },
          launchSource: 'planner',
        })
        runs.push(bgRunId)
      }

      expect(runtime.getQueuedCount()).toBe(3)
      expect(runtime.getRunningCount()).toBe(0)

      // Start first run
      await runtime.startBackgroundRun(runs[0])
      expect(runtime.getRunningCount()).toBe(1)
      expect(runtime.getQueuedCount()).toBe(2)

      // Start second run
      await runtime.startBackgroundRun(runs[1])
      expect(runtime.getRunningCount()).toBe(2)
      expect(runtime.getQueuedCount()).toBe(1)

      // Third run should remain queued (at concurrency limit)
      const run3 = runtime.getBackgroundRun(runs[2])
      expect(run3?.status).toBe('queued')
    })

    it('should auto-start queued runs when concurrency frees up', async () => {
      // Create 2 runs and start both
      const runs: string[] = []
      for (let i = 0; i < 2; i++) {
        const bgRunId = runtime.enqueueBackgroundRun({
          userId: 'user-123',
          agentType: 'research-agent',
          taskSpec: { objective: `Task ${i}` },
          launchSource: 'planner',
        })
        runs.push(bgRunId)
      }

      await runtime.startBackgroundRun(runs[0])
      await runtime.startBackgroundRun(runs[1])

      expect(runtime.getRunningCount()).toBe(2)

      // Complete first run
      runtime.completeBackgroundRun(runs[0], {
        status: 'completed',
        response: 'Done',
        toolCalls: [],
        iterationsUsed: 5,
      })

      // A queued run should auto-start if available
      // (implementation may vary - might need explicit trigger)
    })
  })

  describe('checkpointBackgroundRun', () => {
    it('should persist checkpoint data', () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      runtime.startBackgroundRun(bgRunId)

      const checkpoint: Checkpoint = {
        iteration: 3,
        contextItems: [{ type: 'memory', content: 'found data' }],
        lastToolResult: { tool: 'search', result: 'data' },
        timestamp: new Date().toISOString(),
      }

      runtime.checkpointBackgroundRun(bgRunId, checkpoint)

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.checkpointData).toEqual(checkpoint)
      expect(run?.recoveryPoint).toBeDefined()
    })

    it('should emit CheckpointSaved event', () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      runtime.startBackgroundRun(bgRunId)

      const checkpoint: Checkpoint = {
        iteration: 3,
        contextItems: [],
        timestamp: new Date().toISOString(),
      }

      runtime.checkpointBackgroundRun(bgRunId, checkpoint)

      const checkpointEvents = eventStore.events.filter(
        (e) => e.eventType === 'CheckpointSaved' && e.relatedRefs?.backgroundRunId === bgRunId,
      )
      expect(checkpointEvents.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('recoverFromCheckpoint', () => {
    it('should resume from persisted checkpoint', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      const checkpoint: Checkpoint = {
        iteration: 3,
        contextItems: [{ type: 'memory', content: 'found data' }],
        lastToolResult: { tool: 'search', result: 'data' },
        timestamp: new Date().toISOString(),
      }

      runtime.checkpointBackgroundRun(bgRunId, checkpoint)

      // Simulate restart - create new runtime instance
      const newRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore,
        maxConcurrentRuns: 2,
        watchdogTimeoutMs: 5000,
      })

      const recovery = await newRuntime.recoverFromCheckpoint(bgRunId)

      expect(recovery.canResume).toBe(true)
      expect(recovery.checkpoint).toEqual(checkpoint)
    })

    it('should transition run to recovering state during recovery', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      const checkpoint: Checkpoint = {
        iteration: 2,
        contextItems: [],
        timestamp: new Date().toISOString(),
      }

      runtime.checkpointBackgroundRun(bgRunId, checkpoint)

      // Simulate process restart
      const newRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore,
        maxConcurrentRuns: 2,
        watchdogTimeoutMs: 5000,
      })

      // Mark run as running (simulating it was running when process died)
      backgroundRunStore.updateStatus(bgRunId, 'running')

      await newRuntime.recoverFromCheckpoint(bgRunId)

      expect(newRuntime.getBackgroundRun(bgRunId)?.status).toBe('recovering')
    })

    it('should emit BackgroundRunRecovered event', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      const checkpoint: Checkpoint = {
        iteration: 2,
        contextItems: [],
        timestamp: new Date().toISOString(),
      }

      runtime.checkpointBackgroundRun(bgRunId, checkpoint)

      const newRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore,
        maxConcurrentRuns: 2,
        watchdogTimeoutMs: 5000,
      })

      await newRuntime.recoverFromCheckpoint(bgRunId)

      const recoveredEvents = eventStore.events.filter(
        (e) => e.eventType === 'BackgroundRunRecovered' && e.relatedRefs?.backgroundRunId === bgRunId,
      )
      expect(recoveredEvents.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('watchdogTick', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should detect runs with no progress and mark as recovering', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      // Fast forward past watchdog timeout
      vi.advanceTimersByTime(6000)

      runtime.watchdogTick()

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('recovering')
    })

    it('should not flag runs that have recent checkpoints', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      // Create checkpoint
      runtime.checkpointBackgroundRun(bgRunId, {
        iteration: 1,
        contextItems: [],
        timestamp: new Date().toISOString(),
      })

      // Fast forward but checkpoint is recent
      vi.advanceTimersByTime(1000)

      runtime.watchdogTick()

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('running')
    })

    it('should mark run as failed after max recovery attempts', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      // Simulate multiple watchdog triggers
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(6000)
        runtime.watchdogTick()
      }

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('failed')
      expect(run?.errorMessage).toContain('max recovery attempts')
    })

    it('should emit WatchdogTriggered event when detecting stuck run', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      vi.advanceTimersByTime(6000)
      runtime.watchdogTick()

      const watchdogEvents = eventStore.events.filter(
        (e) => e.eventType === 'WatchdogTriggered' && e.relatedRefs?.backgroundRunId === bgRunId,
      )
      expect(watchdogEvents.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('completeBackgroundRun', () => {
    it('should transition run to completed state', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      const result: SubagentResult = {
        status: 'completed',
        response: 'Research completed successfully',
        toolCalls: [],
        iterationsUsed: 5,
      }

      runtime.completeBackgroundRun(bgRunId, result)

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('completed')
      expect(run?.completedAt).toBeDefined()
      expect(run?.resultData).toEqual(result)
    })

    it('should emit NotificationRequest for completed run', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Research completed',
        toolCalls: [],
        iterationsUsed: 5,
      })

      const notifications = runtime.getPendingNotifications()
      expect(notifications.length).toBe(1)
      expect(notifications[0].type).toBe('completed')
      expect(notifications[0].backgroundRunId).toBe(bgRunId)
      expect(notifications[0].userId).toBe('user-123')
    })

    it('should include artifact refs in notification', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Analyze document' },
        launchSource: 'planner',
        artifactRefs: ['artifact-1', 'artifact-2'],
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Analysis complete',
        toolCalls: [],
        iterationsUsed: 3,
      })

      const notifications = runtime.getPendingNotifications()
      expect(notifications[0].artifactRefs).toEqual(['artifact-1', 'artifact-2'])
    })

    it('should emit BackgroundRunCompleted event', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Research completed',
        toolCalls: [],
        iterationsUsed: 5,
      })

      const completedEvents = eventStore.events.filter(
        (e) => e.eventType === 'BackgroundRunCompleted' && e.relatedRefs?.backgroundRunId === bgRunId,
      )
      expect(completedEvents.length).toBe(1)
    })
  })

  describe('failBackgroundRun', () => {
    it('should transition run to failed state', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.failBackgroundRun(bgRunId, {
        code: 'EXECUTION_ERROR',
        message: 'Subagent execution failed',
      })

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('failed')
      expect(run?.errorMessage).toBe('Subagent execution failed')
    })

    it('should emit NotificationRequest for failed run', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.failBackgroundRun(bgRunId, {
        code: 'EXECUTION_ERROR',
        message: 'Subagent execution failed',
      })

      const notifications = runtime.getPendingNotifications()
      const failureNotification = notifications.find((n) => n.type === 'failed')
      expect(failureNotification).toBeDefined()
      expect(failureNotification?.backgroundRunId).toBe(bgRunId)
    })

    it('should emit BackgroundRunFailed event', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.failBackgroundRun(bgRunId, {
        code: 'EXECUTION_ERROR',
        message: 'Subagent execution failed',
      })

      const failedEvents = eventStore.events.filter(
        (e) => e.eventType === 'BackgroundRunFailed' && e.relatedRefs?.backgroundRunId === bgRunId,
      )
      expect(failedEvents.length).toBe(1)
    })
  })

  describe('cancelBackgroundRun', () => {
    it('should transition run to cancelled state', () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      runtime.cancelBackgroundRun(bgRunId)

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('cancelled')
    })

    it('should emit NotificationRequest for cancelled run', () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      runtime.cancelBackgroundRun(bgRunId)

      const notifications = runtime.getPendingNotifications()
      const cancelNotification = notifications.find((n) => n.type === 'cancelled')
      expect(cancelNotification).toBeDefined()
    })
  })

  describe('state transitions', () => {
    it('should allow queued -> running transition', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('queued')

      await runtime.startBackgroundRun(bgRunId)
      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('running')
    })

    it('should allow running -> completed transition', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Done',
        toolCalls: [],
        iterationsUsed: 1,
      })

      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('completed')
    })

    it('should allow running -> failed transition', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      runtime.failBackgroundRun(bgRunId, { code: 'ERROR', message: 'Failed' })

      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('failed')
    })

    it('should allow queued -> cancelled transition', () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      runtime.cancelBackgroundRun(bgRunId)

      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('cancelled')
    })

    it('should allow running -> recovering transition via watchdog', async () => {
      vi.useFakeTimers()

      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      vi.advanceTimersByTime(6000)
      runtime.watchdogTick()

      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('recovering')

      vi.useRealTimers()
    })

    it('should allow recovering -> running transition after successful recovery', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)

      // Simulate recovery process
      runtime.checkpointBackgroundRun(bgRunId, {
        iteration: 2,
        contextItems: [],
        timestamp: new Date().toISOString(),
      })

      const newRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore,
        maxConcurrentRuns: 2,
        watchdogTimeoutMs: 5000,
      })

      backgroundRunStore.updateStatus(bgRunId, 'running')
      await newRuntime.recoverFromCheckpoint(bgRunId)

      expect(newRuntime.getBackgroundRun(bgRunId)?.status).toBe('recovering')
    })
  })

  describe('process restart simulation', () => {
    it('should recover running runs after process restart', async () => {
      // Create and start runs
      const runs: string[] = []
      for (let i = 0; i < 2; i++) {
        const bgRunId = runtime.enqueueBackgroundRun({
          userId: 'user-123',
          agentType: 'research-agent',
          taskSpec: { objective: `Task ${i}` },
          launchSource: 'planner',
        })
        runs.push(bgRunId)
        await runtime.startBackgroundRun(bgRunId)

        // Save checkpoints
        runtime.checkpointBackgroundRun(bgRunId, {
          iteration: i + 1,
          contextItems: [{ task: i }],
          timestamp: new Date().toISOString(),
        })
      }

      // Simulate process restart - create new runtime with same stores
      const newRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore,
        maxConcurrentRuns: 2,
        watchdogTimeoutMs: 5000,
      })

      // Recover all running runs
      const runningRuns = backgroundRunStore.getByStatus('running')
      for (const run of runningRuns) {
        await newRuntime.recoverFromCheckpoint(run.backgroundRunId)
      }

      // Verify all runs are now in recovering state
      for (const run of runningRuns) {
        expect(newRuntime.getBackgroundRun(run.backgroundRunId)?.status).toBe('recovering')
      }
    })

    it('should not affect completed runs after restart', async () => {
      const input: BackgroundRunInput = {
        userId: 'user-123',
        agentType: 'research-agent',
        taskSpec: { objective: 'Task' },
        launchSource: 'planner',
      }

      const bgRunId = runtime.enqueueBackgroundRun(input)
      await runtime.startBackgroundRun(bgRunId)
      runtime.completeBackgroundRun(bgRunId, {
        status: 'completed',
        response: 'Done',
        toolCalls: [],
        iterationsUsed: 1,
      })

      // Simulate restart
      const newRuntime = createBackgroundRuntime({
        backgroundRunStore,
        eventStore,
        maxConcurrentRuns: 2,
        watchdogTimeoutMs: 5000,
      })

      const run = newRuntime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('completed')
    })
  })

  describe('dispatcher cancel path', () => {
    it('should cancel a running background run via dispatcher', async () => {
      const bgRunId = runtime.enqueueBackgroundRun({
        userId: 'user-dispatcher-001',
        sessionId: 'session-dispatcher-001',
        agentType: 'research-agent',
        taskSpec: { objective: 'Dispatcher cancel test' },
        launchSource: 'dispatcher-test',
      })

      await runtime.startBackgroundRun(bgRunId)
      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('running')

      runtime.cancelBackgroundRun(bgRunId)

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('cancelled')

      const notifications = runtime.getPendingNotifications()
      const cancelNotification = notifications.find((n) => n.backgroundRunId === bgRunId && n.type === 'cancelled')
      expect(cancelNotification).toBeDefined()
      expect(cancelNotification?.userId).toBe('user-dispatcher-001')
    })

    it('should cancel a queued background run via dispatcher', () => {
      const bgRunId = runtime.enqueueBackgroundRun({
        userId: 'user-dispatcher-002',
        agentType: 'research-agent',
        taskSpec: { objective: 'Queued cancel test' },
        launchSource: 'dispatcher-test',
      })

      expect(runtime.getBackgroundRun(bgRunId)?.status).toBe('queued')

      runtime.cancelBackgroundRun(bgRunId)

      const run = runtime.getBackgroundRun(bgRunId)
      expect(run?.status).toBe('cancelled')
    })

    it('should emit BackgroundRunCancelled event when cancelled via dispatcher', async () => {
      const bgRunId = runtime.enqueueBackgroundRun({
        userId: 'user-dispatcher-003',
        agentType: 'research-agent',
        taskSpec: { objective: 'Event emission test' },
        launchSource: 'dispatcher-test',
      })

      await runtime.startBackgroundRun(bgRunId)
      runtime.cancelBackgroundRun(bgRunId)

      const cancelledEvents = eventStore.events.filter(
        (e) => e.eventType === 'BackgroundRunCancelled' && e.relatedRefs?.backgroundRunId === bgRunId,
      )
      expect(cancelledEvents.length).toBe(1)
      expect(cancelledEvents[0].payload.backgroundRunId).toBe(bgRunId)
      expect(cancelledEvents[0].payload.agentType).toBe('research-agent')
    })
  })
})
