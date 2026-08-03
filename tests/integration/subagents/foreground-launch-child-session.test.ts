/**
 * Foreground Launch Child Session — integration tests (Todo 10 of
 * opencode-like-subagent-sessions).
 *
 * Routes the generic `foreground_launch_subagent` tool through the unified
 * ChildSessionTaskRuntime while preserving the legacy required input and
 * response fields:
 *   - old payloads launch a foreground child and return the old result fields
 *     (runtimeActionId/agentType/agentProfile/dispatchResult) PLUS the child
 *     metadata (taskId/childSessionId/subagentRunId)
 *   - `background=true` returns BEFORE completion through the Todo 9
 *     background machinery (enqueue -> worker -> child session -> notification)
 *   - `taskId` resumes the SAME child session with a NEW subagent_runs attempt
 *   - `foreground_status_query` and `foreground_cancel_or_modify_task` resolve
 *     BOTH new IDs (taskId/childSessionId) AND legacy IDs (runtimeActionId/
 *     subagentRunId)
 *   - unknown profiles and foreign taskIds fail safely with typed codes and
 *     NO child session/run row created
 *   - the ninth launch in a parent turn and a depth-4 launch return the typed
 *     limit errors (SUBAGENT_LAUNCH_LIMIT_EXCEEDED / SUBAGENT_DEPTH_EXCEEDED)
 *
 * The harness exercises REAL stores, REAL registries, a REAL
 * ChildSessionTaskRuntime over a REAL child kernel, the REAL background
 * runtime + worker, and the REAL foreground tool handlers — no hand-rolled
 * doubles for the runtime under test.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSessionStore, type SessionStore } from '../../../src/storage/session-store.js'
import { createSubagentRunStore, type SubagentRunStore } from '../../../src/storage/subagent-run-store.js'
import {
  createSubagentTranscriptStore,
  type SubagentTranscriptStore,
} from '../../../src/storage/subagent-transcript-store.js'
import { createToolResultStore, type ToolResultStore } from '../../../src/storage/tool-result-store.js'
import { createBackgroundRunStore, type BackgroundRunStore } from '../../../src/storage/background-run-store.js'
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js'
import { createProviderConfigStore } from '../../../src/storage/provider-config-store.js'
import { createAgentConfigStore } from '../../../src/storage/agent-config-store.js'
import { createSubagentRegistry, type SubagentRegistry } from '../../../src/subagents/registry.js'
import { registerBuiltInSubagents } from '../../../src/subagents/builtin-definitions.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolDefinition, ToolCategory, ToolExecutionResult } from '../../../src/tools/types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import {
  createAgentProfileRegistry,
  registerSystemProfiles,
  type AgentProfileRegistry,
} from '../../../src/taxonomy/agent-profile-registry.js'
import { createAllowedDecision } from '../../../src/permissions/types.js'
import { createToolExecutor } from '../../../src/tools/tool-executor.js'
import {
  createChildSessionTaskRuntime,
  type ChildSessionTaskRuntime,
} from '../../../src/subagents/child-session-task-runtime.js'
import { createSubagentKernelAdapter } from '../../../src/subagents/kernel-adapter.js'
import { createBackgroundRuntime, type BackgroundRuntime } from '../../../src/subagents/background-runtime.js'
import {
  createBackgroundSubagentWorker,
  type BackgroundSubagentWorkerInstance,
} from '../../../src/subagents/background-worker.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type {
  KernelConfig,
  RuntimeDispatcher as KernelRuntimeDispatcher,
  ToolExecutor as KernelToolExecutor,
  ContextManager,
  TokenStreamBroadcaster,
} from '../../../src/kernel/types.js'
import type { ModelInputBuildInput, BuiltModelInput } from '../../../src/kernel/model-input/model-input-types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { createLLMAdapter, type LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMProvider, ProviderHealthStatus, ProviderStats } from '../../../src/llm/provider.js'
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js'
import type { CircuitBreaker } from '../../../src/llm/circuit-breaker.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type { RuntimeDispatcher as DispatcherRuntimeDispatcher } from '../../../src/dispatcher/types.js'
import {
  handleLaunchSubagent,
  type LaunchSubagentDeps,
  type ForegroundChildTaskData,
} from '../../../src/foreground/tools/subagent-launch-tool.js'
import { handleStatusQuery, type StatusQueryDeps } from '../../../src/foreground/tools/status-query-tool.js'
import {
  handleCancelOrModifyTask,
  type CancelModifyDeps,
} from '../../../src/foreground/tools/cancel-modify-task-tool.js'
import { SUBAGENT_PROFILE_UNKNOWN } from '../../../src/subagents/child-task-policy.js'

const CHILD_FINAL_TEXT = 'CHILD_FINAL_ANSWER_SENTINEL'

// ---------------------------------------------------------------------------
// Scripted mock provider — queue based; records every LLM request.
// ---------------------------------------------------------------------------

interface QueueEntry {
  content?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  delayMs?: number
}

class ScriptedChildProvider implements LLMProvider {
  readonly id = 'mock'
  readonly queue: QueueEntry[] = []
  readonly requests: LLMRequest[] = []

  readonly config = {
    id: 'mock',
    name: 'Scripted Child Provider',
    enabled: true,
    priority: 1,
    timeoutMs: 60000,
    retries: 0,
    capabilities: {
      supportsStreaming: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsVision: false,
      maxTokens: 65536,
      supportedModels: ['mock-model'],
    },
  }

  readonly circuitBreaker: CircuitBreaker = {
    get state() {
      return 'CLOSED' as const
    },
    get config() {
      return { failureThreshold: 5, resetTimeoutMs: 30000, successThreshold: 2 }
    },
    get stats() {
      return {
        state: 'CLOSED' as const,
        failureCount: 0,
        successCount: 0,
        totalRequests: 0,
        rejectedRequests: 0,
      }
    },
    recordSuccess: () => {},
    recordFailure: () => {},
    canExecute: () => true,
    reset: () => {},
    forceOpen: () => {},
    forceClose: () => {},
  }

  readonly health: ProviderHealthStatus = 'healthy'

  readonly stats: ProviderStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    timeoutRequests: 0,
    averageLatencyMs: 0,
    healthStatus: 'healthy',
  }

  enqueue(entry: QueueEntry): void {
    this.queue.push(entry)
  }

  get hasPending(): boolean {
    return this.queue.length > 0
  }

  isHealthy(): boolean {
    return true
  }

  getStats(): ProviderStats {
    return { ...this.stats }
  }

  updateConfig(): void {}
  resetStats(): void {}

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.requests.push(request)
    const next = this.queue.shift()
    if (!next) {
      throw new Error(`Scripted provider out of queued responses (request ${this.requests.length})`)
    }
    if (next.delayMs && next.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, next.delayMs))
    }
    const finishReason = next.toolCalls && next.toolCalls.length > 0 ? 'tool_calls' : 'stop'
    return {
      success: true,
      response: {
        id: `mock-${Date.now()}-${this.requests.length}`,
        model: request.model,
        content: next.content ?? '',
        role: 'assistant',
        finishReason,
        ...(next.toolCalls && next.toolCalls.length > 0
          ? {
              toolCalls: next.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.arguments },
              })),
            }
          : {}),
        createdAt: new Date().toISOString(),
      },
      providerId: this.id,
    }
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const connections: ConnectionManager[] = []

function openMemoryConnection(): ConnectionManager {
  const connection = createConnectionManager(':memory:')
  connection.open()
  connections.push(connection)
  return connection
}

function applyAll(connection: ConnectionManager): void {
  const runner = createMigrationRunner(connection)
  runner.init()
  runner.apply(allStoreMigrations)
}

function registerFixtureTool(
  registry: ReturnType<typeof createToolRegistry>,
  name: string,
  category: ToolCategory,
): void {
  const tool: ToolDefinition = {
    name,
    description: `Fixture tool ${name}`,
    category,
    sensitivity: 'medium',
    schema: { type: 'object', properties: {}, additionalProperties: true },
    handler: () => ({ success: true, data: {} }),
  }
  registry.register(tool)
}

function makeParentBundle(userId: string): ContextBundle {
  return {
    bundleId: 'bundle-parent',
    runId: 'krun_parent',
    agentId: 'main.foreground.default',
    agentType: 'main',
    userId,
    invocationSource: 'gateway_intent',
    pinnedItems: [],
    orderedItems: [],
    tokenEstimate: 0,
  }
}

// ---------------------------------------------------------------------------
// Harness: real stores + registries + runtime + kernel + background machinery
// ---------------------------------------------------------------------------

interface Harness {
  connection: ConnectionManager
  sessionStore: SessionStore
  runStore: SubagentRunStore
  transcriptStore: SubagentTranscriptStore
  toolResultStore: ToolResultStore
  backgroundRunStore: BackgroundRunStore
  eventStore: EventStore
  childRuntime: ChildSessionTaskRuntime
  backgroundRuntime: BackgroundRuntime
  worker: BackgroundSubagentWorkerInstance
  provider: ScriptedChildProvider
  profileRegistry: AgentProfileRegistry
  subagentRegistry: SubagentRegistry
  toolRegistry: ReturnType<typeof createToolRegistry>
  makeLaunchDeps: (overrides?: Partial<LaunchSubagentDeps>) => LaunchSubagentDeps
  statusDeps: StatusQueryDeps
  cancelDeps: CancelModifyDeps
}

function createCapturingModelInputBuilder(): ModelInputBuilder {
  return {
    build: async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
      const messages = [...(input.transcript ?? [])]
      if (input.currentUserMessage) {
        messages.push({ role: 'user', content: input.currentUserMessage })
      }
      return {
        messages,
        segments: {
          staticPrefix: 's',
          tenantProject: '',
          toolPlane: '',
          contextBundle: JSON.stringify(input.contextBundle ?? {}),
        },
        segmentHashes: {
          segmentA: 'a'.repeat(64),
          segmentB: 'b'.repeat(64),
          segmentC: 'c'.repeat(64),
          segmentD: 'd'.repeat(64),
        },
        metadata: {
          mode: input.mode,
          agentKind: input.agentKind ?? 'kernel',
          agentType: input.agentType ?? 'main',
          agentProfile: input.agentProfile ?? 'default_main',
          providerFamily: input.providerFamily,
          messageCount: messages.length,
        },
      }
    },
  } as unknown as ModelInputBuilder
}

function createKernel(
  llmAdapter: LLMAdapter,
  dispatcher: KernelRuntimeDispatcher,
  modelInputBuilder: ModelInputBuilder,
  limits: { maxIterations: number; timeoutMs: number },
): AgentKernel {
  const kernelToolExecutor: KernelToolExecutor = {
    execute: async () => ({ success: true, data: {} }),
  }
  const contextManager: ContextManager = {
    assembleBundle: () => makeParentBundle('user_A'),
    getItems: () => [],
    addItem: () => {},
    applyDelta: () => {},
  }
  const timelineBroadcaster: TokenStreamBroadcaster = {
    broadcastTokenStream: () => {},
    broadcast: () => {},
  }
  const config: KernelConfig = {
    llmAdapter,
    toolExecutor: kernelToolExecutor,
    contextManager,
    dispatcher,
    modelInputBuilder,
    maxIterations: limits.maxIterations,
    timeoutMs: limits.timeoutMs,
    timelineBroadcaster,
  }
  return new AgentKernel(config)
}

function createHarness(): Harness {
  const connection = openMemoryConnection()
  applyAll(connection)

  const sessionStore = createSessionStore(connection)
  const runStore = createSubagentRunStore(connection)
  const transcriptStore = createSubagentTranscriptStore(connection)
  const toolResultStore = createToolResultStore(connection)
  const backgroundRunStore = createBackgroundRunStore(connection)
  const eventStore = createEventStore(connection)
  const providerConfigStore = createProviderConfigStore(connection)
  const agentConfigStore = createAgentConfigStore(connection)

  sessionStore.create({ sessionId: 'sess_parent', userId: 'user_A', title: 'Parent' })
  providerConfigStore.create({
    providerId: 'mock',
    userId: 'user_A',
    providerType: 'mock',
    displayName: 'Mock',
    enabled: true,
    selectedModel: 'mock-model',
  })

  const toolRegistry = createToolRegistry()
  registerFixtureTool(toolRegistry, 'file_read', 'read')
  registerFixtureTool(toolRegistry, 'todolist', 'read')

  const subagentRegistry = createSubagentRegistry()
  registerBuiltInSubagents(subagentRegistry)

  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()
  const profileRegistry = createAgentProfileRegistry()
  registerSystemProfiles(profileRegistry)

  const provider = new ScriptedChildProvider()
  const llmAdapter = createLLMAdapter({
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
    enableLogging: false,
  })
  llmAdapter.addProvider(provider)

  const modelInputBuilder = createCapturingModelInputBuilder()

  // ---- Tool executor (real): allow-all permissions, real registry + envelope.
  const toolExecutor = createToolExecutor({
    registry: toolRegistry,
    permissionEngine: {
      checkPermission: () => createAllowedDecision('allowed for integration test'),
    },
    toolExecutionStore: {
      create: () => {},
      updateStatus: () => {},
      saveResult: () => {},
    },
  })

  // ---- Kernel-side dispatcher: faithful tool-plane routing WITHOUT the 30s
  //      dispatcher race — the foreground wait is bounded only by the budget
  //      threaded into the launch deps.
  const kernelDispatcher: KernelRuntimeDispatcher = {
    async dispatch(request) {
      const tdr = request.action.targetAction?.toolDispatchRequest
      const context = request.context
      const runOne = async (toolCallId: string, toolName: string, params: unknown): Promise<ToolExecutionResult> =>
        toolExecutor.execute({
          toolCallId,
          toolName,
          params,
          userId: context.userId ?? request.action.userId,
          sessionId: context.sessionId,
          kernelRunId: context.kernelRunId,
          permissionContext: {
            userId: context.userId ?? request.action.userId,
            sessionId: context.sessionId ?? '',
            mode: 'ask_on_write',
            grants: [],
          },
          signal: context.signal,
          agentType: context.agentType,
        })

      let results: ToolExecutionResult[]
      if (tdr?.toolUses && tdr.toolUses.length > 0) {
        results = await Promise.all(tdr.toolUses.map((tu) => runOne(tu.toolCallId, tu.toolName, tu.input)))
      } else {
        results = [
          await runOne(
            request.action.targetAction?.toolCallId ?? '',
            request.action.targetAction?.toolName ?? '',
            request.action.targetAction?.params,
          ),
        ]
      }

      return {
        requestId: request.requestId,
        actionId: request.action.actionId,
        status: 'completed',
        targetRuntime: 'tool_plane',
        result: results,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }
    },
  }

  // ---- Child runtime over a REAL child kernel.
  const childKernel = createKernel(llmAdapter, kernelDispatcher, modelInputBuilder, {
    maxIterations: 10,
    timeoutMs: 60000,
  })
  const kernelAdapter: ReturnType<typeof createSubagentKernelAdapter> = createSubagentKernelAdapter({
    agentKernel: childKernel,
    subagentRegistry,
    providerConfigStore,
    agentConfigStore,
    sessionStore,
    toolRegistry,
    envelopeRegistry,
  })
  const childRuntime = createChildSessionTaskRuntime({
    sessionStore,
    runStore,
    transcriptStore,
    kernelAdapter,
    registry: subagentRegistry,
    toolRegistry,
    envelopeRegistry,
    defaultMaxIterations: 10,
    defaultTimeoutMs: 60000,
  })

  // ---- Background machinery (Todo 9) — consumed, not modified.
  const backgroundRuntime = createBackgroundRuntime({
    backgroundRunStore,
    eventStore,
    maxConcurrentRuns: 4,
    watchdogTimeoutMs: 60000,
  })
  const worker = createBackgroundSubagentWorker({
    backgroundRuntime,
    childTaskRuntime: childRuntime,
    backgroundRunStore,
    pollIntervalMs: 1000,
  })

  // ---- Legacy dispatcher placeholder — never reached on the child path.
  const legacyDispatcher: DispatcherRuntimeDispatcher = {
    dispatch: async () => {
      throw new Error('legacy RuntimeDispatcher must not be used when childSessionTaskRuntime is wired')
    },
  }

  const baseLaunchDeps: Omit<LaunchSubagentDeps, 'userId' | 'sessionId' | 'turnId'> = {
    runtimeDispatcher: legacyDispatcher,
    profileRegistry,
    childSessionTaskRuntime: childRuntime,
    backgroundRuntime,
    toolResultStore,
    childTaskRemainingTimeoutMs: 30000,
    sessionStore,
    subagentRunStore: runStore,
  }

  return {
    connection,
    sessionStore,
    runStore,
    transcriptStore,
    toolResultStore,
    backgroundRunStore,
    eventStore,
    childRuntime,
    backgroundRuntime,
    worker,
    provider,
    profileRegistry,
    subagentRegistry,
    toolRegistry,
    makeLaunchDeps: (overrides) => ({
      ...baseLaunchDeps,
      userId: 'user_A',
      sessionId: 'sess_parent',
      turnId: 'turn_1',
      ...overrides,
    }),
    statusDeps: {
      plannerRunStore: { findByUser: () => [] } as never,
      subagentRunStore: runStore,
      approvalStore: { findByUser: () => [] } as never,
      userId: 'user_A',
      sessionId: 'sess_parent',
      turnId: 'turn_1',
    },
    cancelDeps: {
      runtimeDispatcher: legacyDispatcher,
      plannerRunStore: { getById: () => null } as never,
      subagentRunStore: runStore,
      childSessionTaskRuntime: childRuntime,
      userId: 'user_A',
      sessionId: 'sess_parent',
      turnId: 'turn_1',
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for: ${label}`)
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('foreground_launch_subagent routed through child sessions (Todo 10)', () => {
  it(
    'old payload launches a foreground child and returns the legacy fields plus child metadata',
    { timeout: 20000 },
    async () => {
      const h = createHarness()
      h.provider.enqueue({ content: CHILD_FINAL_TEXT })

      const result = await handleLaunchSubagent(h.makeLaunchDeps(), {
        objective: 'research the topic',
        agentType: 'document_processor',
        suggestedTools: ['file_read'],
      })

      expect(result.success).toBe(true)
      // Legacy fields (Todo 5 contract) are preserved.
      expect(result.data?.runtimeActionId).toMatch(/^act_/)
      expect(result.data?.agentType).toBe('document_processor')
      expect(result.data?.agentProfile).toBe('document_processor')
      expect(result.data?.dispatchResult).toBeDefined()
      expect(result.data?.dispatchResult?.status).toBe('completed')
      // Child metadata (Todo 8 contract).
      const data = result.data as unknown as ForegroundChildTaskData
      expect(data.taskId).toBeDefined()
      expect(data.childSessionId).toBe(data.taskId)
      expect(data.subagentRunId).toBeDefined()
      expect(result.runtimeSummary?.runtimeActionIds).toHaveLength(1)

      // Exactly one child session + one subagent run attempt, completed.
      const runs = h.runStore.query({})
      expect(runs).toHaveLength(1)
      expect(runs[0]!.status).toBe('completed')
      expect(runs[0]!.childSessionId).toBe(data.taskId)
      expect(runs[0]!.taskId).toBe(data.taskId)
      const children = h.sessionStore.listChildren('sess_parent')
      expect(children).toHaveLength(1)
      expect(children[0]!.sessionKind).toBe('subagent')
    },
  )

  it(
    'background=true returns BEFORE completion; the worker later launches the child, completes it and persists a notification',
    { timeout: 20000 },
    async () => {
      const h = createHarness()

      const result = await handleLaunchSubagent(h.makeLaunchDeps(), {
        objective: 'background report',
        agentType: 'document_processor',
        background: true,
      })

      expect(result.success).toBe(true)
      const data = result.data as unknown as {
        runtimeActionId: string
        agentType: string
        agentProfile: string
        backgroundRunId: string
        status: string
        taskId?: string
      }
      expect(data.runtimeActionId).toMatch(/^act_/)
      expect(data.agentType).toBe('document_processor')
      expect(data.agentProfile).toBe('document_processor')
      expect(data.backgroundRunId).toBeDefined()
      expect(data.status).toBe('queued')
      // Fresh background launch has no child session yet — returns before completion.
      expect(data.taskId).toBeUndefined()
      expect(h.runStore.query({})).toHaveLength(0)
      expect(h.sessionStore.listChildren('sess_parent')).toHaveLength(0)

      // The Todo 9 machinery persisted the queued background run with the full spec.
      const queued = h.backgroundRunStore.getByStatus('queued')
      expect(queued).toHaveLength(1)
      expect(queued[0]!.backgroundRunId).toBe(data.backgroundRunId)

      // Drive the worker: it launches the child session + run, executes and completes.
      h.provider.enqueue({ content: CHILD_FINAL_TEXT })
      await h.worker.tick()

      const runs = h.runStore.query({})
      expect(runs).toHaveLength(1)
      expect(runs[0]!.status).toBe('completed')
      expect(runs[0]!.childSessionId).toBe(runs[0]!.taskId)
      expect(runs[0]!.backgroundRunId).toBe(data.backgroundRunId)

      // Background linkage + exactly-once notification persisted.
      const bgRun = h.backgroundRunStore.getById(data.backgroundRunId)
      expect(bgRun).not.toBeNull()
      expect(bgRun!.childSessionId).toBe(runs[0]!.childSessionId)
      expect(bgRun!.subagentRunId).toBe(runs[0]!.subagentRunId)
      const pending = h.backgroundRuntime
        .getPendingNotifications()
        .filter((n) => n.backgroundRunId === data.backgroundRunId)
      expect(pending).toHaveLength(1)
      expect(pending[0]!.type).toBe('completed')
    },
  )

  it('taskId resumes the SAME child session with a NEW subagent_runs attempt', { timeout: 20000 }, async () => {
    const h = createHarness()

    h.provider.enqueue({ content: 'first result' })
    const first = await handleLaunchSubagent(h.makeLaunchDeps(), {
      objective: 'first pass',
      agentType: 'document_processor',
    })
    expect(first.success).toBe(true)
    const d1 = first.data as unknown as ForegroundChildTaskData

    h.provider.enqueue({ content: 'second result' })
    const second = await handleLaunchSubagent(h.makeLaunchDeps(), {
      objective: 'follow up',
      agentType: 'document_processor',
      taskId: d1.taskId,
    })
    expect(second.success).toBe(true)
    const d2 = second.data as unknown as ForegroundChildTaskData

    // Same conversation shell, new attempt.
    expect(d2.taskId).toBe(d1.taskId)
    expect(d2.childSessionId).toBe(d1.childSessionId)
    expect(d2.subagentRunId).not.toBe(d1.subagentRunId)

    const runs = h.runStore.query({ childSessionId: d1.childSessionId })
    expect(runs).toHaveLength(2)
    expect(runs[0]!.subagentRunId).toBe(d2.subagentRunId)
    expect(runs[1]!.subagentRunId).toBe(d1.subagentRunId)
    // Only ONE child session row.
    expect(h.sessionStore.listChildren('sess_parent')).toHaveLength(1)
  })

  it(
    'foreground_status_query resolves new (taskId/childSessionId) and legacy (runtimeActionId/subagentRunId) ids',
    { timeout: 20000 },
    async () => {
      const h = createHarness()
      h.provider.enqueue({ content: 'status result' })
      const launch = await handleLaunchSubagent(h.makeLaunchDeps(), {
        objective: 'status check',
        agentType: 'document_processor',
      })
      expect(launch.success).toBe(true)
      const d = launch.data as unknown as ForegroundChildTaskData

      const byTaskId = await handleStatusQuery(h.statusDeps, { taskId: d.taskId })
      expect(byTaskId.success).toBe(true)
      expect(byTaskId.data?.taskStatus?.subagentRunId).toBe(d.subagentRunId)
      expect(byTaskId.data?.taskStatus?.status).toBe('completed')
      expect(byTaskId.data?.taskStatus?.isChildTask).toBe(true)

      const byChild = await handleStatusQuery(h.statusDeps, { childSessionId: d.childSessionId })
      expect(byChild.data?.taskStatus?.subagentRunId).toBe(d.subagentRunId)

      const byLegacyAction = await handleStatusQuery(h.statusDeps, { runtimeActionId: d.subagentRunId })
      expect(byLegacyAction.data?.taskStatus?.subagentRunId).toBe(d.subagentRunId)

      const byLegacyRun = await handleStatusQuery(h.statusDeps, { subagentRunId: d.subagentRunId })
      expect(byLegacyRun.data?.taskStatus?.subagentRunId).toBe(d.subagentRunId)

      // Unknown ids fail safely — no throw, taskStatus null.
      const unknown = await handleStatusQuery(h.statusDeps, { taskId: 'sess_nonexistent' })
      expect(unknown.success).toBe(true)
      expect(unknown.data?.taskStatus).toBeNull()

      // Aggregate mode unchanged.
      const aggregate = await handleStatusQuery(h.statusDeps)
      expect(aggregate.data?.activeSubagentRuns).toBe(0)
    },
  )

  it(
    'foreground_cancel_or_modify_task cancels child tasks via new taskId AND legacy subagent run ids',
    { timeout: 20000 },
    async () => {
      const h = createHarness()
      h.provider.enqueue({ content: 'cancel target' })
      const launch = await handleLaunchSubagent(h.makeLaunchDeps(), {
        objective: 'cancel me',
        agentType: 'document_processor',
      })
      expect(launch.success).toBe(true)
      const d = launch.data as unknown as ForegroundChildTaskData

      // Cancel by taskId (new id) — cancelRun is idempotent for a completed run.
      const byTaskId = await handleCancelOrModifyTask(h.cancelDeps, {
        taskId: d.taskId,
        reason: 'user asked to stop',
        interruptType: 'cancel',
      })
      expect(byTaskId.success).toBe(true)
      expect(byTaskId.data?.actionType).toBe('cancel_background_subagent')
      expect(byTaskId.data?.targetRef.runId).toBe(d.subagentRunId)

      // Cancel by legacy runtimeActionId (the subagent run id).
      const byLegacy = await handleCancelOrModifyTask(h.cancelDeps, {
        runtimeActionId: d.subagentRunId,
        reason: 'user asked to stop',
        interruptType: 'cancel',
      })
      expect(byLegacy.success).toBe(true)
      expect(byLegacy.data?.targetRef.runId).toBe(d.subagentRunId)

      // Unknown taskId fails safely with a typed code and no dispatch.
      const unknown = await handleCancelOrModifyTask(h.cancelDeps, {
        taskId: 'sess_nonexistent',
        reason: 'stop',
        interruptType: 'cancel',
      })
      expect(unknown.success).toBe(false)
      expect(unknown.error?.code).toBe('TASK_NOT_FOUND')
    },
  )

  it(
    'cancelling a RUNNING background child by taskId aborts the live kernel and cancels the run',
    { timeout: 20000 },
    async () => {
      const h = createHarness()
      const launch = await handleLaunchSubagent(h.makeLaunchDeps(), {
        objective: 'hang then cancel',
        agentType: 'document_processor',
        background: true,
      })
      expect(launch.success).toBe(true)
      const data = launch.data as unknown as { backgroundRunId: string }

      h.provider.enqueue({ content: 'NEVER_RETURNS', delayMs: 6000 })
      // Fire the worker without awaiting — the child kernel holds the provider open.
      const tickPromise = h.worker.tick()
      await waitFor(() => h.runStore.query({})[0]?.status === 'running', 5000, 'child run to start running')

      const run = h.runStore.query({})[0]!
      const cancel = await handleCancelOrModifyTask(h.cancelDeps, {
        taskId: run.taskId,
        reason: 'stop the hang',
        interruptType: 'cancel',
      })
      expect(cancel.success).toBe(true)
      expect(cancel.data?.targetRef.runId).toBe(run.subagentRunId)

      await waitFor(() => h.runStore.query({})[0]?.status === 'cancelled', 5000, 'child run to become cancelled')
      await tickPromise

      const bgRun = h.backgroundRunStore.getById(data.backgroundRunId)
      expect(bgRun?.status).toBe('cancelled')
    },
  )

  it(
    'unknown profile fails safely with SUBAGENT_PROFILE_UNKNOWN and creates no child row',
    { timeout: 20000 },
    async () => {
      const h = createHarness()
      const beforeRuns = h.runStore.query({}).length

      const result = await handleLaunchSubagent(h.makeLaunchDeps(), {
        objective: 'mystery task',
        agentType: 'totally_unknown_profile',
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe(SUBAGENT_PROFILE_UNKNOWN)
      expect(result.error?.recoverable).toBe(true)
      // No run row and no child session row.
      expect(h.runStore.query({}).length).toBe(beforeRuns)
      expect(h.sessionStore.listChildren('sess_parent')).toHaveLength(0)
    },
  )

  it('foreign taskId fails safely with CHILD_TASK_FOREIGN and creates no new run row', { timeout: 20000 }, async () => {
    const h = createHarness()
    // A child session owned by ANOTHER user + parent.
    h.sessionStore.createChildSession({
      sessionId: 'sess_foreign_child',
      userId: 'user_B',
      parentSessionId: 'sess_foreign_parent',
      title: 'Foreign child',
      agentProfile: 'document_processor',
    })

    const result = await handleLaunchSubagent(h.makeLaunchDeps(), {
      objective: 'steal a task',
      agentType: 'document_processor',
      taskId: 'sess_foreign_child',
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('CHILD_TASK_FOREIGN')
    // No run row created for the foreign task.
    expect(h.runStore.query({ childSessionId: 'sess_foreign_child' })).toHaveLength(0)
    expect(h.runStore.query({ userId: 'user_A' })).toHaveLength(0)
  })

  it(
    'ninth launch in one parent turn returns SUBAGENT_LAUNCH_LIMIT_EXCEEDED with no child row',
    { timeout: 20000 },
    async () => {
      const h = createHarness()
      // Seed 8 prior launches in turn_1 (the 9th must be rejected).
      for (let i = 0; i < 8; i++) {
        h.runStore.create({
          subagentRunId: `subagent-seed-${i}`,
          userId: 'user_A',
          agentType: 'document_processor',
          status: 'completed',
          taskSpecJson: JSON.stringify({ objective: `seed ${i}`, agentType: 'document_processor' }),
          parentRunId: 'turn_1',
          rootRunId: 'turn_1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      }
      const childrenBefore = h.sessionStore.listChildren('sess_parent').length

      const result = await handleLaunchSubagent(h.makeLaunchDeps(), {
        objective: 'one too many',
        agentType: 'document_processor',
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SUBAGENT_LAUNCH_LIMIT_EXCEEDED')
      expect(result.error?.recoverable).toBe(true)
      // No new child session or run row for the rejected ninth launch.
      expect(h.sessionStore.listChildren('sess_parent').length).toBe(childrenBefore)
      expect(h.runStore.query({})).toHaveLength(8)
    },
  )

  it('depth-4 launch returns SUBAGENT_DEPTH_EXCEEDED with no child row', { timeout: 20000 }, async () => {
    const h = createHarness()
    // A depth-3 child acting as parent → its child would be depth 4.
    h.sessionStore.createChildSession({
      sessionId: 'sess_depth3',
      userId: 'user_A',
      parentSessionId: 'sess_parent',
      title: 'Depth 3 child',
      agentProfile: 'document_processor',
      subagentDepth: 3,
    })

    const result = await handleLaunchSubagent(h.makeLaunchDeps({ sessionId: 'sess_depth3' }), {
      objective: 'too deep',
      agentType: 'document_processor',
    })

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SUBAGENT_DEPTH_EXCEEDED')
    expect(result.error?.recoverable).toBe(true)
    // No new child row anywhere.
    expect(h.sessionStore.listChildren('sess_depth3')).toHaveLength(0)
    expect(h.runStore.query({})).toHaveLength(0)
  })
})
