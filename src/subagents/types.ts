import type { ContextBundle } from '../context/types.js'
import type { KernelRunResult } from '../kernel/types.js'
import type { SubagentRunStore } from '../storage/subagent-run-store.js'
import type { SubagentTranscriptStore } from '../storage/subagent-transcript-store.js'
import type { SubagentDefinition } from './registry.js'

export type SubagentRunState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SubagentTaskSpec {
  objective: string
  tools?: string[]
  maxIterations?: number
  timeoutMs?: number
  /** Profile label (e.g. 'document_processor'), NOT a runtime boundary. See AgentType for lifecycle types. */
  agentType?: string
}

export interface SubagentResult {
  status: 'completed' | 'failed' | 'cancelled'
  response?: string
  toolCalls: Array<{
    toolCallId: string
    toolName: string
    params: Record<string, unknown>
  }>
  error?: {
    code: string
    message: string
  }
  iterationsUsed: number
  startedAt?: string
  completedAt?: string
}

export interface SubagentContext {
  isolatedContext: ContextBundle
  parentContextRef?: {
    runId: string
    bundleId: string
  }
}

export interface SubagentRun {
  subagentRunId: string
  taskSpec: SubagentTaskSpec
  parentRunId: string
  rootRunId: string
  status: SubagentRunState
  result?: SubagentResult
  contextBundle: ContextBundle
  createdAt: string
  startedAt?: string
  completedAt?: string
  isCancelled: boolean
}

export interface SubagentConfig {
  kernelAdapter: KernelAdapter
  contextManager: SubagentContextManager
  maxConcurrent: number
  defaultTimeoutMs?: number
  defaultMaxIterations?: number
  /** Persistent store for subagent runs. If not provided, falls back to in-memory Map. */
  runStore?: SubagentRunStore
  /** Optional transcript store for recording execution events. */
  transcriptStore?: SubagentTranscriptStore
}

export interface KernelAdapter {
  execute(options: {
    contextBundle: ContextBundle
    maxIterations: number
    timeoutMs: number
    onCancel?: () => boolean
  }): Promise<KernelRunResult>
}

export interface SubagentContextManager {
  createIsolatedContext(options: {
    parentContext: ContextBundle
    taskSpec: SubagentTaskSpec
    subagentRunId: string
    definition?: SubagentDefinition
  }): ContextBundle
}

export interface LaunchSubagentInput {
  taskSpec: SubagentTaskSpec
  parentContext: ContextBundle
  parentRunId?: string
  rootRunId?: string
}

export interface SubagentRuntime {
  launchSubagent(input: LaunchSubagentInput): SubagentRun
  executeSubagent(subagentRunId: string): Promise<SubagentResult>
  cancelSubagent(subagentRunId: string): SubagentResult
  getSubagentResult(subagentRunId: string): SubagentResult | undefined
  getSubagentRun(subagentRunId: string): SubagentRun | undefined
}
