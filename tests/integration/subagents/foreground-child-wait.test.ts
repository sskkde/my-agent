/**
 * Foreground Child Wait — integration tests (Todo 8 of opencode-like-subagent-sessions).
 *
 * Proves the foreground launch path waits for child execution under the unified
 * ChildSessionTaskRuntime, bounded by the PARENT turn's remaining budget instead
 * of the RuntimeDispatcher 30s default:
 *   - child intermediate text/tool calls never reach the parent model — the
 *     parent's next LLM request contains ONLY the bounded final tool result
 *   - the child timeline contains its intermediate events
 *   - execution may exceed the legacy 30s dispatcher default while remaining
 *     within the parent budget
 *   - cancellation aborts immediately and leaves no orphan run
 *   - a child that exceeds the remaining parent budget returns the typed
 *     `CHILD_TASK_TIMEOUT` terminal error, cancelRun fires, and a late
 *     terminal can never overwrite the cancelled state
 *
 * Harness note: the parent kernel dispatches tools through a faithful
 * tool-plane stub (no hardcoded 30s race) so the foreground wait is governed
 * ONLY by the remaining budget threaded into the launch deps. The real tool
 * executor, real tool registry wiring (registerAllForegroundTools), real
 * ChildSessionTaskRuntime, real child AgentKernel and a scripted mock provider
 * are all exercised end to end.
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
import { createProviderConfigStore } from '../../../src/storage/provider-config-store.js'
import { createAgentConfigStore } from '../../../src/storage/agent-config-store.js'
import { createSubagentRegistry } from '../../../src/subagents/registry.js'
import { registerBuiltInSubagents } from '../../../src/subagents/builtin-definitions.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolDefinition, ToolCategory, ToolExecutionResult } from '../../../src/tools/types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import { createAgentProfileRegistry, registerSystemProfiles } from '../../../src/taxonomy/agent-profile-registry.js'
import { createAllowedDecision } from '../../../src/permissions/types.js'
import { createToolExecutor } from '../../../src/tools/tool-executor.js'
import { registerAllForegroundTools, LAUNCH_SUBAGENT_TOOL_ID } from '../../../src/foreground/tools/index.js'
import type { ForegroundToolRuntimeDeps } from '../../../src/foreground/tools/foreground-tool-runtime.js'
import {
  createChildSessionTaskRuntime,
  type ChildSessionTaskRuntime,
} from '../../../src/subagents/child-session-task-runtime.js'
import { createSubagentKernelAdapter } from '../../../src/subagents/kernel-adapter.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import type {
  KernelConfig,
  KernelRunInput,
  KernelRunResult,
  RuntimeDispatcher as KernelRuntimeDispatcher,
  ToolExecutor as KernelToolExecutor,
  ContextManager,
  TokenStreamBroadcaster,
} from '../../../src/kernel/types.js'
import type {
  ToolPlaneProjection,
  ModelInputBuildInput,
  BuiltModelInput,
} from '../../../src/kernel/model-input/model-input-types.js'
import type { ModelInputBuilder } from '../../../src/kernel/model-input/model-input-builder.js'
import { createLLMAdapter, type LLMAdapter } from '../../../src/llm/adapter.js'
import type { LLMProvider, ProviderHealthStatus, ProviderStats } from '../../../src/llm/provider.js'
import type { LLMRequest, LLMResult } from '../../../src/llm/types.js'
import type { CircuitBreaker } from '../../../src/llm/circuit-breaker.js'
import { toLLMToolDefinition } from '../../../src/tools/tool-plane-prompt-projection.js'
import type { ContextBundle } from '../../../src/context/types.js'
import type { RuntimeDispatcher as DispatcherRuntimeDispatcher } from '../../../src/dispatcher/types.js'
import { CHILD_TASK_TIMEOUT } from '../../../src/foreground/tools/subagent-launch-tool.js'

const CHILD_INTERMEDIATE_TEXT = 'CHILD_INTERMEDIATE_THOUGHT_DRAFT_SENTINEL'
const CHILD_FINAL_TEXT = 'CHILD_FINAL_ANSWER_SENTINEL'

// ---------------------------------------------------------------------------
// Scripted mock provider — queue based; records every LLM request.
// ---------------------------------------------------------------------------

interface QueueEntry {
  content?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  delayMs?: number
}

class ScriptedChildWaitProvider implements LLMProvider {
  readonly id = 'mock'
  readonly queue: QueueEntry[] = []
  readonly requests: LLMRequest[] = []

  readonly config = {
    id: 'mock',
    name: 'Scripted Child Wait Provider',
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

function makeParentBundle(userId: string, sessionId: string): ContextBundle {
  return {
    bundleId: 'bundle-parent',
    runId: 'krun_parent',
    agentId: 'main.foreground.default',
    agentType: 'main',
    userId,
    invocationSource: 'gateway_intent',
    pinnedItems: [
      {
        itemId: 'parent-pinned',
        sourceType: 'session_history',
        semanticType: 'fact',
        content: 'Parent conversation should never leak into the child model input.',
        structuredPayload: { sessionId },
      },
    ],
    orderedItems: [],
    tokenEstimate: 100,
  }
}

// ---------------------------------------------------------------------------
// Harness: real stores + registries + runtime + kernels + tool plane stub
// ---------------------------------------------------------------------------

interface Harness {
  sessionStore: SessionStore
  runStore: SubagentRunStore
  transcriptStore: SubagentTranscriptStore
  toolResultStore: ToolResultStore
  childRuntime: ChildSessionTaskRuntime
  parentKernel: AgentKernel
  childKernel: AgentKernel
  provider: ScriptedChildWaitProvider
  llmAdapter: LLMAdapter
  capturedBuildInputs: ModelInputBuildInput[]
  toolProjection: ToolPlaneProjection
  toolDispatchResults: ToolExecutionResult[]
}

function createCapturingModelInputBuilder(captured: ModelInputBuildInput[]): ModelInputBuilder {
  return {
    build: async (input: ModelInputBuildInput): Promise<BuiltModelInput> => {
      captured.push(input)
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

function createHarness(options: { childTaskRemainingTimeoutMs: number }): Harness {
  const connection = openMemoryConnection()
  applyAll(connection)

  const sessionStore = createSessionStore(connection)
  const runStore = createSubagentRunStore(connection)
  const transcriptStore = createSubagentTranscriptStore(connection)
  const toolResultStore = createToolResultStore(connection)
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
  registerFixtureTool(toolRegistry, 'todolist', 'read')

  const subagentRegistry = createSubagentRegistry()
  registerBuiltInSubagents(subagentRegistry)

  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()
  const agentProfileRegistry = createAgentProfileRegistry()
  registerSystemProfiles(agentProfileRegistry)

  const provider = new ScriptedChildWaitProvider()
  const llmAdapter = createLLMAdapter({
    providers: [],
    defaultTimeoutMs: 60000,
    enableCircuitBreaker: false,
    enableLogging: false,
  })
  llmAdapter.addProvider(provider)

  const capturedBuildInputs: ModelInputBuildInput[] = []
  const modelInputBuilder = createCapturingModelInputBuilder(capturedBuildInputs)

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
  //      dispatcher race — the foreground wait is bounded only by the remaining
  //      budget threaded into the launch deps.
  const toolDispatchResults: ToolExecutionResult[] = []
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
      toolDispatchResults.push(...results)

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
  const childKernelAdapter = createSubagentKernelAdapter({
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
    kernelAdapter: childKernelAdapter,
    registry: subagentRegistry,
    toolRegistry,
    envelopeRegistry,
    defaultMaxIterations: 10,
    defaultTimeoutMs: 60000,
  })

  // ---- Legacy dispatcher placeholder — never reached on the child path.
  const legacyDispatcher: DispatcherRuntimeDispatcher = {
    dispatch: async () => {
      throw new Error('legacy RuntimeDispatcher must not be used when childSessionTaskRuntime is wired')
    },
  }

  const foregroundRuntimeDeps: ForegroundToolRuntimeDeps = {
    runtimeDispatcher: legacyDispatcher,
    plannerRuntime: {
      resumePlannerRun: async () => {
        throw new Error('not used in this harness')
      },
    } as never,
    plannerRunStore: { query: () => [] } as never,
    subagentRunStore: runStore,
    approvalStore: { getPendingByUser: () => [] } as never,
    profileRegistry: agentProfileRegistry,
    childSessionTaskRuntime: childRuntime,
    toolResultStore,
    childTaskRemainingTimeoutMs: options.childTaskRemainingTimeoutMs,
  }
  registerAllForegroundTools(toolRegistry, { runtimeDeps: foregroundRuntimeDeps })

  const launchToolDef = toolRegistry.getTool(LAUNCH_SUBAGENT_TOOL_ID)
  if (!launchToolDef) throw new Error('foreground_launch_subagent not registered')

  const toolProjection: ToolPlaneProjection = {
    toolIds: [LAUNCH_SUBAGENT_TOOL_ID],
    tools: [toLLMToolDefinition(launchToolDef)],
  }

  const parentKernel = createKernel(llmAdapter, kernelDispatcher, modelInputBuilder, {
    maxIterations: 6,
    timeoutMs: 120000,
  })

  return {
    sessionStore,
    runStore,
    transcriptStore,
    toolResultStore,
    childRuntime,
    parentKernel,
    childKernel,
    provider,
    llmAdapter,
    capturedBuildInputs,
    toolProjection,
    toolDispatchResults,
  }
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
    assembleBundle: () => makeParentBundle('user_A', 'sess_parent'),
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

function runParentTurn(h: Harness, signal?: AbortSignal): Promise<KernelRunResult> {
  const input: KernelRunInput = {
    contextBundle: makeParentBundle('user_A', 'sess_parent'),
    runId: 'krun_parent',
    agentId: 'main.foreground.default',
    agentType: 'main',
    userId: 'user_A',
    sessionId: 'sess_parent',
    maxIterations: 6,
    timeoutMs: 120000,
    ...(h.toolProjection ? { toolProjection: h.toolProjection } : {}),
    ...(signal ? { signal } : {}),
  }
  return h.parentKernel.run(input)
}

function lastParentModelInput(h: Harness): ModelInputBuildInput | undefined {
  // Parent runs are agentType 'main'; child runs are 'subagent'.
  const parentInputs = h.capturedBuildInputs.filter((input) => input.agentType === 'main')
  return parentInputs[parentInputs.length - 1]
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

describe('Foreground child wait under the unified runtime (Todo 8)', () => {
  describe('happy path — bounded terminal injection only', () => {
    it(
      'waits for the child, returns taskId/childSessionId/subagentRunId metadata and injects ONLY the bounded final result into the parent next LLM request',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ childTaskRemainingTimeoutMs: 60000 })

        // Parent call 1: launch tool call.
        h.provider.enqueue({
          toolCalls: [
            {
              id: 'call_launch_1',
              name: 'foreground_launch_subagent',
              arguments: JSON.stringify({ objective: 'research the topic', agentType: 'document_processor' }),
            },
          ],
        })
        // Child call 1: intermediate text + tool call (keeps the child looping).
        h.provider.enqueue({
          content: CHILD_INTERMEDIATE_TEXT,
          toolCalls: [{ id: 'call_child_todo', name: 'todolist', arguments: JSON.stringify({ action: 'add' }) }],
        })
        // Child call 2: final answer.
        h.provider.enqueue({ content: CHILD_FINAL_TEXT })
        // Parent call 2: final answer.
        h.provider.enqueue({ content: 'Parent final answer.' })

        const result = await runParentTurn(h)

        expect(result.finalStatus).toBe('completed')
        expect(result.finalResponse).toBe('Parent final answer.')

        // The launch tool returned success with child metadata.
        const parentInput = lastParentModelInput(h)
        expect(parentInput).toBeDefined()
        const toolResultMessage = parentInput!.transcript?.find((m) => m.role === 'tool')
        expect(toolResultMessage).toBeDefined()
        const toolText = toolResultMessage!.content

        // Metadata present.
        expect(toolText).toContain('taskId')
        expect(toolText).toContain('childSessionId')
        expect(toolText).toContain('subagentRunId')
        // The bounded final child answer is present…
        expect(toolText).toContain(CHILD_FINAL_TEXT)
        // …but the child's intermediate content and its tool usage never leak.
        expect(toolText).not.toContain(CHILD_INTERMEDIATE_TEXT)
        expect(toolText).not.toContain('todolist')
        expect(toolText).not.toContain('call_child_todo')

        // Exactly one child session + one subagent run attempt.
        const runs = h.runStore.query({})
        expect(runs).toHaveLength(1)
        expect(runs[0]!.status).toBe('completed')
        expect(runs[0]!.childSessionId).toBeDefined()
        expect(runs[0]!.taskId).toBe(runs[0]!.childSessionId)

        // Child timeline contains the intermediate events + completed turn.
        const events = h.transcriptStore.getByRunId(runs[0]!.subagentRunId)
        const eventTypes = events.map((e) => e.eventType)
        expect(eventTypes).toContain('SubagentRunCreated')
        expect(eventTypes).toContain('SubagentRunStarted')
        expect(eventTypes).toContain('SubagentRunCompleted')
        expect(eventTypes).toContain('ChildTurnCompleted')
        // The child's final answer is persisted on the child timeline.
        const persisted = events.find((e) => e.eventType === 'ChildTurnCompleted')!.contentJson
        expect(persisted).toContain(CHILD_FINAL_TEXT)

        // The child intermediate text never appears in ANY parent model input.
        for (const input of h.capturedBuildInputs.filter((i) => i.agentType === 'main')) {
          expect(JSON.stringify(input)).not.toContain(CHILD_INTERMEDIATE_TEXT)
          expect(JSON.stringify(input)).not.toContain('call_child_todo')
        }
      },
    )

    it(
      'persists structured results above 32KiB by reference and keeps the model-facing summary bounded',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ childTaskRemainingTimeoutMs: 60000 })

        const hugeFinal = `LARGE_RESULT_${'x'.repeat(40 * 1024)}_END_MARKER`

        h.provider.enqueue({
          toolCalls: [
            {
              id: 'call_launch_2',
              name: 'foreground_launch_subagent',
              arguments: JSON.stringify({ objective: 'produce a huge report', agentType: 'document_processor' }),
            },
          ],
        })
        h.provider.enqueue({ content: hugeFinal })
        h.provider.enqueue({ content: 'Parent final answer.' })

        const result = await runParentTurn(h)
        expect(result.finalStatus).toBe('completed')

        const parentInput = lastParentModelInput(h)
        const toolText = parentInput!.transcript!.find((m) => m.role === 'tool')!.content

        // Model-facing content is the bounded summary, never the full 40KiB blob.
        expect(toolText.length).toBeLessThan(5000)
        expect(toolText).not.toContain('_END_MARKER')
        // A result ref metadata id is present and the blob was persisted.
        expect(toolText).toContain('resultRef')

        const blobs = h.toolResultStore.findByToolName(LAUNCH_SUBAGENT_TOOL_ID)
        expect(blobs.length).toBeGreaterThan(0)
      },
    )
  })

  describe('timeout alignment', () => {
    it(
      'allows child execution longer than the legacy 30s dispatcher default when within the parent budget',
      { timeout: 60000 },
      async () => {
        const h = createHarness({ childTaskRemainingTimeoutMs: 60000 })

        h.provider.enqueue({
          toolCalls: [
            {
              id: 'call_launch_3',
              name: 'foreground_launch_subagent',
              arguments: JSON.stringify({ objective: 'slow task', agentType: 'document_processor' }),
            },
          ],
        })
        // Child takes 31s (> the legacy 30s dispatcher default) but stays within
        // the 60s parent budget — must complete without a false timeout.
        h.provider.enqueue({ content: CHILD_FINAL_TEXT, delayMs: 31000 })
        h.provider.enqueue({ content: 'Parent final answer.' })

        const result = await runParentTurn(h)
        expect(result.finalStatus).toBe('completed')

        const runs = h.runStore.query({})
        expect(runs[0]!.status).toBe('completed')

        const parentInput = lastParentModelInput(h)
        const toolText = parentInput!.transcript!.find((m) => m.role === 'tool')!.content
        expect(toolText).toContain(CHILD_FINAL_TEXT)
      },
    )

    it(
      'returns typed CHILD_TASK_TIMEOUT when the child exceeds the remaining parent budget, fires cancelRun, and never lets a late terminal overwrite the cancelled run',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ childTaskRemainingTimeoutMs: 400 })

        h.provider.enqueue({
          toolCalls: [
            {
              id: 'call_launch_4',
              name: 'foreground_launch_subagent',
              arguments: JSON.stringify({ objective: 'never finishes', agentType: 'document_processor' }),
            },
          ],
        })
        // Child call hangs far longer than the 400ms budget.
        h.provider.enqueue({ content: 'LATE_CHILD_RESULT_NEVER_ACCEPTED', delayMs: 4000 })
        h.provider.enqueue({ content: 'Parent final answer.' })

        const result = await runParentTurn(h)
        expect(result.finalStatus).toBe('completed')

        // The typed terminal error reached the tool plane (code + safe message).
        const launchResult = h.toolDispatchResults.find((r) => r.success === false)
        expect(launchResult).toBeDefined()
        expect(launchResult!.error?.code).toBe(CHILD_TASK_TIMEOUT)
        expect(launchResult!.error?.recoverable).toBe(true)
        expect(launchResult!.error?.message).toContain("exceeded the parent turn's remaining budget")

        const parentInput = lastParentModelInput(h)
        const toolText = parentInput!.transcript!.find((m) => m.role === 'tool')!.content
        // The safe message reached the parent model — never child content.
        expect(toolText).toContain("exceeded the parent turn's remaining budget")
        expect(toolText).not.toContain('LATE_CHILD_RESULT_NEVER_ACCEPTED')

        // cancelRun fired: the child run reaches cancelled (no orphan running row).
        const runs = h.runStore.query({})
        expect(runs).toHaveLength(1)
        await waitFor(() => h.runStore.query({})[0]?.status === 'cancelled', 5000, 'child run to become cancelled')
        const cancelledRun = h.runStore.query({})[0]!
        expect(cancelledRun.status).toBe('cancelled')
        const cancelledResult = JSON.parse(cancelledRun.resultJson ?? '{}')
        expect(cancelledResult.status).toBe('cancelled')

        // A late terminal must never overwrite the cancelled state.
        await waitFor(() => h.provider.hasPending === false, 6000, 'late child LLM response to be consumed')
        const afterLate = h.runStore.query({})[0]!
        expect(afterLate.status).toBe('cancelled')
      },
    )
  })

  describe('cancellation', () => {
    it(
      'aborts immediately when the parent signal fires, cancels the child run and leaves no orphan',
      { timeout: 20000 },
      async () => {
        const h = createHarness({ childTaskRemainingTimeoutMs: 60000 })

        h.provider.enqueue({
          toolCalls: [
            {
              id: 'call_launch_5',
              name: 'foreground_launch_subagent',
              arguments: JSON.stringify({ objective: 'cancel me', agentType: 'document_processor' }),
            },
          ],
        })
        h.provider.enqueue({ content: 'NEVER_RETURNED', delayMs: 10000 })

        const controller = new AbortController()
        const runPromise = runParentTurn(h, controller.signal)

        // Wait until the child LLM request is actually in flight, then abort.
        await waitFor(() => h.provider.requests.length >= 2, 10000, 'child LLM request to start')
        const abortAt = Date.now()
        controller.abort()

        const result = await runPromise
        expect(result.finalStatus).toBe('cancelled')
        // Abort resolves quickly — nowhere near the 10s child delay.
        expect(Date.now() - abortAt).toBeLessThan(3000)

        // Child run is cancelled (no orphan running/completed row).
        await waitFor(() => h.runStore.query({})[0]?.status === 'cancelled', 5000, 'child run to become cancelled')
        expect(h.runStore.query({})[0]!.status).toBe('cancelled')
        // The child's late answer never landed on the parent timeline.
        expect(JSON.stringify(h.capturedBuildInputs)).not.toContain('NEVER_RETURNED')
      },
    )
  })
})
