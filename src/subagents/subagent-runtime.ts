import type { SubagentRun, SubagentResult, SubagentConfig, LaunchSubagentInput, SubagentRuntime } from './types.js'
import type { KernelRunResult } from '../kernel/types.js'
import type { ContextBundle } from '../context/types.js'
import type { SubagentRunStore, SubagentRunRecord } from '../storage/subagent-run-store.js'
import type { SubagentTranscriptStore } from '../storage/subagent-transcript-store.js'

export class SubagentRuntimeImpl implements SubagentRuntime {
  private config: SubagentConfig
  private runs = new Map<string, SubagentRun>()
  private runStore?: SubagentRunStore
  private transcriptStore?: SubagentTranscriptStore

  constructor(config: SubagentConfig) {
    this.config = config
    this.runStore = config.runStore
    this.transcriptStore = config.transcriptStore
  }

  launchSubagent(input: LaunchSubagentInput): SubagentRun {
    const subagentRunId = this.generateId('subagent')
    const now = new Date().toISOString()

    const parentRunId = input.parentRunId ?? input.parentContext.runId
    const rootRunId = input.rootRunId ?? parentRunId

    const contextBundle = this.config.contextManager.createIsolatedContext({
      parentContext: input.parentContext,
      taskSpec: input.taskSpec,
      subagentRunId,
    })

    const run: SubagentRun = {
      subagentRunId,
      taskSpec: input.taskSpec,
      parentRunId,
      rootRunId,
      status: 'queued',
      contextBundle,
      createdAt: now,
      isCancelled: false,
    }

    this.runs.set(subagentRunId, run)

    if (this.runStore) {
      this.runStore.create({
        subagentRunId,
        userId: input.parentContext.userId,
        sessionId: this.extractSessionId(input.parentContext),
        parentRunId,
        rootRunId,
        agentType: input.taskSpec.agentType ?? 'unknown',
        status: 'queued',
        taskSpecJson: JSON.stringify(input.taskSpec),
        contextBundleJson: JSON.stringify(contextBundle),
        createdAt: now,
        updatedAt: now,
      })
    }

    this.recordTranscript(subagentRunId, 'SubagentRunCreated', {
      subagentRunId,
      agentType: input.taskSpec.agentType,
      objective: input.taskSpec.objective,
      parentRunId,
      rootRunId,
    })

    return run
  }

  async executeSubagent(subagentRunId: string): Promise<SubagentResult> {
    const run = this.runs.get(subagentRunId)
    if (!run) {
      throw new Error(`Subagent run not found: ${subagentRunId}`)
    }

    if (run.isCancelled) {
      const cancelledResult = this.createCancelledResult()
      run.result = cancelledResult
      run.status = 'cancelled'
      run.completedAt = new Date().toISOString()
      this.persistRunState(run)
      return cancelledResult
    }

    run.status = 'running'
    run.startedAt = new Date().toISOString()
    this.persistRunState(run)

    this.recordTranscript(subagentRunId, 'SubagentRunStarted', {
      subagentRunId,
      startedAt: run.startedAt,
    })

    const maxIterations = run.taskSpec.maxIterations ?? this.config.defaultMaxIterations ?? 10
    const timeoutMs = run.taskSpec.timeoutMs ?? this.config.defaultTimeoutMs ?? 60000

    try {
      const kernelResult = await this.config.kernelAdapter.execute({
        contextBundle: run.contextBundle,
        maxIterations,
        timeoutMs,
        onCancel: () => run.isCancelled,
      })

      const result = this.mapKernelResultToSubagentResult(kernelResult)
      run.result = result
      run.status = result.status === 'completed' ? 'completed' : 'failed'
      run.completedAt = new Date().toISOString()
      this.persistRunState(run)

      this.recordTranscript(subagentRunId, 'SubagentRunCompleted', {
        subagentRunId,
        status: run.status,
        iterationsUsed: result.iterationsUsed,
        completedAt: run.completedAt,
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failedResult: SubagentResult = {
        status: 'failed',
        response: undefined,
        toolCalls: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: errorMessage,
        },
        iterationsUsed: 0,
        startedAt: run.startedAt,
        completedAt: new Date().toISOString(),
      }

      run.result = failedResult
      run.status = 'failed'
      run.completedAt = new Date().toISOString()
      this.persistRunState(run)

      this.recordTranscript(subagentRunId, 'SubagentRunFailed', {
        subagentRunId,
        errorCode: 'EXECUTION_ERROR',
        errorMessage,
        completedAt: run.completedAt,
      })

      return failedResult
    }
  }

  cancelSubagent(subagentRunId: string): SubagentResult {
    const run = this.runs.get(subagentRunId)
    if (!run) {
      throw new Error(`Subagent run not found: ${subagentRunId}`)
    }

    run.isCancelled = true

    const cancelledResult = this.createCancelledResult()
    run.result = cancelledResult
    run.status = 'cancelled'
    run.completedAt = new Date().toISOString()
    this.persistRunState(run)

    this.recordTranscript(subagentRunId, 'SubagentRunCancelled', {
      subagentRunId,
      completedAt: run.completedAt,
    })

    return cancelledResult
  }

  getSubagentResult(subagentRunId: string): SubagentResult | undefined {
    const run = this.runs.get(subagentRunId)
    if (run) {
      return run.result
    }

    if (this.runStore) {
      const record = this.runStore.getById(subagentRunId)
      if (record?.resultJson) {
        try {
          return JSON.parse(record.resultJson) as SubagentResult
        } catch {
          return undefined
        }
      }
    }

    return undefined
  }

  getSubagentRun(subagentRunId: string): SubagentRun | undefined {
    const run = this.runs.get(subagentRunId)
    if (run) {
      return run
    }

    if (this.runStore) {
      const record = this.runStore.getById(subagentRunId)
      if (record) {
        return this.recordToRun(record)
      }
    }

    return undefined
  }

  private persistRunState(run: SubagentRun): void {
    if (!this.runStore) {
      return
    }

    this.runStore.updateStatus(run.subagentRunId, run.status)

    if (run.result) {
      this.runStore.saveResult(run.subagentRunId, run.result)
    }
  }

  private recordTranscript(subagentRunId: string, eventType: string, content: unknown): void {
    if (!this.transcriptStore) {
      return
    }

    this.transcriptStore.append({
      id: `transcript-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      subagentRunId,
      eventType,
      contentJson: JSON.stringify(content),
      createdAt: new Date().toISOString(),
    })
  }

  private recordToRun(record: SubagentRunRecord): SubagentRun {
    let contextBundle
    try {
      contextBundle = record.contextBundleJson
        ? JSON.parse(record.contextBundleJson)
        : this.createMinimalContext(record)
    } catch {
      contextBundle = this.createMinimalContext(record)
    }

    let result: SubagentResult | undefined
    if (record.resultJson) {
      try {
        result = JSON.parse(record.resultJson) as SubagentResult
      } catch {
        result = undefined
      }
    }

    let taskSpec
    try {
      taskSpec = JSON.parse(record.taskSpecJson)
    } catch {
      taskSpec = { objective: 'Unknown task' }
    }

    return {
      subagentRunId: record.subagentRunId,
      taskSpec,
      parentRunId: record.parentRunId ?? record.subagentRunId,
      rootRunId: record.rootRunId ?? record.subagentRunId,
      status: record.status as SubagentRun['status'],
      result,
      contextBundle,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      isCancelled: record.status === 'cancelled',
    }
  }

  private createMinimalContext(record: SubagentRunRecord): ContextBundle {
    return {
      bundleId: `bundle-${record.subagentRunId}`,
      runId: record.subagentRunId,
      agentId: `subagent.${record.agentType}`,
      agentType: record.agentType,
      userId: record.userId,
      invocationSource: 'subagent_runtime',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 0,
    }
  }

  private extractSessionId(context: ContextBundle): string | undefined {
    for (const item of context.orderedItems) {
      if (item.structuredPayload?.sessionId) {
        return item.structuredPayload.sessionId as string
      }
    }
    for (const item of context.pinnedItems) {
      if (item.structuredPayload?.sessionId) {
        return item.structuredPayload.sessionId as string
      }
    }
    return undefined
  }

  private mapKernelResultToSubagentResult(kernelResult: KernelRunResult): SubagentResult {
    const status = this.mapKernelStatusToSubagentStatus(kernelResult.finalStatus)

    return {
      status,
      response: kernelResult.finalResponse,
      toolCalls: kernelResult.toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        params: tc.params,
      })),
      error: kernelResult.error,
      iterationsUsed: kernelResult.iterationsUsed,
    }
  }

  private mapKernelStatusToSubagentStatus(kernelStatus: KernelRunResult['finalStatus']): SubagentResult['status'] {
    switch (kernelStatus) {
      case 'completed':
        return 'completed'
      case 'failed':
      case 'timeout':
      case 'max_iterations_reached':
        return 'failed'
      default:
        return 'failed'
    }
  }

  private createCancelledResult(): SubagentResult {
    const now = new Date().toISOString()
    return {
      status: 'cancelled',
      response: undefined,
      toolCalls: [],
      error: {
        code: 'CANCELLED',
        message: 'Subagent execution was cancelled',
      },
      iterationsUsed: 0,
      completedAt: now,
    }
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

export function createSubagentRuntime(config: SubagentConfig): SubagentRuntime {
  return new SubagentRuntimeImpl(config)
}
