import type { BackgroundRunStore, BackgroundRun } from '../storage/background-run-store.js'
import type { EventStore, EventRecord, SourceModule, SensitivityLevel, RetentionClass } from '../storage/event-store.js'
import type { SubagentTaskSpec, SubagentResult } from './types.js'

export interface BackgroundRunInput {
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

export interface Checkpoint {
  iteration: number
  contextItems: unknown[]
  lastToolResult?: unknown
  timestamp: string
}

export interface NotificationRequest {
  notificationId: string
  backgroundRunId: string
  userId: string
  type: 'completed' | 'failed' | 'cancelled'
  title: string
  message: string
  artifactRefs?: string[]
  createdAt: string
}

export interface BackgroundRuntimeConfig {
  backgroundRunStore: BackgroundRunStore
  eventStore: EventStore
  maxConcurrentRuns: number
  watchdogTimeoutMs: number
  maxRecoveryAttempts?: number
}

export interface BackgroundRuntime {
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

class BackgroundRuntimeImpl implements BackgroundRuntime {
  private config: BackgroundRuntimeConfig
  private runningRuns: Set<string> = new Set()
  private pendingNotifications: NotificationRequest[] = []
  private checkpointTimestamps: Map<string, number> = new Map()

  constructor(config: BackgroundRuntimeConfig) {
    this.config = config
  }

  enqueueBackgroundRun(input: BackgroundRunInput): string {
    const backgroundRunId = this.generateId('bg')
    const now = new Date().toISOString()

    const run: BackgroundRun = {
      backgroundRunId,
      userId: input.userId,
      sessionId: input.sessionId,
      agentType: input.agentType,
      status: 'queued',
      launchSource: input.launchSource,
      priority: input.priority ?? 0,
      scheduledAt: input.scheduledAt,
      expiresAt: input.expiresAt,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
      checkpointData: { artifactRefs: input.artifactRefs },
    }

    this.config.backgroundRunStore.create(run)

    this.emitEvent({
      eventId: this.generateId('evt'),
      eventType: 'BackgroundRunEnqueued',
      sourceModule: 'subagent' as SourceModule,
      userId: input.userId,
      sessionId: input.sessionId,
      correlationId: backgroundRunId,
      relatedRefs: { backgroundRunId },
      payload: {
        backgroundRunId,
        agentType: input.agentType,
        launchSource: input.launchSource,
        priority: input.priority ?? 0,
      },
      sensitivity: 'low' as SensitivityLevel,
      retentionClass: 'standard' as RetentionClass,
      createdAt: now,
    })

    return backgroundRunId
  }

  async startBackgroundRun(bgRunId: string): Promise<void> {
    const run = this.config.backgroundRunStore.getById(bgRunId)
    if (!run) {
      throw new Error(`Background run not found: ${bgRunId}`)
    }

    if (run.status !== 'queued') {
      throw new Error(`Cannot start background run with status: ${run.status}`)
    }

    if (this.runningRuns.size >= this.config.maxConcurrentRuns) {
      return
    }

    const now = new Date().toISOString()
    this.config.backgroundRunStore.updateStatus(bgRunId, 'running')

    const updatedRun = this.config.backgroundRunStore.getById(bgRunId)
    if (updatedRun) {
      updatedRun.startedAt = now
      updatedRun.updatedAt = now
    }

    this.runningRuns.add(bgRunId)
    this.checkpointTimestamps.set(bgRunId, Date.now())

    this.emitEvent({
      eventId: this.generateId('evt'),
      eventType: 'BackgroundRunStarted',
      sourceModule: 'subagent' as SourceModule,
      userId: run.userId,
      sessionId: run.sessionId,
      correlationId: bgRunId,
      relatedRefs: { backgroundRunId: bgRunId },
      payload: {
        backgroundRunId: bgRunId,
        agentType: run.agentType,
        startedAt: now,
      },
      sensitivity: 'low' as SensitivityLevel,
      retentionClass: 'standard' as RetentionClass,
      createdAt: now,
    })
  }

  checkpointBackgroundRun(bgRunId: string, checkpoint: Checkpoint): void {
    const run = this.config.backgroundRunStore.getById(bgRunId)
    if (!run) {
      throw new Error(`Background run not found: ${bgRunId}`)
    }

    if (!['running', 'recovering'].includes(run.status)) {
      throw new Error(`Cannot checkpoint background run with status: ${run.status}`)
    }

    const now = new Date().toISOString()
    this.config.backgroundRunStore.saveCheckpoint(bgRunId, checkpoint)
    this.checkpointTimestamps.set(bgRunId, Date.now())

    this.emitEvent({
      eventId: this.generateId('evt'),
      eventType: 'CheckpointSaved',
      sourceModule: 'subagent' as SourceModule,
      userId: run.userId,
      sessionId: run.sessionId,
      correlationId: bgRunId,
      causationId: bgRunId,
      relatedRefs: { backgroundRunId: bgRunId },
      payload: {
        backgroundRunId: bgRunId,
        iteration: checkpoint.iteration,
        checkpointSavedAt: now,
      },
      sensitivity: 'low' as SensitivityLevel,
      retentionClass: 'standard' as RetentionClass,
      createdAt: now,
    })
  }

  async recoverFromCheckpoint(bgRunId: string): Promise<{ checkpoint: Checkpoint | null; canResume: boolean }> {
    const run = this.config.backgroundRunStore.getById(bgRunId)
    if (!run) {
      throw new Error(`Background run not found: ${bgRunId}`)
    }

    if (!['running', 'recovering'].includes(run.status)) {
      return { checkpoint: null, canResume: false }
    }

    const now = new Date().toISOString()
    this.config.backgroundRunStore.updateStatus(bgRunId, 'recovering')

    const checkpoint = run.checkpointData as Checkpoint | undefined
    const canResume = checkpoint !== undefined

    this.emitEvent({
      eventId: this.generateId('evt'),
      eventType: 'BackgroundRunRecovered',
      sourceModule: 'subagent' as SourceModule,
      userId: run.userId,
      sessionId: run.sessionId,
      correlationId: bgRunId,
      relatedRefs: { backgroundRunId: bgRunId },
      payload: {
        backgroundRunId: bgRunId,
        canResume,
        checkpointIteration: checkpoint?.iteration,
        recoveredAt: now,
      },
      sensitivity: 'low' as SensitivityLevel,
      retentionClass: 'standard' as RetentionClass,
      createdAt: now,
    })

    return { checkpoint: checkpoint ?? null, canResume }
  }

  watchdogTick(): void {
    const now = Date.now()
    const timeoutMs = this.config.watchdogTimeoutMs
    const maxRecoveryAttempts = this.config.maxRecoveryAttempts ?? 3

    for (const bgRunId of this.runningRuns) {
      const run = this.config.backgroundRunStore.getById(bgRunId)
      if (!run) {
        this.runningRuns.delete(bgRunId)
        this.checkpointTimestamps.delete(bgRunId)
        continue
      }

      const lastCheckpointTime = this.checkpointTimestamps.get(bgRunId) ?? new Date(run.startedAt ?? 0).getTime()
      const timeSinceLastCheckpoint = now - lastCheckpointTime

      if (timeSinceLastCheckpoint > timeoutMs) {
        this.config.backgroundRunStore.incrementRetryCount(bgRunId)
        const updatedRun = this.config.backgroundRunStore.getById(bgRunId)

        if (updatedRun && updatedRun.retryCount >= maxRecoveryAttempts) {
          this.failBackgroundRun(bgRunId, {
            code: 'WATCHDOG_TIMEOUT',
            message: `Background run exceeded max recovery attempts (${maxRecoveryAttempts})`,
          })
        } else {
          this.config.backgroundRunStore.updateStatus(bgRunId, 'recovering')

          this.emitEvent({
            eventId: this.generateId('evt'),
            eventType: 'WatchdogTriggered',
            sourceModule: 'subagent' as SourceModule,
            userId: run.userId,
            sessionId: run.sessionId,
            correlationId: bgRunId,
            relatedRefs: { backgroundRunId: bgRunId },
            payload: {
              backgroundRunId: bgRunId,
              timeSinceLastCheckpointMs: timeSinceLastCheckpoint,
              retryCount: updatedRun?.retryCount ?? 0,
              triggeredAt: new Date().toISOString(),
            },
            sensitivity: 'medium' as SensitivityLevel,
            retentionClass: 'standard' as RetentionClass,
            createdAt: new Date().toISOString(),
          })
        }
      }
    }

    this.processExpiredRuns()
  }

  completeBackgroundRun(bgRunId: string, result: SubagentResult): void {
    const run = this.config.backgroundRunStore.getById(bgRunId)
    if (!run) {
      throw new Error(`Background run not found: ${bgRunId}`)
    }

    if (!['running', 'recovering'].includes(run.status)) {
      throw new Error(`Cannot complete background run with status: ${run.status}`)
    }

    const now = new Date().toISOString()
    this.config.backgroundRunStore.saveResult(bgRunId, result)
    this.config.backgroundRunStore.updateStatus(bgRunId, 'completed')

    this.runningRuns.delete(bgRunId)
    this.checkpointTimestamps.delete(bgRunId)

    const checkpointData = run.checkpointData as { artifactRefs?: string[] } | undefined
    const notification: NotificationRequest = {
      notificationId: this.generateId('notif'),
      backgroundRunId: bgRunId,
      userId: run.userId,
      type: 'completed',
      title: `Background task completed: ${run.agentType}`,
      message: result.response ?? 'Task completed successfully',
      artifactRefs: checkpointData?.artifactRefs,
      createdAt: now,
    }
    this.pendingNotifications.push(notification)

    this.emitEvent({
      eventId: this.generateId('evt'),
      eventType: 'BackgroundRunCompleted',
      sourceModule: 'subagent' as SourceModule,
      userId: run.userId,
      sessionId: run.sessionId,
      correlationId: bgRunId,
      relatedRefs: { backgroundRunId: bgRunId },
      payload: {
        backgroundRunId: bgRunId,
        agentType: run.agentType,
        resultStatus: result.status,
        iterationsUsed: result.iterationsUsed,
        completedAt: now,
      },
      sensitivity: 'low' as SensitivityLevel,
      retentionClass: 'standard' as RetentionClass,
      createdAt: now,
    })

    this.processQueue()
  }

  failBackgroundRun(bgRunId: string, error: { code: string; message: string }): void {
    const run = this.config.backgroundRunStore.getById(bgRunId)
    if (!run) {
      throw new Error(`Background run not found: ${bgRunId}`)
    }

    const now = new Date().toISOString()
    this.config.backgroundRunStore.updateStatus(bgRunId, 'failed')

    const updatedRun = this.config.backgroundRunStore.getById(bgRunId)
    if (updatedRun) {
      updatedRun.errorMessage = error.message
      updatedRun.updatedAt = now
    }

    this.runningRuns.delete(bgRunId)
    this.checkpointTimestamps.delete(bgRunId)

    const checkpointData = run.checkpointData as { artifactRefs?: string[] } | undefined
    const notification: NotificationRequest = {
      notificationId: this.generateId('notif'),
      backgroundRunId: bgRunId,
      userId: run.userId,
      type: 'failed',
      title: `Background task failed: ${run.agentType}`,
      message: error.message,
      artifactRefs: checkpointData?.artifactRefs,
      createdAt: now,
    }
    this.pendingNotifications.push(notification)

    this.emitEvent({
      eventId: this.generateId('evt'),
      eventType: 'BackgroundRunFailed',
      sourceModule: 'subagent' as SourceModule,
      userId: run.userId,
      sessionId: run.sessionId,
      correlationId: bgRunId,
      relatedRefs: { backgroundRunId: bgRunId },
      payload: {
        backgroundRunId: bgRunId,
        agentType: run.agentType,
        errorCode: error.code,
        errorMessage: error.message,
        failedAt: now,
      },
      sensitivity: 'medium' as SensitivityLevel,
      retentionClass: 'standard' as RetentionClass,
      createdAt: now,
    })

    this.processQueue()
  }

  cancelBackgroundRun(bgRunId: string): void {
    const run = this.config.backgroundRunStore.getById(bgRunId)
    if (!run) {
      throw new Error(`Background run not found: ${bgRunId}`)
    }

    if (!['queued', 'running', 'recovering'].includes(run.status)) {
      throw new Error(`Cannot cancel background run with status: ${run.status}`)
    }

    const now = new Date().toISOString()
    this.config.backgroundRunStore.updateStatus(bgRunId, 'cancelled')

    this.runningRuns.delete(bgRunId)
    this.checkpointTimestamps.delete(bgRunId)

    const checkpointData = run.checkpointData as { artifactRefs?: string[] } | undefined
    const notification: NotificationRequest = {
      notificationId: this.generateId('notif'),
      backgroundRunId: bgRunId,
      userId: run.userId,
      type: 'cancelled',
      title: `Background task cancelled: ${run.agentType}`,
      message: 'The background task was cancelled',
      artifactRefs: checkpointData?.artifactRefs,
      createdAt: now,
    }
    this.pendingNotifications.push(notification)

    this.emitEvent({
      eventId: this.generateId('evt'),
      eventType: 'BackgroundRunCancelled',
      sourceModule: 'subagent' as SourceModule,
      userId: run.userId,
      sessionId: run.sessionId,
      correlationId: bgRunId,
      relatedRefs: { backgroundRunId: bgRunId },
      payload: {
        backgroundRunId: bgRunId,
        agentType: run.agentType,
        cancelledAt: now,
      },
      sensitivity: 'low' as SensitivityLevel,
      retentionClass: 'standard' as RetentionClass,
      createdAt: now,
    })

    this.processQueue()
  }

  getBackgroundRun(bgRunId: string): BackgroundRun | null {
    return this.config.backgroundRunStore.getById(bgRunId)
  }

  getRunningCount(): number {
    return this.runningRuns.size
  }

  getQueuedCount(): number {
    return this.config.backgroundRunStore.getByStatus('queued').length
  }

  getPendingNotifications(): NotificationRequest[] {
    return [...this.pendingNotifications]
  }

  private processExpiredRuns(): void {
    const expiredRuns = this.config.backgroundRunStore.getExpiredRuns()
    for (const run of expiredRuns) {
      if (run.status === 'queued') {
        this.config.backgroundRunStore.updateStatus(run.backgroundRunId, 'expired')

        this.emitEvent({
          eventId: this.generateId('evt'),
          eventType: 'BackgroundRunExpired',
          sourceModule: 'subagent' as SourceModule,
          userId: run.userId,
          sessionId: run.sessionId,
          correlationId: run.backgroundRunId,
          relatedRefs: { backgroundRunId: run.backgroundRunId },
          payload: {
            backgroundRunId: run.backgroundRunId,
            agentType: run.agentType,
            expiredAt: new Date().toISOString(),
          },
          sensitivity: 'low' as SensitivityLevel,
          retentionClass: 'standard' as RetentionClass,
          createdAt: new Date().toISOString(),
        })
      }
    }
  }

  private processQueue(): void {
    const queuedRuns = this.config.backgroundRunStore.getByStatus('queued')
    const availableSlots = this.config.maxConcurrentRuns - this.runningRuns.size

    if (availableSlots <= 0 || queuedRuns.length === 0) {
      return
    }

    const sortedRuns = queuedRuns
      .filter((r) => !r.scheduledAt || new Date(r.scheduledAt) <= new Date())
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    const toStart = sortedRuns.slice(0, availableSlots)
    for (const run of toStart) {
      this.startBackgroundRun(run.backgroundRunId).catch(() => {
        // Fire-and-forget: errors during background run startup are handled
        // internally by startBackgroundRun via event emission
      })
    }
  }

  private emitEvent(event: EventRecord): void {
    this.config.eventStore.append(event)
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

export function createBackgroundRuntime(config: BackgroundRuntimeConfig): BackgroundRuntime {
  return new BackgroundRuntimeImpl(config)
}
