/**
 * Durable background child notification — exactly-once + parent-turn delivery (Todo 9).
 *
 * On a terminal state the background runtime must persist an EXACTLY-ONCE
 * notification keyed by task/run (idempotency key) in durable storage (NOT
 * only in memory), then expose it to the parent on the NEXT turn as a bounded
 * synthetic safe completion/failure context item — without repeating it on
 * later turns and without injecting anything into finished historical calls.
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
import { createBackgroundRuntime, type BackgroundRuntime } from '../../../src/subagents/background-runtime.js'
import type { ChildTaskSpec } from '../../../src/subagents/child-session-task-runtime.js'
import { CHILD_TASK_MODEL_SUMMARY_MAX_CHARS } from '../../../src/foreground/tools/child-task-contract.js'

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

function makeBackgroundRuntime(h: Harness): BackgroundRuntime {
  return createBackgroundRuntime({
    backgroundRunStore: h.backgroundRunStore,
    eventStore: h.eventStore,
    maxConcurrentRuns: 4,
    watchdogTimeoutMs: 60000,
  })
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

function enqueueStartedRun(runtime: BackgroundRuntime, objective = 'Background report task'): string {
  const bgRunId = runtime.enqueueBackgroundRun({
    userId: 'user_A',
    sessionId: 'sess_parent',
    agentType: 'document_processor',
    agentProfile: 'document_processor',
    taskSpec: {
      objective,
      profileId: 'document_processor',
      tools: ['file_read'],
      parentSessionId: 'sess_parent',
      launchMode: 'background',
    } as ChildTaskSpec,
    launchSource: 'foreground_request',
  })
  // Simulate the worker starting the run.
  void runtime.startBackgroundRun(bgRunId)
  return bgRunId
}

afterEach(() => {
  while (connections.length > 0) {
    connections.pop()?.close()
  }
})

describe('Background child notification — exactly-once + parent-turn delivery', () => {
  let h: Harness
  let runtime: BackgroundRuntime

  beforeEach(() => {
    h = createStores()
    runtime = makeBackgroundRuntime(h)
  })

  it('produces exactly ONE notification for duplicate terminal callbacks', async () => {
    const bgRunId = enqueueStartedRun(runtime)
    const result = {
      status: 'completed' as const,
      response: 'Report ready',
      toolCalls: [],
      iterationsUsed: 3,
    }

    runtime.completeBackgroundRun(bgRunId, result)
    // Duplicate terminal callback (worker retry / late delivery) must be idempotent.
    runtime.completeBackgroundRun(bgRunId, result)

    const notifications = runtime.getPendingNotifications().filter((n) => n.backgroundRunId === bgRunId)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('completed')
  })

  it('does not create a second notification when a different terminal callback arrives late', async () => {
    const bgRunId = enqueueStartedRun(runtime)
    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Done',
      toolCalls: [],
      iterationsUsed: 1,
    })
    // A late "failure" after the run already completed must NOT overwrite or duplicate.
    runtime.failBackgroundRun(bgRunId, { code: 'LATE_FAILURE', message: 'arrived too late' })

    const notifications = runtime.getPendingNotifications().filter((n) => n.backgroundRunId === bgRunId)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.type).toBe('completed')
  })

  it('delivers ONE bounded synthetic item to the parent on the next turn and never repeats it', async () => {
    const bgRunId = enqueueStartedRun(runtime)
    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'The quarterly analysis is complete with 42 findings',
      toolCalls: [],
      iterationsUsed: 5,
    })

    // NEXT parent turn → exactly one synthetic context item, bounded and safe.
    const firstTurn = runtime.collectParentTurnNotifications({ parentSessionId: 'sess_parent' })
    expect(firstTurn).toHaveLength(1)
    expect(firstTurn[0]!.content).toContain('The quarterly analysis is complete')
    expect(firstTurn[0]!.content.length).toBeLessThanOrEqual(CHILD_TASK_MODEL_SUMMARY_MAX_CHARS)
    expect(firstTurn[0]!.structuredPayload).toMatchObject({
      backgroundRunId: bgRunId,
      status: 'completed',
      summary: 'The quarterly analysis is complete with 42 findings',
    })

    // LATER turns → never repeated.
    const laterTurns = runtime.collectParentTurnNotifications({ parentSessionId: 'sess_parent' })
    expect(laterTurns).toHaveLength(0)
  })

  it('delivers the notification durably across runtime instances (not in-memory only)', async () => {
    const bgRunId = enqueueStartedRun(runtime)
    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Durable notification content',
      toolCalls: [],
      iterationsUsed: 2,
    })

    // Brand-new runtime over the SAME database — nothing shared in memory.
    const runtimeB = makeBackgroundRuntime(h)
    const pending = runtimeB.getPendingNotifications().filter((n) => n.backgroundRunId === bgRunId)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.type).toBe('completed')

    // The parent-turn collector on the new instance delivers it once.
    const items = runtimeB.collectParentTurnNotifications({ parentSessionId: 'sess_parent' })
    expect(items).toHaveLength(1)
  })

  it('persists exactly one idempotency-keyed notification event to the event store', async () => {
    const bgRunId = enqueueStartedRun(runtime)
    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Event-store notification',
      toolCalls: [],
      iterationsUsed: 1,
    })
    // Duplicate callback.
    runtime.completeBackgroundRun(bgRunId, {
      status: 'completed',
      response: 'Event-store notification',
      toolCalls: [],
      iterationsUsed: 1,
    })

    const events = h.eventStore.query({ eventType: 'BackgroundTaskNotification', sessionId: 'sess_parent' })
    expect(events).toHaveLength(1)
    expect(events[0]!.idempotencyKey).toBe(`background-notification:${bgRunId}:completed`)
    expect(events[0]!.relatedRefs?.backgroundRunId).toBe(bgRunId)
  })

  it('sanitizes failure notifications (no secrets, no stack, bounded length)', async () => {
    const bgRunId = enqueueStartedRun(runtime)
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890'
    runtime.failBackgroundRun(bgRunId, {
      code: 'EXECUTION_ERROR',
      message: `Child kernel crashed with provider secret ${secret}\n    at KernelAdapter.execute (src/kernel/agent-kernel.ts:123)`,
    })

    const notifications = runtime.getPendingNotifications().filter((n) => n.backgroundRunId === bgRunId)
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.message).not.toContain(secret)
    expect(notifications[0]!.message.length).toBeLessThanOrEqual(CHILD_TASK_MODEL_SUMMARY_MAX_CHARS)

    const items = runtime.collectParentTurnNotifications({ parentSessionId: 'sess_parent' })
    expect(items).toHaveLength(1)
    const payload = items[0]!.structuredPayload as { error?: { code: string; message: string } }
    expect(payload.error?.code).toBe('EXECUTION_ERROR')
    expect(payload.error?.message).not.toContain(secret)
  })

  it('produces a bounded sanitized failure context item with the terminal error shape', async () => {
    const bgRunId = enqueueStartedRun(runtime)
    runtime.failBackgroundRun(bgRunId, {
      code: 'SUBAGENT_TIMEOUT',
      message: 'Child task exceeded its time budget while waiting for tool approval',
    })

    const items = runtime.collectParentTurnNotifications({ parentSessionId: 'sess_parent' })
    expect(items).toHaveLength(1)
    const payload = items[0]!.structuredPayload as {
      status: string
      summary: string
      error?: { code: string; message: string; recoverable: boolean; phase?: string }
    }
    expect(payload.status).toBe('failed')
    expect(payload.error?.code).toBe('SUBAGENT_TIMEOUT')
    expect(payload.error?.message.length).toBeLessThanOrEqual(CHILD_TASK_MODEL_SUMMARY_MAX_CHARS)
  })
})
