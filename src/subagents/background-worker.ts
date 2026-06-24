import type { BackgroundRuntime } from './background-runtime.js'
import type { SubagentRuntime, SubagentTaskSpec, SubagentResult, LaunchSubagentInput } from './types.js'
import type { BackgroundRunStore, BackgroundRun } from '../storage/background-run-store.js'
import type { ContextBundle, InvocationSource } from '../context/types.js'

declare function setInterval(callback: (...args: unknown[]) => void, ms: number): unknown
declare function clearInterval(timer: unknown): void

export interface BackgroundSubagentWorker {
  tick(): Promise<void>
  start(): void
  stop(): void
}

export interface BackgroundSubagentWorkerDeps {
  backgroundRuntime: BackgroundRuntime
  subagentRuntime: SubagentRuntime
  backgroundRunStore: BackgroundRunStore
  pollIntervalMs?: number
}

export interface BackgroundSubagentWorkerInstance extends BackgroundSubagentWorker {
  registerTaskSpec(bgRunId: string, taskSpec: SubagentTaskSpec): void
}

const DEFAULT_POLL_INTERVAL_MS = 5_000

class BackgroundSubagentWorkerImpl implements BackgroundSubagentWorkerInstance {
  private backgroundRuntime: BackgroundRuntime
  private subagentRuntime: SubagentRuntime
  private backgroundRunStore: BackgroundRunStore
  private pollIntervalMs: number
  private pollTimer: unknown = null
  private isProcessing = false
  private taskSpecs: Map<string, SubagentTaskSpec> = new Map()
  private inFlight: Set<string> = new Set()

  constructor(deps: BackgroundSubagentWorkerDeps) {
    this.backgroundRuntime = deps.backgroundRuntime
    this.subagentRuntime = deps.subagentRuntime
    this.backgroundRunStore = deps.backgroundRunStore
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  }

  registerTaskSpec(bgRunId: string, taskSpec: SubagentTaskSpec): void {
    this.taskSpecs.set(bgRunId, taskSpec)
  }

  async tick(): Promise<void> {
    if (this.isProcessing) {
      return
    }

    this.isProcessing = true
    try {
      const queuedRuns = this.backgroundRunStore.getByStatus('queued')
      const availableSlots = Math.max(0, this.getMaxConcurrent() - this.backgroundRuntime.getRunningCount())

      if (availableSlots <= 0 || queuedRuns.length === 0) {
        return
      }

      const readyRuns = queuedRuns.filter(
        (run) =>
          !this.inFlight.has(run.backgroundRunId) && (!run.scheduledAt || new Date(run.scheduledAt) <= new Date()),
      )

      readyRuns.sort((a, b) => {
        const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0)
        if (priorityDiff !== 0) return priorityDiff
        return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
      })

      const toProcess = readyRuns.slice(0, availableSlots)
      const promises = toProcess.map((run) => this.processRun(run))
      await Promise.allSettled(promises)
    } finally {
      this.isProcessing = false
    }
  }

  start(): void {
    if (this.pollTimer !== null) {
      return
    }

    this.pollTimer = setInterval(() => {
      this.tick().catch(() => {})
    }, this.pollIntervalMs)

    this.tick().catch(() => {})
  }

  stop(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async processRun(run: BackgroundRun): Promise<void> {
    const bgRunId = run.backgroundRunId
    this.inFlight.add(bgRunId)

    try {
      const taskSpec = this.resolveTaskSpec(bgRunId, run)
      if (!taskSpec) {
        this.backgroundRuntime.failBackgroundRun(bgRunId, {
          code: 'MISSING_TASK_SPEC',
          message: `No task spec registered for background run ${bgRunId}`,
        })
        return
      }

      await this.backgroundRuntime.startBackgroundRun(bgRunId)

      const parentContext = this.buildMinimalContext(run)

      const launchInput: LaunchSubagentInput = {
        taskSpec,
        parentContext,
        parentRunId: bgRunId,
        rootRunId: bgRunId,
      }
      const subagentRun = this.subagentRuntime.launchSubagent(launchInput)

      this.persistSubagentRunId(bgRunId, subagentRun.subagentRunId)

      const result: SubagentResult = await this.subagentRuntime.executeSubagent(subagentRun.subagentRunId)

      if (result.status === 'completed') {
        this.backgroundRuntime.completeBackgroundRun(bgRunId, result)
      } else if (result.status === 'cancelled') {
        this.backgroundRuntime.cancelBackgroundRun(bgRunId)
      } else {
        this.backgroundRuntime.failBackgroundRun(
          bgRunId,
          result.error ?? {
            code: 'SUBAGENT_FAILED',
            message: 'Subagent execution failed without a specific error',
          },
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.backgroundRuntime.failBackgroundRun(bgRunId, {
        code: 'WORKER_EXECUTION_ERROR',
        message,
      })
    } finally {
      this.inFlight.delete(bgRunId)
      this.taskSpecs.delete(bgRunId)
    }
  }

  private resolveTaskSpec(bgRunId: string, run: BackgroundRun): SubagentTaskSpec | undefined {
    const registered = this.taskSpecs.get(bgRunId)
    if (registered) return registered

    if (run.checkpointData && typeof run.checkpointData === 'object') {
      const data = run.checkpointData as Record<string, unknown>
      if (data.taskSpec && typeof data.taskSpec === 'object') {
        return data.taskSpec as SubagentTaskSpec
      }
    }

    return undefined
  }

  private buildMinimalContext(run: BackgroundRun): ContextBundle {
    const bundleId = `ctx-${hashToBase36(run.backgroundRunId)}`

    const pinnedItems: ContextBundle['pinnedItems'] = []

    // Include sessionId in a pinned context item so extractSessionId() in
    // kernel-adapter can discover it. This is required for todo tool calls
    // that need to scope to the originating session.
    if (run.sessionId) {
      pinnedItems.push({
        itemId: `${bundleId}-session-ref`,
        sourceType: 'system_note',
        semanticType: 'entity_state',
        content: `sessionId=${run.sessionId}`,
        priority: 90,
        isPinned: true,
        structuredPayload: { sessionId: run.sessionId },
      })
    }

    return {
      bundleId,
      runId: run.backgroundRunId,
      agentId: `background.${run.agentType}.${run.backgroundRunId}`,
      agentType: 'background',
      userId: run.userId,
      invocationSource: 'background_subagent' as InvocationSource,
      pinnedItems,
      orderedItems: [...pinnedItems],
      tokenEstimate: 0,
    }
  }

  private persistSubagentRunId(bgRunId: string, subagentRunId: string): void {
    const run = this.backgroundRunStore.getById(bgRunId)
    if (run) {
      run.subagentRunId = subagentRunId
    }
  }

  private getMaxConcurrent(): number {
    return 10
  }
}

function hashToBase36(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  return Math.abs(hash).toString(36)
}

export function createBackgroundSubagentWorker(deps: BackgroundSubagentWorkerDeps): BackgroundSubagentWorkerInstance {
  return new BackgroundSubagentWorkerImpl(deps)
}
