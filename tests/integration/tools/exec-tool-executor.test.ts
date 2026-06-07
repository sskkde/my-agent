/**
 * Integration tests for exec tool flowing through ToolExecutor permission system.
 *
 * Tests verify:
 * - Exec tool is registered when processSessionStore is provided
 * - Exec tool has category='execute' (requires approval)
 * - Tool flows through ToolExecutor with proper permission checking
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { createToolRegistry, createToolExecutor } from '../../../src/tools/index.js'
import { createPermissionEngine } from '../../../src/permissions/permission-engine.js'
import { registerBuiltInTools } from '../../../src/tools/builtins/index.js'
import { ProcessSessionStore } from '../../../src/tools/builtins/process-session-store.js'
import type { ToolExecutorConfig, PermissionContext } from '../../../src/tools/types.js'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createToolExecutionStore } from '../../../src/storage/tool-execution-store.js'
import { createEventStore } from '../../../src/storage/event-store.js'
import { createApprovalStore } from '../../../src/storage/approval-store.js'
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'
import { generateId, GRANT_ID_PREFIX } from '../../../src/shared/ids.js'

// Mock safe-paths to set workspace root
vi.mock('../../../src/tools/builtins/safe-paths.js', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    getWorkspaceRoot: () => '/tmp/test-workspace',
  }
})

describe('Exec Tool Executor Integration', () => {
  let connection: ConnectionManager
  let toolExecutionStore: ReturnType<typeof createToolExecutionStore>
  let eventStore: ReturnType<typeof createEventStore>
  let approvalStore: ReturnType<typeof createApprovalStore>
  let grantStore: ReturnType<typeof createPermissionGrantStore>
  let permissionEngine: ReturnType<typeof createPermissionEngine>
  let processSessionStore: ProcessSessionStore

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

    processSessionStore = new ProcessSessionStore()
  })

  afterAll(() => {
    connection.close()
  })

  describe('Tool Registration', () => {
    it('should register exec tool when processSessionStore is provided', () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const execTool = registry.getTool('exec')
      expect(execTool).toBeDefined()
      expect(execTool?.name).toBe('exec')
      expect(execTool?.category).toBe('execute')
      expect(execTool?.sensitivity).toBe('high')
      expect(execTool?.requiresPermission).toBe(true)
    })

    it('should register bash tool as exec alias', () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const bashTool = registry.getTool('bash')
      expect(bashTool).toBeDefined()
      expect(bashTool?.name).toBe('bash')
      expect(bashTool?.category).toBe('execute')
      expect(bashTool?.sensitivity).toBe('high')
    })

    it('should register process tool for session management', () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const processTool = registry.getTool('process')
      expect(processTool).toBeDefined()
      expect(processTool?.name).toBe('process')
      expect(processTool?.category).toBe('execute')
      expect(processTool?.sensitivity).toBe('high')
    })

    it('should register code_execution tool', () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const codeExecTool = registry.getTool('code_execution')
      expect(codeExecTool).toBeDefined()
      expect(codeExecTool?.name).toBe('code_execution')
      expect(codeExecTool?.category).toBe('execute')
      expect(codeExecTool?.sensitivity).toBe('high')
    })

    it('should not register runtime tools when enableRuntimeTools is false', () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: false,
      })

      expect(registry.getTool('exec')).toBeNull()
      expect(registry.getTool('bash')).toBeNull()
      expect(registry.getTool('process')).toBeNull()
      expect(registry.getTool('code_execution')).toBeNull()
    })
  })

  describe('Permission Flow Through ToolExecutor', () => {
    it('should require approval for exec tool (execute category)', async () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      }

      const executor = createToolExecutor(config)

      const result = await executor.execute({
        toolCallId: 'call-1',
        toolName: 'exec',
        params: { command: 'echo hello' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
      expect(result.error?.recoverable).toBe(true)
      expect(result.structuredContent?.status).toBe('requires_approval')
    })

    it('should execute exec tool with permission grant', async () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      // Grant permission for exec tool
      grantStore.create({
        id: generateId(GRANT_ID_PREFIX),
        userId: 'user-1',
        scope: 'session-1',
        action: 'tool:exec',
        resourcePattern: undefined,
        expiresAt: undefined,
      })

      const grants = grantStore.findActiveByUserAndScope('user-1', 'session-1')

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      }

      const executor = createToolExecutor(config)

      const result = await executor.execute({
        toolCallId: 'call-2',
        toolName: 'exec',
        params: { command: 'echo hello', timeoutMs: 5000, yieldMs: 100 },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: {
          userId: 'user-1',
          sessionId: 'session-1',
          mode: 'ask_on_write',
          grants,
        },
      })

      // With permission grant, exec should run (or fail on validation, but not permission)
      expect(result.error?.code).not.toBe('APPROVAL_REQUIRED')
      expect(result.error?.code).not.toBe('PERMISSION_DENIED')
    })

    it('should require approval for process tool', async () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      }

      const executor = createToolExecutor(config)

      const result = await executor.execute({
        toolCallId: 'call-3',
        toolName: 'process',
        params: { action: 'list' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
      expect(result.error?.recoverable).toBe(true)
    })

    it('should require approval for code_execution tool', async () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      }

      const executor = createToolExecutor(config)

      const result = await executor.execute({
        toolCallId: 'call-4',
        toolName: 'code_execution',
        params: { language: 'javascript', code: 'console.log(1+1)' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: createTestPermissionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
      expect(result.error?.recoverable).toBe(true)
    })

    it('should deny exec tool in hard_deny mode', async () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      }

      const executor = createToolExecutor(config)

      const result = await executor.execute({
        toolCallId: 'call-5',
        toolName: 'exec',
        params: { command: 'echo hello' },
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: {
          userId: 'user-1',
          sessionId: 'session-1',
          mode: 'hard_deny',
          grants: [],
        },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PERMISSION_DENIED')
      expect(result.error?.recoverable).toBe(false)
    })
  })

  describe('Schema Validation', () => {
    it('should reject exec call without command', async () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      // Grant permission
      grantStore.create({
        id: generateId(GRANT_ID_PREFIX),
        userId: 'user-1',
        scope: 'session-1',
        action: 'tool:exec',
        resourcePattern: undefined,
        expiresAt: undefined,
      })

      const grants = grantStore.findActiveByUserAndScope('user-1', 'session-1')

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      }

      const executor = createToolExecutor(config)

      const result = await executor.execute({
        toolCallId: 'call-6',
        toolName: 'exec',
        params: {}, // Missing required 'command'
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: {
          userId: 'user-1',
          sessionId: 'session-1',
          mode: 'ask_on_write',
          grants,
        },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SCHEMA_VALIDATION_FAILED')
    })

    it('should reject process call without action', async () => {
      const registry = createToolRegistry()

      registerBuiltInTools(registry, {
        artifactStore: createMockArtifactStore(),
        summaryStore: createMockSummaryStore(),
        transcriptStore: createMockTranscriptStore(),
        planStore: createMockPlanStore(),
        longTermMemoryStore: createMockLongTermMemoryStore(),
        sessionStore: createMockSessionStore(),
        processSessionStore,
        enableRuntimeTools: true,
      })

      // Grant permission
      grantStore.create({
        id: generateId(GRANT_ID_PREFIX),
        userId: 'user-1',
        scope: 'session-1',
        action: 'tool:process',
        resourcePattern: undefined,
        expiresAt: undefined,
      })

      const grants = grantStore.findActiveByUserAndScope('user-1', 'session-1')

      const config: ToolExecutorConfig = {
        registry,
        permissionEngine,
        toolExecutionStore: toolExecutionStore as unknown as ToolExecutorConfig['toolExecutionStore'],
        eventStore: eventStore as unknown as ToolExecutorConfig['eventStore'],
      }

      const executor = createToolExecutor(config)

      const result = await executor.execute({
        toolCallId: 'call-7',
        toolName: 'process',
        params: {}, // Missing required 'action'
        userId: 'user-1',
        sessionId: 'session-1',
        permissionContext: {
          userId: 'user-1',
          sessionId: 'session-1',
          mode: 'ask_on_write',
          grants,
        },
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SCHEMA_VALIDATION_FAILED')
    })
  })
})

// Helper functions

function createTestPermissionContext(): PermissionContext {
  return {
    userId: 'user-1',
    sessionId: 'session-1',
    mode: 'ask_on_write',
    grants: [],
  }
}

// Mock stores (minimal implementations)

function createMockArtifactStore() {
  return {
    create: () => ({}) as any,
    findByArtifactId: () => undefined,
    findById: () => undefined,
    findByUserId: () => [],
    findBySessionId: () => [],
    findByType: () => [],
    findByStatus: () => [],
    update: () => undefined,
    delete: () => false,
    applyMigrations: () => {},
  }
}

function createMockSummaryStore() {
  return {
    save: () => {},
    getBySummaryId: () => null,
    getByType: () => [],
    getWorkingSummary: () => null,
    getSessionMemory: () => null,
    applyPatch: () => ({}) as any,
  }
}

function createMockTranscriptStore() {
  return {
    saveTurn: () => true,
    getTurn: () => null,
    findBySession: () => [],
    search: () => [],
    findByArtifactRef: () => [],
    findByPlannerRunId: () => [],
    updateUserIdForSession: () => 0,
  }
}

function createMockPlanStore() {
  return {
    createPlan: () => ({}) as any,
    getPlan: () => null,
    applyPatch: () => ({}) as any,
    getPatches: () => [],
    findByObjectiveHash: () => [],
    updateStepStatus: () => {},
  }
}

function createMockLongTermMemoryStore() {
  return {
    save: () => {},
    getByMemoryId: () => null,
    getByUserId: () => [],
    getByType: () => [],
    search: () => [],
    delete: () => {},
    applyPatch: () => ({}) as any,
    findCurrentByFingerprint: () => null,
    upsertExtracted: () => {},
    createTombstone: () => {},
    hasTombstone: () => false,
    getTombstone: () => null,
    hasTombstoneForSource: () => false,
    searchActive: () => [],
    getByEntityName: () => [],
    getByDateRange: () => [],
  }
}

function createMockSessionStore() {
  return {
    create: () => ({}) as any,
    getById: () => null,
    list: () => [],
    updateActivity: () => false,
    updateMetadata: () => false,
    updateStatus: () => false,
    updateTitle: () => false,
    updateUserId: () => false,
    setModel: () => false,
    getCount: () => 0,
  }
}
