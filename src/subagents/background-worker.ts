import type { BackgroundRuntime } from './background-runtime.js'
import type { SubagentRuntime, SubagentTaskSpec, SubagentResult, LaunchSubagentInput } from './types.js'
import type { BackgroundRunStore, BackgroundRun } from '../storage/background-run-store.js'
import type { ContextBundle, InvocationSource } from '../context/types.js'
import type { ChildSessionTaskRuntime, ChildTaskSpec } from './child-session-task-runtime.js'
import { toChildTaskTerminalError } from '../foreground/tools/child-task-contract.js'

declare function setInterval(callback: (...args: unknown[]) => void, ms: number): unknown
declare function clearInterval(timer: unknown): void

export interface BackgroundSubagentWorker {
  tick(): Promise<void>
  start(): void
  stop(): void
}

export interface BackgroundSubagentWorkerDeps {
  backgroundRuntime: BackgroundRuntime
  subagentRuntime?: SubagentRuntime
  /** Preferred runner: creates the child session + subagent_runs attempt with persisted linkage. */
  childTaskRuntime?: ChildSessionTaskRuntime
  backgroundRunStore: BackgroundRunStore
  pollIntervalMs?: number
}

export interface BackgroundSubagentWorkerInstance extends BackgroundSubagentWorker {
  registerTaskSpec(bgRunId: string, taskSpec: SubagentTaskSpec): void
}

const DEFAULT_POLL_INTERVAL_MS = 5_000

class BackgroundSubagentWorkerImpl implements BackgroundSubagentWorkerInstance {
  private backgroundRuntime: BackgroundRuntime
  private subagentRuntime?: SubagentRuntime
  private childTaskRuntime?: ChildSessionTaskRuntime
  private backgroundRunStore: BackgroundRunStore
  private pollIntervalMs: number
  private pollTimer: unknown = null
  private isProcessing = false
  private taskSpecs: Map<string, SubagentTaskSpec> = new Map()
  private inFlight: Set<string> = new Set()

  constructor(deps: BackgroundSubagentWorkerDeps) {
    this.backgroundRuntime = deps.backgroundRuntime
    this.subagentRuntime = deps.subagentRuntime
    this.childTaskRuntime = deps.childTaskRuntime
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
          message: `No valid task spec persisted for background run ${bgRunId}; the run was not launched`,
        })
        return
      }

      await this.backgroundRuntime.startBackgroundRun(bgRunId)

      const parentContext = this.buildMinimalContext(run)
      const result = await this.executeWithRuntime(bgRunId, run, taskSpec, parentContext)
      this.finishRun(bgRunId, result)
    } catch (error) {
      const terminal = toChildTaskTerminalError(error, { code: 'WORKER_EXECUTION_ERROR', phase: 'run' })
      this.backgroundRuntime.failBackgroundRun(bgRunId, { code: terminal.code, message: terminal.message })
    } finally {
      this.inFlight.delete(bgRunId)
      this.taskSpecs.delete(bgRunId)
    }
  }

  private async executeWithRuntime(
    bgRunId: string,
    run: BackgroundRun,
    taskSpec: SubagentTaskSpec,
    parentContext: ContextBundle,
  ): Promise<SubagentResult> {
    if (this.childTaskRuntime) {
      const persisted = taskSpec as ChildTaskSpec
      const childSpec: ChildTaskSpec = {
        ...persisted,
        profileId: persisted.profileId ?? run.agentProfile ?? persisted.agentType ?? run.agentType,
        parentSessionId: persisted.parentSessionId ?? run.sessionId ?? '',
        launchMode: 'background',
      }
      if (!childSpec.parentSessionId) {
        throw new Error(`No parent session id available for background run ${bgRunId}`)
      }

      const launch = this.childTaskRuntime.launchTask({
        parentContext,
        taskSpec: childSpec,
        depth: 1,
        launchesInParentTurn: 0,
        parentRunId: bgRunId,
        rootRunId: bgRunId,
        backgroundRunId: bgRunId,
      })

      this.backgroundRunStore.linkChildTask(bgRunId, {
        subagentRunId: launch.subagentRunId,
        taskId: launch.taskId,
        childSessionId: launch.childSessionId,
      })

      return this.childTaskRuntime.executeRun(launch.subagentRunId)
    }

    if (!this.subagentRuntime) {
      throw new Error(`No subagent runtime configured for background run ${bgRunId}`)
    }

    const launchInput: LaunchSubagentInput = {
      taskSpec,
      parentContext,
      parentRunId: bgRunId,
      rootRunId: bgRunId,
    }
    const subagentRun = this.subagentRuntime.launchSubagent(launchInput)
    this.backgroundRunStore.linkChildTask(bgRunId, {
      subagentRunId: subagentRun.subagentRunId,
      taskId: subagentRun.subagentRunId,
      childSessionId: subagentRun.subagentRunId,
    })
    return this.subagentRuntime.executeSubagent(subagentRun.subagentRunId)
  }

  private finishRun(bgRunId: string, result: SubagentResult): void {
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
  }

  private resolveTaskSpec(bgRunId: string, run: BackgroundRun): SubagentTaskSpec | undefined {
    if (run.taskSpec && typeof run.taskSpec === 'object') {
      const spec = run.taskSpec as Record<string, unknown>
      if (typeof spec.objective === 'string' && spec.objective.length > 0) {
        return spec as unknown as SubagentTaskSpec
      }
    }

    const registered = this.taskSpecs.get(bgRunId)
    if (registered) return registered

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
