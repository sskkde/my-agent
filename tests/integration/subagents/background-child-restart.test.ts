/**
 * Durable background child execution — worker restart recovery (Todo 9).
 *
 * The background worker must recover queued/running child tasks from the
 * PERSISTED task spec (background_runs.task_spec_json) after a runtime/worker
 * restart — correctness must NOT depend on the in-memory `taskSpecs` Map.
 *
 * Scenarios:
 *   - enqueue a background child task with runtime A, destroy A, recreate
 *     runtime B + worker B over the SAME database → B recovers the full task
 *     spec from storage, launches the child session/run, executes and
 *     completes it (no MISSING_TASK_SPEC failure).
 *   - missing persisted spec → child marked failed with a sanitized durable
 *     notification instead of a worker-loop exception.
 *   - corrupt persisted spec (invalid JSON / wrong shape) → same safe failure.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSessionStore, type SessionStore } from '../../../src/storage/session-store.js'
import { createSubagentRunStore, type SubagentRunStore } from '../../../src/storage/subagent-run-store.js'
import {
  createSubagentTranscriptStore,
  type SubagentTranscriptStore,
} from '../../../src/storage/subagent-transcript-store.js'
import { createBackgroundRunStore, type BackgroundRunStore } from '../../../src/storage/background-run-store.js'
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js'
import { createSubagentRegistry, type SubagentRegistry } from '../../../src/subagents/registry.js'
import { registerBuiltInSubagents } from '../../../src/subagents/builtin-definitions.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolRegistry, ToolCategory, ToolDefinition } from '../../../src/tools/types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import type { KernelAdapter } from '../../../src/subagents/types.js'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import type { ContextBundle } from '../../../src/context/types.js'
import {
  createChildSessionTaskRuntime,
  type ChildSessionTaskRuntime,
  type ChildTaskSpec,
} from '../../../src/subagents/child-session-task-runtime.js'
import { createBackgroundRuntime, type BackgroundRuntime } from '../../../src/subagents/background-runtime.js'
import {
  createBackgroundSubagentWorker,
  type BackgroundSubagentWorkerInstance,
} from '../../../src/subagents/background-worker.js'

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

function registerFixtureTool(registry: ToolRegistry, name: string, category: ToolCategory = 'internal'): void {
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

function createFixtureToolRegistry(): ToolRegistry {
  const registry = createToolRegistry()
  registerFixtureTool(registry, 'file_read', 'read')
  registerFixtureTool(registry, 'web_search', 'search')
  registerFixtureTool(registry, 'todolist', 'read')
  registerFixtureTool(registry, 'todowrite', 'write')
  return registry
}

class RecordingKernel implements KernelAdapter {
  captured: Array<{ contextBundle: ContextBundle; signal?: AbortSignal }> = []

  constructor(private results: KernelRunResult[]) {}

  async execute(options: {
    contextBundle: ContextBundle
    maxIterations: number
    timeoutMs: number
    onCancel?: () => boolean
    taskSpec?: unknown
    definition?: unknown
    signal?: AbortSignal
  }): Promise<KernelRunResult> {
    this.captured.push({ contextBundle: options.contextBundle, signal: options.signal })
    const result = this.results.shift()
    if (!result) {
      throw new Error('RecordingKernel ran out of scripted results')
    }
    return result
  }
}

function bundleItemsText(bundle: ContextBundle): string {
  return [...bundle.pinnedItems, ...bundle.orderedItems]
    .map((item) => item.content)
    .filter(Boolean)
    .join('\n')
}

function makeChildSpec(overrides?: Partial<ChildTaskSpec>): ChildTaskSpec {
  return {
    objective: 'Analyze the quarterly numbers in the background',
    profileId: 'document_processor',
    tools: ['file_read'],
    parentSessionId: 'sess_parent',
    launchMode: 'background',
    maxIterations: 5,
    timeoutMs: 30000,
    ...overrides,
  }
}

interface Harness {
  connection: ConnectionManager
  sessionStore: SessionStore
  runStore: SubagentRunStore
  transcriptStore: SubagentTranscriptStore
  backgroundRunStore: BackgroundRunStore
  eventStore: EventStore
  registry: SubagentRegistry
  toolRegistry: ToolRegistry
  envelopeRegistry: ReturnType<typeof createAgentTypeToolEnvelopeRegistry>
}

function createStores(): Harness {
  const connection = openMemoryConnection()
  applyAll(connection)

  const sessionStore = createSessionStore(connection)
  const runStore = createSubagentRunStore(connection)
  const transcriptStore = createSubagentTranscriptStore(connection)
  const backgroundRunStore = createBackgroundRunStore(connection)
  const eventStore = createEventStore(connection)

  sessionStore.create({ sessionId: 'sess_parent', userId: 'user_A', title: 'Parent' })

  const registry = createSubagentRegistry()
  registerBuiltInSubagents(registry)

  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  return {
    connection,
    sessionStore,
    runStore,
    transcriptStore,
    backgroundRunStore,
    eventStore,
    registry,
    toolRegistry,
    envelopeRegistry,
  }
}

function makeChildRuntime(h: Harness, kernel: KernelAdapter): ChildSessionTaskRuntime {
  return createChildSessionTaskRuntime({
    sessionStore: h.sessionStore,
    runStore: h.runStore,
    transcriptStore: h.transcriptStore,
    kernelAdapter: kernel,
    registry: h.registry,
    toolRegistry: h.toolRegistry,
    envelopeRegistry: h.envelopeRegistry,
    defaultMaxIterations: 5,
    defaultTimeoutMs: 30000,
  })
}

function makeBackgroundRuntime(h: Harness): BackgroundRuntime {
  return createBackgroundRuntime({
    backgroundRunStore: h.backgroundRunStore,
    eventStore: h.eventStore,
    maxConcurrentRuns: 4,
    watchdogTimeoutMs: 60000,
  })
}

function makeWorker(
  h: Harness,
  runtime: BackgroundRuntime,
  childRuntime: ChildSessionTaskRuntime,
): BackgroundSubagentWorkerInstance {
  return createBackgroundSubagentWorker({
    backgroundRuntime: runtime,
    childTaskRuntime: childRuntime,
    backgroundRunStore: h.backgroundRunStore,
    pollIntervalMs: 1000,
  })
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('Background child worker — restart recovery from persisted task spec', () => {
  let h: Harness

  beforeEach(() => {
    h = createStores()
  })

  it('recovers a queued background child task from the persisted spec after runtime+worker restart', async () => {
    const objective = 'Recover this background objective from the persisted spec'

    // Runtime A / worker A enqueue the task and are then DESTROYED.
    const runtimeA = makeBackgroundRuntime(h)
    const workerA = makeWorker(h, runtimeA, makeChildRuntime(h, new RecordingKernel([])))
    const bgRunId = runtimeA.enqueueBackgroundRun({
      userId: 'user_A',
      sessionId: 'sess_parent',
      agentType: 'document_processor',
      agentProfile: 'document_processor',
      taskSpec: makeChildSpec({ objective }),
      launchSource: 'foreground_request',
    })
    workerA.stop()

    // The full task spec must be persisted on the background run row.
    const persisted = h.backgroundRunStore.getById(bgRunId)
    expect(persisted).not.toBeNull()
    expect(persisted?.taskSpec).toBeDefined()
    expect((persisted?.taskSpec as { objective?: string })?.objective).toBe(objective)

    // Runtime B / worker B: brand-new instances, NO in-memory taskSpecs map.
    const kernelB = new RecordingKernel([
      {
        finalStatus: 'completed',
        finalResponse: 'Background task recovered and completed',
        iterationsUsed: 2,
        toolCalls: [],
        transcript: [],
      },
    ])
    const runtimeB = makeBackgroundRuntime(h)
    const childRuntimeB = makeChildRuntime(h, kernelB)
    const workerB = makeWorker(h, runtimeB, childRuntimeB)

    await workerB.tick()

    // The child kernel received the PERSISTED objective — not an in-memory spec.
    expect(kernelB.captured).toHaveLength(1)
    expect(bundleItemsText(kernelB.captured[0]!.contextBundle)).toContain(objective)

    const run = runtimeB.getBackgroundRun(bgRunId)
    expect(run?.status).toBe('completed')

    // Child/task linkage must be persisted on the background run row.
    expect(run?.subagentRunId).toBeDefined()
    expect(run?.taskId).toBeDefined()
    expect(run?.childSessionId).toBeDefined()
    expect(run?.taskId).toBe(run?.childSessionId)

    // A subagent_runs attempt exists with the child session / task linkage.
    const attempts = h.runStore.query({ backgroundRunId: bgRunId })
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.childSessionId).toBe(run?.childSessionId)
    expect(attempts[0]?.taskId).toBe(run?.taskId)
  })

  it('marks the child failed with a sanitized durable notification when the persisted spec is MISSING', async () => {
    const runtimeA = makeBackgroundRuntime(h)
    const workerA = makeWorker(h, runtimeA, makeChildRuntime(h, new RecordingKernel([])))
    const bgRunId = runtimeA.enqueueBackgroundRun({
      userId: 'user_A',
      sessionId: 'sess_parent',
      agentType: 'document_processor',
      taskSpec: makeChildSpec(),
      launchSource: 'foreground_request',
    })
    workerA.stop()

    // Simulate a DB where the spec was never persisted (legacy row / write loss).
    h.connection.exec(`UPDATE background_runs SET task_spec_json = NULL WHERE background_run_id = ?`, [bgRunId])

    // Fresh worker must NOT throw — it must fail the child with a durable notification.
    const runtimeB = makeBackgroundRuntime(h)
    const workerB = makeWorker(h, runtimeB, makeChildRuntime(h, new RecordingKernel([])))

    let tickError: unknown = null
    try {
      await workerB.tick()
    } catch (err) {
      tickError = err
    }
    expect(tickError).toBeNull()

    const run = runtimeB.getBackgroundRun(bgRunId)
    expect(run?.status).toBe('failed')
    expect(run?.errorMessage).toContain('task spec')

    const notifications = runtimeB.getPendingNotifications().filter((n) => n.backgroundRunId === bgRunId)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('failed')
    expect(notifications[0]!.message.length).toBeGreaterThan(0)
    expect(notifications[0]!.message.length).toBeLessThanOrEqual(2000)
    // No raw exception/stack text leaked into the notification.
    expect(notifications[0]!.message).not.toContain('at Object.')

    // The typed failure surfaces with the sanitized terminal error code.
    const items = runtimeB.collectParentTurnNotifications({ parentSessionId: 'sess_parent' })
    expect(items).toHaveLength(1)
    const payload = items[0]!.structuredPayload as { error?: { code: string; message: string } }
    expect(payload.error?.code).toBe('MISSING_TASK_SPEC')
    expect(payload.error?.message.length).toBeLessThanOrEqual(2000)
  })

  it('marks the child failed with a sanitized durable notification when the persisted spec is CORRUPT', async () => {
    const runtimeA = makeBackgroundRuntime(h)
    const workerA = makeWorker(h, runtimeA, makeChildRuntime(h, new RecordingKernel([])))
    const bgRunId = runtimeA.enqueueBackgroundRun({
      userId: 'user_A',
      sessionId: 'sess_parent',
      agentType: 'document_processor',
      taskSpec: makeChildSpec(),
      launchSource: 'foreground_request',
    })
    workerA.stop()

    // Corrupt the persisted spec: invalid JSON first.
    h.connection.exec(`UPDATE background_runs SET task_spec_json = ? WHERE background_run_id = ?`, [
      '{not valid json!!',
      bgRunId,
    ])

    const runtimeB = makeBackgroundRuntime(h)
    const workerB = makeWorker(h, runtimeB, makeChildRuntime(h, new RecordingKernel([])))

    let tickError: unknown = null
    try {
      await workerB.tick()
    } catch (err) {
      tickError = err
    }
    expect(tickError).toBeNull()

    const run = runtimeB.getBackgroundRun(bgRunId)
    expect(run?.status).toBe('failed')

    const notifications = runtimeB.getPendingNotifications().filter((n) => n.backgroundRunId === bgRunId)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('failed')

    // Second scenario: spec JSON is valid but the shape is unusable (no objective).
    const bgRunId2 = runtimeA.enqueueBackgroundRun({
      userId: 'user_A',
      sessionId: 'sess_parent',
      agentType: 'document_processor',
      taskSpec: makeChildSpec({ objective: 'second task' }),
      launchSource: 'foreground_request',
    })
    h.connection.exec(`UPDATE background_runs SET task_spec_json = ? WHERE background_run_id = ?`, [
      JSON.stringify({ tools: ['file_read'] }),
      bgRunId2,
    ])

    const runtimeC = makeBackgroundRuntime(h)
    const workerC = makeWorker(h, runtimeC, makeChildRuntime(h, new RecordingKernel([])))
    await workerC.tick()

    const run2 = runtimeC.getBackgroundRun(bgRunId2)
    expect(run2?.status).toBe('failed')
    expect(runtimeC.getPendingNotifications().filter((n) => n.backgroundRunId === bgRunId2)).toHaveLength(1)
  })

  it('resumes the child session carried on the background run row (worker taskId passthrough)', async () => {
    const objective = 'Resume this background objective in the same child session'

    // First launch creates the child session shell (identity: taskId === childSessionId).
    const seedKernel = new RecordingKernel([])
    const seedChildRuntime = makeChildRuntime(h, seedKernel)
    const seedParentContext: ContextBundle = {
      bundleId: 'ctx-seed',
      runId: 'krun_seed',
      agentId: 'foreground.default',
      agentType: 'main',
      userId: 'user_A',
      invocationSource: 'system',
      pinnedItems: [],
      orderedItems: [],
      tokenEstimate: 0,
    }
    const firstLaunch = seedChildRuntime.launchTask({
      parentContext: seedParentContext,
      taskSpec: makeChildSpec({ objective }),
      depth: 1,
      launchesInParentTurn: 0,
    })
    const childSessionId = firstLaunch.childSessionId

    // Enqueue a background run carrying the persisted taskId — the worker must
    // resume that child session shell instead of creating a fresh one.
    const runtime = makeBackgroundRuntime(h)
    const bgRunId = runtime.enqueueBackgroundRun({
      userId: 'user_A',
      sessionId: 'sess_parent',
      agentType: 'document_processor',
      agentProfile: 'document_processor',
      taskSpec: makeChildSpec({ objective }),
      launchSource: 'foreground_request',
      taskId: childSessionId,
    })

    const kernel = new RecordingKernel([
      {
        finalStatus: 'completed',
        finalResponse: 'Background resumed task completed',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      },
    ])
    const worker = makeWorker(h, runtime, makeChildRuntime(h, kernel))
    await worker.tick()

    const run = runtime.getBackgroundRun(bgRunId)
    expect(run?.status).toBe('completed')
    expect(run?.taskId).toBe(childSessionId)
    expect(run?.childSessionId).toBe(childSessionId)

    // The resumed attempt lives under the SAME child session shell (no new child).
    const attempts = h.runStore.query({ backgroundRunId: bgRunId })
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.childSessionId).toBe(childSessionId)
    expect(attempts[0]?.taskId).toBe(childSessionId)
  })
})
