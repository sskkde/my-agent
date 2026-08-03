/**
 * Child Session Task Runtime — integration tests (Todo 7).
 *
 * Proves durability across runtime instances over the same store:
 *   - launch + execute a fresh child via runtime A
 *   - create a brand-new runtime B over the SAME database and resume the task
 *     by taskId → a second subagent_runs attempt linked to the SAME child
 *     session, whose context includes the prior child transcript (persisted,
 *     not in-memory)
 *   - unknown / foreign / archived / non-child taskIds are rejected with typed
 *     errors BEFORE any execution across instances too
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
  ChildTaskRuntimeError,
  CHILD_TASK_NOT_FOUND,
  CHILD_TASK_ARCHIVED,
  CHILD_TASK_FOREIGN,
  CHILD_TASK_NOT_CHILD,
  type ChildSessionTaskRuntime,
  type ChildTaskLaunchInput,
  type ChildTaskSpec,
} from '../../../src/subagents/child-session-task-runtime.js'

const PARENT_TRANSCRIPT_SENTINEL = 'PARENT_SECRET_TRANSCRIPT_SENTINEL_SHOULD_NEVER_LEAK'

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

function makeParentContext(userId: string, parentSessionId: string): ContextBundle {
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
        content: `Parent: ${PARENT_TRANSCRIPT_SENTINEL}`,
        structuredPayload: { sessionId: parentSessionId },
      },
    ],
    orderedItems: [
      {
        itemId: 'parent-ordered',
        sourceType: 'session_history',
        semanticType: 'fact',
        content: `Parent continued: ${PARENT_TRANSCRIPT_SENTINEL}`,
      },
    ],
    tokenEstimate: 100,
  }
}

function makeChildSpec(overrides?: Partial<ChildTaskSpec>): ChildTaskSpec {
  return {
    objective: 'Analyze the quarterly numbers',
    profileId: 'document_processor',
    tools: ['file_read'],
    parentSessionId: 'sess_parent',
    launchMode: 'foreground',
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

  sessionStore.create({ sessionId: 'sess_parent', userId: 'user_A', title: 'Parent' })
  sessionStore.create({ sessionId: 'sess_other_parent', userId: 'user_B', title: 'Other parent' })

  const registry = createSubagentRegistry()
  registerBuiltInSubagents(registry)

  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  return { connection, sessionStore, runStore, transcriptStore, registry, toolRegistry, envelopeRegistry }
}

function makeRuntime(h: Harness, kernel: KernelAdapter): ChildSessionTaskRuntime {
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

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('Child Session Task Runtime — resume durability across runtime instances', () => {
  let h: Harness
  let taskId: string
  let firstRunId: string

  beforeEach(async () => {
    h = createStores()

    // Runtime A: fresh launch + execute to completion.
    const kernelA = new RecordingKernel([
      {
        finalStatus: 'completed',
        finalResponse: 'Child result from attempt one',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      },
    ])
    const runtimeA = makeRuntime(h, kernelA)

    const input: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec({ objective: 'Attempt one objective' }),
      depth: 1,
      launchesInParentTurn: 0,
    }
    const launch = runtimeA.launchTask(input)
    taskId = launch.taskId
    firstRunId = launch.subagentRunId

    const result = await runtimeA.executeRun(firstRunId)
    expect(result.status).toBe('completed')
    expect(result.response).toBe('Child result from attempt one')

    // Prior child transcript must have been persisted.
    const events = h.transcriptStore.getByRunId(firstRunId)
    expect(events.some((e) => e.eventType === 'ChildTurnCompleted')).toBe(true)
  })

  it('resumes by taskId into the same child session with a fresh runtime instance over the same DB', async () => {
    // Runtime B: a completely new instance over the SAME stores (no in-memory state shared).
    const kernelB = new RecordingKernel([
      {
        finalStatus: 'completed',
        finalResponse: 'Child result from attempt two',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      },
    ])
    const runtimeB = makeRuntime(h, kernelB)

    const resumeInput: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec({ objective: 'Attempt two objective' }),
      depth: 1,
      launchesInParentTurn: 1,
      taskId,
    }
    const resumed = runtimeB.launchTask(resumeInput)

    expect(resumed.isResume).toBe(true)
    expect(resumed.childSessionId).toBe(taskId)
    expect(resumed.subagentRunId).not.toBe(firstRunId)

    const result = await runtimeB.executeRun(resumed.subagentRunId)
    expect(result.status).toBe('completed')
    expect(result.response).toBe('Child result from attempt two')

    // Two attempts, both linked to the same child session.
    const runs = h.runStore.query({ childSessionId: taskId })
    expect(runs).toHaveLength(2)
    expect(runs.map((r) => r.subagentRunId)).toContain(firstRunId)
    expect(runs.map((r) => r.subagentRunId)).toContain(resumed.subagentRunId)

    // The resumed attempt's context includes the persisted prior child transcript.
    const capture = kernelB.captured[0]!
    const text = bundleItemsText(capture.contextBundle)
    expect(text).toContain('Child result from attempt one')
    expect(text).toContain('Attempt one objective')
    expect(text).toContain('Attempt two objective')
    // And it is still free of parent conversation text.
    expect(text).not.toContain(PARENT_TRANSCRIPT_SENTINEL)
  })

  it('rejects unknown / archived / non-child / foreign taskIds across instances before execution', () => {
    const kernelB = new RecordingKernel([])
    const runtimeB = makeRuntime(h, kernelB)

    // Seed an archived child and a foreign child.
    const archived = h.sessionStore.createChildSession({
      sessionId: 'sess_archived',
      userId: 'user_A',
      parentSessionId: 'sess_parent',
    })
    h.sessionStore.updateStatus(archived.sessionId, 'archived')
    const foreign = h.sessionStore.createChildSession({
      sessionId: 'sess_foreign',
      userId: 'user_B',
      parentSessionId: 'sess_other_parent',
    })
    const foreground = h.sessionStore.create({ sessionId: 'sess_foreground', userId: 'user_A', title: 'Foreground' })

    const cases: Array<[string, string]> = [
      ['sess_no_such_task', CHILD_TASK_NOT_FOUND],
      [archived.sessionId, CHILD_TASK_ARCHIVED],
      [foreign.sessionId, CHILD_TASK_FOREIGN],
      [foreground.sessionId, CHILD_TASK_NOT_CHILD],
    ]

    for (const [taskIdUnderTest, code] of cases) {
      try {
        runtimeB.launchTask({
          parentContext: makeParentContext('user_A', 'sess_parent'),
          taskSpec: makeChildSpec({ objective: 'should be rejected' }),
          depth: 1,
          launchesInParentTurn: 0,
          taskId: taskIdUnderTest,
        })
        throw new Error(`Expected ChildTaskRuntimeError "${code}" for taskId "${taskIdUnderTest}" but launch succeeded`)
      } catch (err) {
        expect(err).toBeInstanceOf(ChildTaskRuntimeError)
        expect((err as ChildTaskRuntimeError).code).toBe(code)
      }
    }

    expect(kernelB.captured).toHaveLength(0)
  })
})
