import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createToolExecutor, createToolOrchestrator, createToolRegistry } from '../../../src/tools/index.js'
import { createPermissionEngine } from '../../../src/permissions/permission-engine.js'
import type { PermissionContext, ToolDefinition, ToolExecutorConfig } from '../../../src/tools/types.js'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createToolExecutionStore } from '../../../src/storage/tool-execution-store.js'
import { createEventStore } from '../../../src/storage/event-store.js'
import { createApprovalStore } from '../../../src/storage/approval-store.js'
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { generateId, GRANT_ID_PREFIX } from '../../../src/shared/ids.js'

describe('ToolOrchestrator Integration', () => {
  let connection: ConnectionManager
  let toolExecutionStore: ReturnType<typeof createToolExecutionStore>
  let eventStore: ReturnType<typeof createEventStore>
  let approvalStore: ReturnType<typeof createApprovalStore>
  let grantStore: ReturnType<typeof createPermissionGrantStore>
  let permissionEngine: ReturnType<typeof createPermissionEngine>

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()

    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)

    toolExecutionStore = createToolExecutionStore(connection)
    eventStore = createEventStore(connection)
    approvalStore = createApprovalStore(connection)
    grantStore = createPermissionGrantStore(connection)

    permissionEngine = createPermissionEngine(
      {
        approvalStore,
        grantStore,
        eventStore,
      },
      {
        auditAllDecisions: false,
      },
    )
  })

  afterEach(() => {
    connection.close()
  })

  it('read tools concurrently', async () => {
    const registry = createToolRegistry()

    registry.register(createDelayedTool('read-one', 'read'))
    registry.register(createDelayedTool('read-two', 'search'))

    const orchestrator = createToolOrchestrator({
      executor: createToolExecutor(createExecutorConfig(registry)),
      registry,
      maxParallelReads: 5,
    })

    const startedAt = performance.now()
    const results = await orchestrator.executeBatch([
      createToolUse('read-call-1', 'read-one'),
      createToolUse('read-call-2', 'read-two'),
    ])
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(350)
    expect(results).toHaveLength(2)
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(true)
    expect(results.map((result) => result.data)).toEqual(['read-one done', 'read-two done'])
  })

  it('write tools serial', async () => {
    const registry = createToolRegistry()
    const executionOrder: string[] = []

    registry.register(createWriteTool('write-one', executionOrder, true))
    registry.register(createWriteTool('write-two', executionOrder, false))
    registry.register(createWriteTool('write-three', executionOrder, true))

    for (const toolName of ['write-one', 'write-two', 'write-three']) {
      grantStore.create({
        id: generateId(GRANT_ID_PREFIX),
        userId: 'user-1',
        scope: 'session-1',
        action: `tool:${toolName}`,
        resourcePattern: undefined,
        expiresAt: undefined,
      })
    }

    const orchestrator = createToolOrchestrator({
      executor: createToolExecutor(createExecutorConfig(registry)),
      registry,
    })
    const permissionContext = createTestPermissionContext(grantStore.findActiveByUserAndScope('user-1', 'session-1'))

    const results = await orchestrator.executeBatch([
      createToolUse('write-call-1', 'write-one', permissionContext),
      createToolUse('write-call-2', 'write-two', permissionContext),
      createToolUse('write-call-3', 'write-three', permissionContext),
    ])

    expect(executionOrder).toEqual(['write-one', 'write-two'])
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(false)
    expect(results[1].error?.code).toBe('EXECUTION_FAILED')
    expect(results[2]).toMatchObject({
      success: false,
      status: 'skipped',
      synthetic: true,
      error: {
        code: 'SIBLING_WRITE_FAILED',
      },
    })
  })

  function createExecutorConfig(registry: ReturnType<typeof createToolRegistry>): ToolExecutorConfig {
    return {
      registry,
      permissionEngine,
      toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
      eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
    }
  }
})

function createDelayedTool(name: string, category: 'read' | 'search'): ToolDefinition {
  return {
    name,
    description: `${name} delayed tool`,
    category,
    sensitivity: 'low',
    schema: { type: 'object', properties: {} },
    handler: async () => {
      await delay(200)
      return { success: true, data: `${name} done` }
    },
  }
}

function createWriteTool(name: string, executionOrder: string[], shouldSucceed: boolean): ToolDefinition {
  return {
    name,
    description: `${name} write tool`,
    category: 'write',
    sensitivity: 'medium',
    schema: { type: 'object', properties: {} },
    handler: async () => {
      executionOrder.push(name)
      if (!shouldSucceed) {
        throw new Error(`${name} failed`)
      }

      return { success: true, data: `${name} done` }
    },
  }
}

function createToolUse(
  toolCallId: string,
  toolName: string,
  permissionContext: PermissionContext = createTestPermissionContext(),
) {
  return {
    toolCallId,
    toolName,
    params: {},
    userId: 'user-1',
    sessionId: 'session-1',
    permissionContext,
  }
}

function createTestPermissionContext(grants: PermissionContext['grants'] = []): PermissionContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    mode: 'ask_on_write',
    grants,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
