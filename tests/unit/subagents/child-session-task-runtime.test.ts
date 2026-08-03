/**
 * Child Session Task Runtime — unit tests (Todo 7).
 *
 * The unified runtime owns the whole child-task lifecycle:
 *   - create OR resume a child session (taskId === childSessionId identity rule)
 *   - persist task spec / prompt / attachments / workdir / parent-turn lineage
 *   - create a NEW `subagent_runs` attempt for EVERY launch and EVERY resume
 *   - delegate execution to a profile-specific runner (generic kernel adapter)
 *
 * Critical property under test: a FRESH child receives explicit task input
 * ONLY — objective + approved references + workdir + platform prompt — and
 * NONE of the parent conversation text. Resuming by taskId loads the prior
 * child transcript into the new attempt's context. Unknown / foreign /
 * archived / non-child taskIds are rejected with typed errors BEFORE any
 * session/run row is created or any kernel work happens.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { createSessionStore, type Session } from '../../../src/storage/session-store.js'
import { createSubagentRunStore } from '../../../src/storage/subagent-run-store.js'
import { createSubagentTranscriptStore } from '../../../src/storage/subagent-transcript-store.js'
import { createSubagentRegistry, type SubagentDefinition } from '../../../src/subagents/registry.js'
import { registerBuiltInSubagents } from '../../../src/subagents/builtin-definitions.js'
import { createToolRegistry } from '../../../src/tools/tool-registry.js'
import type { ToolRegistry, ToolCategory, ToolDefinition } from '../../../src/tools/types.js'
import { createAgentTypeToolEnvelopeRegistry } from '../../../src/permissions/agent-type-tool-envelope.js'
import type { KernelAdapter } from '../../../src/subagents/types.js'
import type { KernelRunResult } from '../../../src/kernel/types.js'
import type { ContextBundle } from '../../../src/context/types.js'
import {
  createChildSessionTaskRuntime,
  buildChildContextBundle,
  CHILD_TASK_NOT_FOUND,
  CHILD_TASK_ARCHIVED,
  CHILD_TASK_NOT_CHILD,
  CHILD_TASK_FOREIGN,
  CHILD_TASK_RUN_NOT_FOUND,
  type ChildTaskLaunchInput,
  type ChildTaskSpec,
} from '../../../src/subagents/child-session-task-runtime.js'
import {
  SUBAGENT_DEPTH_EXCEEDED,
  SUBAGENT_LAUNCH_LIMIT_EXCEEDED,
  SUBAGENT_PROFILE_UNKNOWN,
} from '../../../src/subagents/child-task-policy.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  registerFixtureTool(registry, 'artifact_create', 'write')
  registerFixtureTool(registry, 'exec', 'execute')
  return registry
}

class FakeKernelAdapter implements KernelAdapter {
  captured: Array<{
    contextBundle: ContextBundle
    maxIterations: number
    timeoutMs: number
    taskSpec?: unknown
    definition?: SubagentDefinition
    signal?: AbortSignal
  }> = []

  results: KernelRunResult[] = []

  setResults(results: KernelRunResult[]): void {
    this.results = [...results]
  }

  async execute(options: {
    contextBundle: ContextBundle
    maxIterations: number
    timeoutMs: number
    onCancel?: () => boolean
    taskSpec?: unknown
    definition?: SubagentDefinition
    signal?: AbortSignal
  }): Promise<KernelRunResult> {
    this.captured.push({
      contextBundle: options.contextBundle,
      maxIterations: options.maxIterations,
      timeoutMs: options.timeoutMs,
      taskSpec: options.taskSpec,
      definition: options.definition,
      signal: options.signal,
    })
    const result = this.results.shift() ?? {
      finalStatus: 'completed',
      finalResponse: 'Child completed',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
    }
    return result
  }

  get lastCapture() {
    return this.captured[this.captured.length - 1]
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
        itemId: 'parent-pinned-conversation',
        sourceType: 'session_history',
        semanticType: 'fact',
        content: `Parent said: ${PARENT_TRANSCRIPT_SENTINEL}`,
        structuredPayload: { sessionId: parentSessionId },
      },
    ],
    orderedItems: [
      {
        itemId: 'parent-ordered-conversation',
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
    objective: 'Summarize the attached report and list the top three risks',
    profileId: 'document_processor',
    tools: ['file_read', 'todolist', 'todowrite'],
    prompt: 'Platform instruction: produce a bounded, sanitized final answer.',
    references: [
      {
        kind: 'file_ref',
        ref: 'workdir://report.md',
        label: 'Report',
        content: 'Approved reference content: quarterly risk assessment.',
      },
    ],
    workDirRoot: '/tmp/managed-root',
    workDirId: 'wd_test',
    parentSessionId: 'sess_parent',
    launchMode: 'foreground',
    maxIterations: 5,
    timeoutMs: 30000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function createHarness() {
  const connection = openMemoryConnection()
  applyAll(connection)

  const sessionStore = createSessionStore(connection)
  const runStore = createSubagentRunStore(connection)
  const transcriptStore = createSubagentTranscriptStore(connection)

  sessionStore.create({ sessionId: 'sess_parent', userId: 'user_A', title: 'Parent' })
  sessionStore.create({ sessionId: 'sess_other_user_parent', userId: 'user_B', title: 'Other user parent' })

  const registry = createSubagentRegistry()
  registerBuiltInSubagents(registry)

  const toolRegistry = createFixtureToolRegistry()
  const envelopeRegistry = createAgentTypeToolEnvelopeRegistry()

  const kernel = new FakeKernelAdapter()
  kernel.setResults([
    {
      finalStatus: 'completed',
      finalResponse: 'First child response',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [],
    },
  ])

  const runtime = createChildSessionTaskRuntime({
    sessionStore,
    runStore,
    transcriptStore,
    kernelAdapter: kernel,
    registry,
    toolRegistry,
    envelopeRegistry,
    defaultMaxIterations: 5,
    defaultTimeoutMs: 30000,
  })

  return {
    connection,
    sessionStore,
    runStore,
    transcriptStore,
    registry,
    toolRegistry,
    envelopeRegistry,
    kernel,
    runtime,
  }
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChildSessionTaskRuntime — launch lifecycle', () => {
  let h: ReturnType<typeof createHarness>
  let input: ChildTaskLaunchInput

  beforeEach(() => {
    h = createHarness()
    input = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec(),
      depth: 1,
      launchesInParentTurn: 0,
      requestedTools: ['file_read', 'todolist', 'todowrite'],
    }
  })

  it('creates a subagent-kind child session with taskId === childSessionId', () => {
    const result = h.runtime.launchTask(input)

    expect(result.isResume).toBe(false)
    expect(result.childSessionId).toBeTruthy()
    expect(result.taskId).toBe(result.childSessionId)

    const child = h.sessionStore.getChildSessionById(result.childSessionId)
    expect(child).not.toBeNull()
    expect(child?.sessionKind).toBe('subagent')
    expect(child?.parentSessionId).toBe('sess_parent')
    expect(child?.taskId).toBe(result.childSessionId)
    expect(child?.agentProfile).toBe('document_processor')
    expect(child?.subagentDepth).toBe(1)
    expect(child?.launchMode).toBe('foreground')
  })

  it('creates exactly one subagent_runs attempt row linked to the child session and taskId', () => {
    const result = h.runtime.launchTask(input)

    const runs = h.runStore.query({ childSessionId: result.childSessionId })
    expect(runs).toHaveLength(1)
    expect(runs[0]!.subagentRunId).toBe(result.subagentRunId)
    expect(runs[0]!.taskId).toBe(result.childSessionId)
    expect(runs[0]!.sessionId).toBe(result.childSessionId)
    expect(runs[0]!.status).toBe('queued')
  })

  it('persists task spec / prompt / attachments / workdir / parent-turn lineage in the attempt', () => {
    const result = h.runtime.launchTask(input)

    const run = h.runStore.getById(result.subagentRunId)!
    const spec = JSON.parse(run.taskSpecJson) as ChildTaskSpec

    expect(spec.objective).toBe(input.taskSpec.objective)
    expect(spec.prompt).toContain('bounded, sanitized')
    expect(spec.references).toHaveLength(1)
    expect(spec.references![0]!.ref).toBe('workdir://report.md')
    expect(spec.workDirId).toBe('wd_test')
    expect(spec.workDirRoot).toBe('/tmp/managed-root')
    expect(spec.parentSessionId).toBe('sess_parent')
    expect(run.parentRunId).toBe('krun_parent')
    expect(run.rootRunId).toBe('krun_parent')
    expect(run.userId).toBe('user_A')
  })

  it('records a SubagentRunCreated transcript event scoped to the child session', () => {
    const result = h.runtime.launchTask(input)

    const events = h.transcriptStore.getByRunId(result.subagentRunId)
    expect(events.some((e) => e.eventType === 'SubagentRunCreated')).toBe(true)
  })
})

describe('ChildSessionTaskRuntime — fresh child context is explicit task input, NOT parent clone', () => {
  let h: ReturnType<typeof createHarness>

  beforeEach(() => {
    h = createHarness()
  })

  it('executes via the kernel adapter with a context bundle that is provably free of parent transcript text', async () => {
    const input: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec(),
      depth: 1,
      launchesInParentTurn: 0,
    }

    const launch = h.runtime.launchTask(input)
    await h.runtime.executeRun(launch.subagentRunId)

    expect(h.kernel.captured).toHaveLength(1)
    const bundle = h.kernel.lastCapture!.contextBundle

    const text = bundleItemsText(bundle)
    expect(text).toContain('Summarize the attached report')
    expect(text).toContain('Approved reference content: quarterly risk assessment.')
    expect(text).toContain('wd_test')
    expect(text).toContain('document_processor')
    // THE critical assertion: parent conversation text never reaches the child.
    expect(text).not.toContain(PARENT_TRANSCRIPT_SENTINEL)
  })

  it('does not copy any parent context items into the fresh child bundle', async () => {
    const parent = makeParentContext('user_A', 'sess_parent')
    const input: ChildTaskLaunchInput = {
      parentContext: parent,
      taskSpec: makeChildSpec(),
      depth: 1,
      launchesInParentTurn: 0,
    }

    const launch = h.runtime.launchTask(input)
    await h.runtime.executeRun(launch.subagentRunId)

    const bundle = h.kernel.lastCapture!.contextBundle
    const childItemIds = new Set([...bundle.pinnedItems, ...bundle.orderedItems].map((i) => i.itemId))
    const parentItemIds = new Set([...parent.pinnedItems, ...parent.orderedItems].map((i) => i.itemId))
    for (const parentId of parentItemIds) {
      expect(childItemIds.has(parentId)).toBe(false)
    }
  })

  it('sets child session identity, workdir and user on the executed bundle', async () => {
    const input: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec(),
      depth: 1,
      launchesInParentTurn: 0,
    }

    const launch = h.runtime.launchTask(input)
    await h.runtime.executeRun(launch.subagentRunId)

    const bundle = h.kernel.lastCapture!.contextBundle
    expect(bundle.userId).toBe('user_A')
    expect(bundle.agentType).toBe('subagent')
    expect(bundle.agentProfile).toBe('document_processor')
    expect(bundle.workDirRoot).toBe('/tmp/managed-root')
    expect(bundle.workDirId).toBe('wd_test')
    expect(bundle.runId).toBe(launch.subagentRunId)

    // sessionId is carried into the bundle for the kernel adapter to extract.
    const sessionText = JSON.stringify(bundle.orderedItems.map((i) => i.structuredPayload ?? {}))
    expect(sessionText).toContain(launch.childSessionId)
  })

  it('forwards the AbortSignal to the kernel adapter execution', async () => {
    const input: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec(),
      depth: 1,
      launchesInParentTurn: 0,
    }
    const launch = h.runtime.launchTask(input)

    const controller = new AbortController()
    controller.abort()
    await h.runtime.executeRun(launch.subagentRunId, controller.signal)

    const capture = h.kernel.lastCapture
    expect(capture?.signal).toBeDefined()
    expect(capture?.signal?.aborted).toBe(true)
  })

  it('persists the completed child conversation as the child transcript for later resume', async () => {
    h.kernel.setResults([
      {
        finalStatus: 'completed',
        finalResponse: 'First child response',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      },
    ])

    const input: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec(),
      depth: 1,
      launchesInParentTurn: 0,
    }
    const launch = h.runtime.launchTask(input)
    const result = await h.runtime.executeRun(launch.subagentRunId)

    expect(result.status).toBe('completed')
    expect(result.response).toBe('First child response')

    const events = h.transcriptStore.getByRunId(launch.subagentRunId)
    const turn = events.find((e) => e.eventType === 'ChildTurnCompleted')
    expect(turn).toBeDefined()
    expect(turn?.sessionId).toBe(launch.childSessionId)
    const payload = JSON.parse(turn!.contentJson) as { content?: string }
    expect(payload.content).toBe('First child response')
  })
})

describe('ChildSessionTaskRuntime — resume by taskId', () => {
  let h: ReturnType<typeof createHarness>
  let firstLaunch: { childSessionId: string; taskId: string; subagentRunId: string }

  beforeEach(async () => {
    h = createHarness()
    const input: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec({ objective: 'First pass: read the report' }),
      depth: 1,
      launchesInParentTurn: 0,
    }
    firstLaunch = h.runtime.launchTask(input)
    await h.runtime.executeRun(firstLaunch.subagentRunId)
  })

  it('resume reuses the same child session and creates a second run attempt', () => {
    const resumeInput: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec({ objective: 'Second pass: refine the risk list' }),
      depth: 1,
      launchesInParentTurn: 1,
      taskId: firstLaunch.taskId,
    }

    const resumed = h.runtime.launchTask(resumeInput)

    expect(resumed.isResume).toBe(true)
    expect(resumed.childSessionId).toBe(firstLaunch.childSessionId)
    expect(resumed.subagentRunId).not.toBe(firstLaunch.subagentRunId)

    const runs = h.runStore.query({ childSessionId: firstLaunch.childSessionId })
    expect(runs).toHaveLength(2)
  })

  it('includes the prior child transcript in the resumed run context', async () => {
    const resumeInput: ChildTaskLaunchInput = {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec({ objective: 'Second pass: refine the risk list' }),
      depth: 1,
      launchesInParentTurn: 1,
      taskId: firstLaunch.taskId,
    }

    const resumed = h.runtime.launchTask(resumeInput)
    await h.runtime.executeRun(resumed.subagentRunId)

    const capture = h.kernel.lastCapture!
    const text = bundleItemsText(capture.contextBundle)

    // Prior child work is present...
    expect(text).toContain('First child response')
    expect(text).toContain('First pass: read the report')
    // ...but the parent conversation is still absent.
    expect(text).not.toContain(PARENT_TRANSCRIPT_SENTINEL)
    // The new explicit objective is also present.
    expect(text).toContain('Second pass: refine the risk list')
  })
})

describe('ChildSessionTaskRuntime — typed rejection before execution', () => {
  let h: ReturnType<typeof createHarness>

  beforeEach(() => {
    h = createHarness()
  })

  function expectRuntimeError(fn: () => unknown, code: string): Error {
    try {
      fn()
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      // Typed rejection: runtime errors are ChildTaskRuntimeError; policy
      // violations are ChildTaskPolicyError. Both carry the `code` field.
      expect((err as { code?: string }).code).toBe(code)
      return err as Error
    }
    throw new Error(`Expected typed error with code "${code}" but nothing was thrown`)
  }

  function baseInput(overrides?: Partial<ChildTaskLaunchInput>): ChildTaskLaunchInput {
    return {
      parentContext: makeParentContext('user_A', 'sess_parent'),
      taskSpec: makeChildSpec(),
      depth: 1,
      launchesInParentTurn: 0,
      ...overrides,
    }
  }

  it('rejects an unknown taskId with CHILD_TASK_NOT_FOUND and creates no row and no kernel work', () => {
    const runsBefore = h.runStore.query({}).length

    expectRuntimeError(() => h.runtime.launchTask(baseInput({ taskId: 'sess_does_not_exist' })), CHILD_TASK_NOT_FOUND)

    expect(h.runStore.query({}).length).toBe(runsBefore)
    expect(h.kernel.captured).toHaveLength(0)
  })

  it('rejects a foreign taskId (child of another user) with CHILD_TASK_FOREIGN', () => {
    const foreignChild = h.sessionStore.createChildSession({
      sessionId: 'sess_foreign_child',
      userId: 'user_B',
      parentSessionId: 'sess_other_user_parent',
    })

    expectRuntimeError(() => h.runtime.launchTask(baseInput({ taskId: foreignChild.sessionId })), CHILD_TASK_FOREIGN)
    expect(h.kernel.captured).toHaveLength(0)
  })

  it('rejects a taskId belonging to a different parent session with CHILD_TASK_FOREIGN', () => {
    const otherParent = h.sessionStore.create({
      sessionId: 'sess_other_parent',
      userId: 'user_A',
      title: 'Other parent',
    })
    const otherChild = h.sessionStore.createChildSession({
      sessionId: 'sess_child_of_other_parent',
      userId: 'user_A',
      parentSessionId: otherParent.sessionId,
    })

    expectRuntimeError(() => h.runtime.launchTask(baseInput({ taskId: otherChild.sessionId })), CHILD_TASK_FOREIGN)
  })

  it('rejects an archived child taskId with CHILD_TASK_ARCHIVED', () => {
    const child = h.sessionStore.createChildSession({
      sessionId: 'sess_archived_child',
      userId: 'user_A',
      parentSessionId: 'sess_parent',
    })
    h.sessionStore.updateStatus(child.sessionId, 'archived')

    expectRuntimeError(() => h.runtime.launchTask(baseInput({ taskId: child.sessionId })), CHILD_TASK_ARCHIVED)
    expect(h.kernel.captured).toHaveLength(0)
  })

  it('rejects a non-child taskId (foreground session id) with CHILD_TASK_NOT_CHILD', () => {
    const foreground = h.sessionStore.create({
      sessionId: 'sess_plain_foreground',
      userId: 'user_A',
      title: 'A foreground session',
    })

    expectRuntimeError(() => h.runtime.launchTask(baseInput({ taskId: foreground.sessionId })), CHILD_TASK_NOT_CHILD)
    expect(h.kernel.captured).toHaveLength(0)
  })

  it('applies the policy gate BEFORE creating any session/run row', () => {
    const sessionsBefore = h.sessionStore.list({}, undefined).length
    const runsBefore = h.runStore.query({}).length

    // depth 4 → SUBAGENT_DEPTH_EXCEEDED
    expectRuntimeError(() => h.runtime.launchTask(baseInput({ depth: 4 })), SUBAGENT_DEPTH_EXCEEDED)
    // ninth launch in the parent turn → SUBAGENT_LAUNCH_LIMIT_EXCEEDED
    expectRuntimeError(
      () => h.runtime.launchTask(baseInput({ launchesInParentTurn: 8 })),
      SUBAGENT_LAUNCH_LIMIT_EXCEEDED,
    )
    // unknown profile → SUBAGENT_PROFILE_UNKNOWN
    expectRuntimeError(
      () => h.runtime.launchTask(baseInput({ taskSpec: makeChildSpec({ profileId: 'ghost_profile' }) })),
      SUBAGENT_PROFILE_UNKNOWN,
    )

    expect(h.sessionStore.list({}, undefined).length).toBe(sessionsBefore)
    expect(h.runStore.query({}).length).toBe(runsBefore)
    expect(h.kernel.captured).toHaveLength(0)
  })

  it('rejects execution of an unknown run id', async () => {
    await expect(h.runtime.executeRun('subagent-missing-run')).rejects.toMatchObject({ code: CHILD_TASK_RUN_NOT_FOUND })
  })
})

describe('ChildSessionTaskRuntime — buildChildContextBundle pure assembly', () => {
  it('renders objective, references, workdir and platform prompt but never parent items', () => {
    const child: Session = {
      sessionId: 'sess_child_pure',
      userId: 'user_A',
      title: 'Child',
      status: 'active',
      messageCount: 0,
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sessionKind: 'subagent',
      parentSessionId: 'sess_parent',
      taskId: 'sess_child_pure',
      agentProfile: 'document_processor',
      subagentDepth: 1,
      launchMode: 'foreground',
    }

    const registry = createSubagentRegistry()
    registerBuiltInSubagents(registry)
    const definition = registry.assertAllowed('document_processor')

    const bundle = buildChildContextBundle({
      childSession: child,
      runId: 'subagent-run-1',
      definition,
      taskSpec: makeChildSpec({ objective: 'Pure objective text' }),
      toolProjection: { toolIds: ['file_read'], tools: [] },
      priorConversation: undefined,
    })

    const text = bundleItemsText(bundle)
    expect(text).toContain('Pure objective text')
    expect(text).toContain('Approved reference content')
    expect(text).toContain('wd_test')
    expect(text).toContain('document_processor')
    expect(text).not.toContain(PARENT_TRANSCRIPT_SENTINEL)
  })
})
