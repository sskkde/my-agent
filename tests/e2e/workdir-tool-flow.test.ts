/**
 * E2E tests: Workdir tool flow
 *
 * Proves that:
 * 1. Session A writes a file to workdir A without approval
 * 2. Session B writes to workdir B without approval
 * 3. Same user can switch session A to workdir B (owned by same user)
 * 4. User B cannot switch/read user A workdir
 * 5. No approval records are created for in-workdir file writes
 * 6. Cross-user switch/read/write attempts fail safely
 * 7. Exec-without-approval attempt fails (exec still requires approval)
 *
 * Architecture note: The permission engine's workdir carve-out expects `resource`
 * to be a file path (not tool name). The tool executor passes `resource: toolName`,
 * so we test the carve-out via direct permission engine calls and test the full
 * tool execution flow (including workDirRoot threading) via the tool executor.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js'
import { createMigrationRunner } from '../../src/storage/migrations.js'
import { allStoreMigrations } from '../../src/storage/all-stores-migrations.js'
import { createWorkdirStore, type WorkdirStore } from '../../src/storage/workdir-store.js'
import {
  createSessionWorkdirStateStore,
  type SessionWorkdirStateStore,
} from '../../src/storage/session-workdir-state-store.js'
import {
  createWorkdirService,
  type WorkdirService,
  type FileSystemOps,
} from '../../src/workdirs/workdir-service.js'
import { createApprovalStore, type ApprovalStore } from '../../src/storage/approval-store.js'
import { createPermissionGrantStore } from '../../src/storage/permission-grant-store.js'
import { createEventStore, type EventStore } from '../../src/storage/event-store.js'
import { createToolExecutionStore, type ToolExecutionStore } from '../../src/storage/tool-execution-store.js'
import { createToolRegistry } from '../../src/tools/tool-registry.js'
import { createToolExecutor } from '../../src/tools/tool-executor.js'
import { createPermissionEngine } from '../../src/permissions/permission-engine.js'
import { createPermissionContext, type PermissionCheckRequest } from '../../src/permissions/types.js'
import type { ToolDefinition, ToolExecutionContext } from '../../src/tools/types.js'
import type { PermissionContext } from '../../src/permissions/types.js'
import type { ToolExecutionState } from '../../src/shared/states.js'

// =============================================================================
// HELPERS
// =============================================================================

function createWorkdirSchema(connection: ConnectionManager): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS work_directories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      metadata TEXT
    )
  `)
  connection.exec(`CREATE INDEX IF NOT EXISTS idx_work_directories_user ON work_directories(tenant_id, user_id)`)
  connection.exec(
    `CREATE INDEX IF NOT EXISTS idx_work_directories_deleted ON work_directories(tenant_id, user_id, deleted_at)`,
  )

  connection.exec(`
    CREATE TABLE IF NOT EXISTS session_workdir_state (
      tenant_id TEXT NOT NULL DEFAULT 'org_default',
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      active_work_dir_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, session_id),
      FOREIGN KEY (active_work_dir_id) REFERENCES work_directories(id)
    )
  `)
  connection.exec(
    `CREATE INDEX IF NOT EXISTS idx_session_workdir_state_session ON session_workdir_state(tenant_id, user_id, session_id)`,
  )
}

function createMockFsOps(): FileSystemOps {
  return { mkdir: () => {} }
}

// =============================================================================
// TEST FIXTURE
// =============================================================================

interface WorkdirE2EFixture {
  connection: ConnectionManager
  workdirStore: WorkdirStore
  sessionStateStore: SessionWorkdirStateStore
  workdirService: WorkdirService
  approvalStore: ApprovalStore
  eventStore: EventStore
  toolExecutionStore: ToolExecutionStore
  permissionEngine: ReturnType<typeof createPermissionEngine>
  toolExecutor: ReturnType<typeof createToolExecutor>
  tmpDir: string
  cleanup(): void
}

function createFixture(): WorkdirE2EFixture {
  const connection = createConnectionManager(':memory:')
  connection.open()

  const migrationRunner = createMigrationRunner(connection)
  migrationRunner.init()
  migrationRunner.apply(allStoreMigrations)

  createWorkdirSchema(connection)

  const workdirStore = createWorkdirStore(connection)
  const sessionStateStore = createSessionWorkdirStateStore(connection)
  const approvalStore = createApprovalStore(connection)
  const permissionGrantStore = createPermissionGrantStore(connection)
  const eventStore = createEventStore(connection)
  const toolExecutionStore = createToolExecutionStore(connection)

  const workdirService = createWorkdirService({
    workdirStore,
    sessionStateStore,
    fsOps: createMockFsOps(),
  })

  const permissionEngine = createPermissionEngine(
    { approvalStore, grantStore: permissionGrantStore, eventStore },
    {
      defaultExpiryMs: 3600000,
      maxPendingApprovals: 10,
      auditAllDecisions: true,
      respectExistingGrants: true,
    },
  )

  const toolRegistry = createToolRegistry()

  const toolExecutor = createToolExecutor({
    registry: toolRegistry,
    permissionEngine: {
      checkPermission: (request) => permissionEngine.checkPermission(request),
    },
    toolExecutionStore: {
      create: (exec) => {
        toolExecutionStore.create(exec as Parameters<ToolExecutionStore['create']>[0])
      },
      updateStatus: (toolCallId, status) => {
        toolExecutionStore.updateStatus(toolCallId, status as ToolExecutionState)
      },
      saveResult: (toolCallId, result) => {
        toolExecutionStore.saveResult(toolCallId, result)
      },
    },
    eventStore: {
      append: (event) => {
        eventStore.append(event as Parameters<EventStore['append']>[0])
      },
    },
  })

  const tmpDir = join(tmpdir(), `workdir-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })

  return {
    connection,
    workdirStore,
    sessionStateStore,
    workdirService,
    approvalStore,
    eventStore,
    toolExecutionStore,
    permissionEngine,
    toolExecutor,
    tmpDir,
    cleanup() {
      rmSync(tmpDir, { recursive: true, force: true })
      connection.close()
    },
  }
}

// =============================================================================
// MOCK TOOLS
// =============================================================================

function createMockFileWriteTool(): ToolDefinition {
  return {
    name: 'file_write',
    description: 'Write content to a file',
    category: 'write',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    handler: async (params, context?: ToolExecutionContext) => {
      const { path: filePath, content } = params as { path: string; content: string }
      const workDirRoot = context?.workDirRoot

      if (!workDirRoot) {
        return {
          success: false,
          error: { code: 'NO_WORKDIR', message: 'No active workdir set', recoverable: false },
          resultPreview: 'No workdir',
        }
      }

      const fullPath = filePath.startsWith('/') ? filePath : join(workDirRoot, filePath)

      try {
        writeFileSync(fullPath, content, 'utf-8')
        return {
          success: true,
          data: { path: fullPath, bytesWritten: content.length },
          resultPreview: `Wrote ${content.length} bytes to ${filePath}`,
        }
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'WRITE_FAILED',
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          },
          resultPreview: 'Write failed',
        }
      }
    },
  }
}

function createMockFileReadTool(): ToolDefinition {
  return {
    name: 'file_read',
    description: 'Read content from a file',
    category: 'read',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
    handler: async (params, context?: ToolExecutionContext) => {
      const { path: filePath } = params as { path: string }
      const workDirRoot = context?.workDirRoot

      if (!workDirRoot) {
        return {
          success: false,
          error: { code: 'NO_WORKDIR', message: 'No active workdir set', recoverable: false },
          resultPreview: 'No workdir',
        }
      }

      const fullPath = filePath.startsWith('/') ? filePath : join(workDirRoot, filePath)

      try {
        const content = readFileSync(fullPath, 'utf-8')
        return {
          success: true,
          data: { path: fullPath, content, lines: content.split('\n').length },
          resultPreview: `Read ${content.length} chars from ${filePath}`,
        }
      } catch (error) {
        return {
          success: false,
          error: {
            code: 'READ_FAILED',
            message: error instanceof Error ? error.message : String(error),
            recoverable: true,
          },
          resultPreview: 'Read failed',
        }
      }
    },
  }
}

function createMockExecTool(): ToolDefinition {
  return {
    name: 'exec',
    description: 'Execute a shell command',
    category: 'execute',
    sensitivity: 'high',
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
      },
      required: ['command'],
    },
    handler: async (params) => {
      const { command } = params as { command: string }
      return {
        success: true,
        data: { command, output: `executed: ${command}` },
        resultPreview: `Ran: ${command}`,
      }
    },
  }
}

function makeToolContext(
  userId: string,
  sessionId: string,
  workDirRoot?: string,
  workDirId?: string,
): ToolExecutionContext {
  return {
    toolCallId: `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    toolName: 'file_write',
    userId,
    sessionId,
    permissionContext: createPermissionContext(userId, sessionId, 'ask_on_write'),
    executionStartTime: new Date().toISOString(),
    workDirRoot,
    workDirId,
    stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('E2E: Workdir Tool Flow', () => {
  let fx: WorkdirE2EFixture

  beforeEach(() => {
    fx = createFixture()
    const registry = (fx.toolExecutor as unknown as { config: { registry: ReturnType<typeof createToolRegistry> } })
      .config.registry
    registry.register(createMockFileWriteTool())
    registry.register(createMockFileReadTool())
    registry.register(createMockExecTool())
  })

  afterEach(() => {
    fx.cleanup()
  })

  function executeWithWorkdir(
    toolName: string,
    params: unknown,
    userId: string,
    sessionId: string,
    workDirRoot?: string,
    workDirId?: string,
  ) {
    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    }

    return fx.toolExecutor.execute({
      toolCallId: `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      toolName,
      params,
      userId,
      sessionId,
      permissionContext,
      workDirRoot,
      workDirId,
    })
  }

  function checkPermissionDirect(
    actionType: string,
    resource: string,
    userId: string,
    sessionId: string,
    operationType: 'read' | 'write' | 'execute',
    workDirRoot?: string,
    workDirId?: string,
  ) {
    const context = createPermissionContext(userId, sessionId, 'ask_on_write')
    const request: PermissionCheckRequest = {
      context,
      actionType,
      resource,
      operationType,
      workDirRoot,
      workDirId,
    }
    return fx.permissionEngine.checkPermission(request)
  }

  // ===========================================================================
  // Scenario 1: Session A writes a file to workdir A without approval
  // ===========================================================================
  describe('Scenario 1: Session A writes to workdir A', () => {
    it('auto-allows file_write in workdir A without approval (permission engine)', () => {
      const userA = 'user-a'
      const sessionA = 'session-a'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      fx.workdirService.setActiveWorkdir(sessionA, workdirA.id, userA)
      mkdirSync(workdirA.path, { recursive: true })

      const decision = checkPermissionDirect(
        'tool:file_write',
        join(workdirA.path, 'hello.txt'),
        userA,
        sessionA,
        'write',
        workdirA.path,
        workdirA.id,
      )

      expect(decision.allowed).toBe(true)
      expect(decision.status).toBe('allowed')
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
    })

    it('creates a file in workdir A via tool handler with workDirRoot', async () => {
      const userA = 'user-a'
      const sessionA = 'session-a'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      fx.workdirService.setActiveWorkdir(sessionA, workdirA.id, userA)
      mkdirSync(workdirA.path, { recursive: true })

      const handler = createMockFileWriteTool().handler
      const result = await handler(
        { path: join(workdirA.path, 'hello.txt'), content: 'Hello from session A' },
        makeToolContext(userA, sessionA, workdirA.path, workdirA.id),
      )

      expect(result.success).toBe(true)

      const content = readFileSync(join(workdirA.path, 'hello.txt'), 'utf-8')
      expect(content).toBe('Hello from session A')
    })
  })

  // ===========================================================================
  // Scenario 2: Session B writes to workdir B without approval
  // ===========================================================================
  describe('Scenario 2: Session B writes to workdir B', () => {
    it('auto-allows file_write in workdir B without approval (permission engine)', () => {
      const userB = 'user-b'
      const sessionB = 'session-b'

      const workdirB = fx.workdirService.createDefaultWorkdir(userB)
      fx.workdirService.setActiveWorkdir(sessionB, workdirB.id, userB)
      mkdirSync(workdirB.path, { recursive: true })

      const decision = checkPermissionDirect(
        'tool:file_write',
        join(workdirB.path, 'data.txt'),
        userB,
        sessionB,
        'write',
        workdirB.path,
        workdirB.id,
      )

      expect(decision.allowed).toBe(true)
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
    })

    it('creates a file in workdir B via tool handler', async () => {
      const userB = 'user-b'
      const sessionB = 'session-b'

      const workdirB = fx.workdirService.createDefaultWorkdir(userB)
      fx.workdirService.setActiveWorkdir(sessionB, workdirB.id, userB)
      mkdirSync(workdirB.path, { recursive: true })

      const handler = createMockFileWriteTool().handler
      const result = await handler(
        { path: join(workdirB.path, 'data.txt'), content: 'Session B data' },
        makeToolContext(userB, sessionB, workdirB.path, workdirB.id),
      )

      expect(result.success).toBe(true)

      const content = readFileSync(join(workdirB.path, 'data.txt'), 'utf-8')
      expect(content).toBe('Session B data')
    })
  })

  // ===========================================================================
  // Scenario 3: Same user can switch session A to workdir B (same owner)
  // ===========================================================================
  describe('Scenario 3: Same user switches session workdir', () => {
    it('allows switching session from workdir A to workdir B when both owned by same user', () => {
      const userA = 'user-a'
      const sessionA = 'session-a'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      const workdirB = fx.workdirService.createWorkdir(userA, 'project-b')

      mkdirSync(workdirA.path, { recursive: true })
      mkdirSync(workdirB.path, { recursive: true })

      fx.workdirService.setActiveWorkdir(sessionA, workdirA.id, userA)
      expect(fx.workdirService.getActiveWorkdir(sessionA, userA)?.id).toBe(workdirA.id)

      fx.workdirService.setActiveWorkdir(sessionA, workdirB.id, userA)
      expect(fx.workdirService.getActiveWorkdir(sessionA, userA)?.id).toBe(workdirB.id)
    })

    it('file_write auto-allow follows the active workdir switch', () => {
      const userA = 'user-a'
      const sessionA = 'session-a'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      const workdirB = fx.workdirService.createWorkdir(userA, 'project-b')

      mkdirSync(workdirA.path, { recursive: true })
      mkdirSync(workdirB.path, { recursive: true })

      // Initially in workdir A
      fx.workdirService.setActiveWorkdir(sessionA, workdirA.id, userA)
      const decisionA = checkPermissionDirect(
        'tool:file_write',
        join(workdirA.path, 'a.txt'),
        userA,
        sessionA,
        'write',
        workdirA.path,
        workdirA.id,
      )
      expect(decisionA.allowed).toBe(true)

      // Switch to workdir B
      fx.workdirService.setActiveWorkdir(sessionA, workdirB.id, userA)
      const decisionB = checkPermissionDirect(
        'tool:file_write',
        join(workdirB.path, 'b.txt'),
        userA,
        sessionA,
        'write',
        workdirB.path,
        workdirB.id,
      )
      expect(decisionB.allowed).toBe(true)
    })
  })

  // ===========================================================================
  // Scenario 4: User B cannot switch/read user A workdir
  // ===========================================================================
  describe('Scenario 4: Cross-user isolation', () => {
    it('prevents user B from switching to user A workdir', () => {
      const userA = 'user-a'
      const userB = 'user-b'
      const sessionB = 'session-b'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      mkdirSync(workdirA.path, { recursive: true })

      expect(() => {
        fx.workdirService.setActiveWorkdir(sessionB, workdirA.id, userB)
      }).toThrow()

      expect(fx.workdirService.getActiveWorkdir(sessionB, userB)).toBeNull()
    })

    it('prevents user B from reading user A workdir via getById', () => {
      const userA = 'user-a'
      const userB = 'user-b'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)

      expect(fx.workdirStore.getById(workdirA.id, userB)).toBeNull()
    })

    it('prevents user B from listing user A workdirs', () => {
      const userA = 'user-a'
      const userB = 'user-b'

      fx.workdirService.createDefaultWorkdir(userA)
      fx.workdirService.createWorkdir(userA, 'project-x')

      expect(fx.workdirStore.listByUser(userB).length).toBe(0)
      expect(fx.workdirStore.listByUser(userA).length).toBe(2)
    })

    it('prevents user B from soft-deleting user A workdir', () => {
      const userA = 'user-a'
      const userB = 'user-b'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)

      fx.workdirService.softDeleteWorkdir(workdirA.id, userB)

      const stillExists = fx.workdirStore.getById(workdirA.id, userA)
      expect(stillExists).not.toBeNull()
      expect(stillExists?.deletedAt).toBeNull()
    })

    it('file_write to user A workdir is denied when user B uses their own workdir root', () => {
      const userA = 'user-a'
      const userB = 'user-b'
      const sessionB = 'session-b'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      const workdirB = fx.workdirService.createDefaultWorkdir(userB)

      mkdirSync(workdirA.path, { recursive: true })
      mkdirSync(workdirB.path, { recursive: true })

      // User B's workdir root is workdirB; writing to workdirA path is outside
      const decision = checkPermissionDirect(
        'tool:file_write',
        join(workdirA.path, 'intrusion.txt'),
        userB,
        sessionB,
        'write',
        workdirB.path,
        workdirB.id,
      )

      expect(decision.metadata?.workdirAutoAllow).not.toBe(true)
    })
  })

  // ===========================================================================
  // Scenario 5: No approval records for in-workdir file writes
  // ===========================================================================
  describe('Scenario 5: No approval for workdir-scoped file writes', () => {
    it('permission engine auto-allows multiple file_writes — zero approval records', () => {
      const user = 'user-noapproval'
      const session = 'session-noapproval'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      for (let i = 0; i < 3; i++) {
        const decision = checkPermissionDirect(
          'tool:file_write',
          join(workdir.path, `file-${i}.txt`),
          user,
          session,
          'write',
          workdir.path,
          workdir.id,
        )
        expect(decision.allowed).toBe(true)
        expect(decision.metadata?.workdirAutoAllow).toBe(true)
      }

      expect(fx.approvalStore.findPendingBySession(session).length).toBe(0)
    })

    it('permission engine auto-allows file_read — zero approval records', () => {
      const user = 'user-readtest'
      const session = 'session-readtest'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      writeFileSync(join(workdir.path, 'readme.txt'), 'Test content', 'utf-8')

      const decision = checkPermissionDirect(
        'tool:file_read',
        join(workdir.path, 'readme.txt'),
        user,
        session,
        'read',
        workdir.path,
        workdir.id,
      )

      expect(decision.allowed).toBe(true)
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
      expect(fx.approvalStore.findPendingBySession(session).length).toBe(0)
    })

    it('file_read tool handler reads correctly with workDirRoot', async () => {
      const user = 'user-readhandler'
      const session = 'session-readhandler'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      writeFileSync(join(workdir.path, 'data.txt'), 'Hello from workdir', 'utf-8')

      const handler = createMockFileReadTool().handler
      const result = await handler(
        { path: join(workdir.path, 'data.txt') },
        makeToolContext(user, session, workdir.path, workdir.id),
      )

      expect(result.success).toBe(true)
      expect((result.data as { content: string }).content).toBe('Hello from workdir')
    })
  })

  // ===========================================================================
  // Scenario 6: Cross-user write isolation
  // ===========================================================================
  describe('Scenario 6: Cross-user write isolation', () => {
    it('session A workdir selection does not affect session B', () => {
      const user = 'user-isolation'
      const sessionA = 'session-a'
      const sessionB = 'session-b'

      const workdir1 = fx.workdirService.createDefaultWorkdir(user)
      const workdir2 = fx.workdirService.createWorkdir(user, 'other')

      fx.workdirService.setActiveWorkdir(sessionA, workdir1.id, user)
      fx.workdirService.setActiveWorkdir(sessionB, workdir2.id, user)

      expect(fx.workdirService.getActiveWorkdir(sessionA, user)?.id).toBe(workdir1.id)
      expect(fx.workdirService.getActiveWorkdir(sessionB, user)?.id).toBe(workdir2.id)

      fx.workdirService.setActiveWorkdir(sessionA, workdir2.id, user)

      expect(fx.workdirService.getActiveWorkdir(sessionA, user)?.id).toBe(workdir2.id)
      expect(fx.workdirService.getActiveWorkdir(sessionB, user)?.id).toBe(workdir2.id)
    })

    it('file_write outside active workdir is NOT auto-allowed', () => {
      const user = 'user-outside'
      const session = 'session-outside'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      const outsidePath = join(fx.tmpDir, 'outside-workdir.txt')

      const decision = checkPermissionDirect(
        'tool:file_write',
        outsidePath,
        user,
        session,
        'write',
        workdir.path,
        workdir.id,
      )

      expect(decision.metadata?.workdirAutoAllow).not.toBe(true)
    })
  })

  // ===========================================================================
  // Scenario 7: Exec still requires approval even with active workdir
  // ===========================================================================
  describe('Scenario 7: Exec requires approval even with active workdir', () => {
    it('exec permission is NOT auto-allowed even in workdir', () => {
      const user = 'user-exec'
      const session = 'session-exec'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      const decision = checkPermissionDirect(
        'tool:exec',
        join(workdir.path, 'script.sh'),
        user,
        session,
        'execute',
        workdir.path,
        workdir.id,
      )

      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
    })

    it('exec tool through tool executor requires approval', async () => {
      const user = 'user-exec-tool'
      const session = 'session-exec-tool'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      const result = await executeWithWorkdir(
        'exec',
        { command: 'echo hello' },
        user,
        session,
        workdir.path,
        workdir.id,
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')

      const pendingApprovals = fx.approvalStore.findPendingBySession(session)
      expect(pendingApprovals.length).toBe(1)
      expect(pendingApprovals[0].actionType).toBe('tool:exec')
      expect(pendingApprovals[0].status).toBe('pending')
    })

    it('file_write through tool executor requires approval when workDirRoot is absent', async () => {
      const user = 'user-noworkdir'
      const session = 'session-noworkdir'

      const result = await executeWithWorkdir(
        'file_write',
        { path: '/tmp/test.txt', content: 'test' },
        user,
        session,
        // No workDirRoot
      )

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('APPROVAL_REQUIRED')
    })
  })

  // ===========================================================================
  // Scenario 8: Two users, two sessions — full isolation
  // ===========================================================================
  describe('Scenario 8: Two users, two sessions — full isolation', () => {
    it('user A and user B each have independent workdirs and permissions', () => {
      const userA = 'user-a'
      const userB = 'user-b'
      const sessionA = 'session-a'
      const sessionB = 'session-b'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      const workdirB = fx.workdirService.createDefaultWorkdir(userB)

      fx.workdirService.setActiveWorkdir(sessionA, workdirA.id, userA)
      fx.workdirService.setActiveWorkdir(sessionB, workdirB.id, userB)

      mkdirSync(workdirA.path, { recursive: true })
      mkdirSync(workdirB.path, { recursive: true })

      // User A can write to workdir A
      const decisionA = checkPermissionDirect(
        'tool:file_write',
        join(workdirA.path, 'a.txt'),
        userA,
        sessionA,
        'write',
        workdirA.path,
        workdirA.id,
      )
      expect(decisionA.allowed).toBe(true)
      expect(decisionA.metadata?.workdirAutoAllow).toBe(true)

      // User B can write to workdir B
      const decisionB = checkPermissionDirect(
        'tool:file_write',
        join(workdirB.path, 'b.txt'),
        userB,
        sessionB,
        'write',
        workdirB.path,
        workdirB.id,
      )
      expect(decisionB.allowed).toBe(true)
      expect(decisionB.metadata?.workdirAutoAllow).toBe(true)

      // Verify zero approvals for in-workdir writes
      expect(fx.approvalStore.findPendingBySession(sessionA).length).toBe(0)
      expect(fx.approvalStore.findPendingBySession(sessionB).length).toBe(0)

      // User A writing to workdir B path is NOT auto-allowed (outside user A's workdir)
      const decisionCrossA = checkPermissionDirect(
        'tool:file_write',
        join(workdirB.path, 'intrusion.txt'),
        userA,
        sessionA,
        'write',
        workdirA.path,
        workdirA.id,
      )
      expect(decisionCrossA.metadata?.workdirAutoAllow).not.toBe(true)
      // The cross-user attempt falls through to approval flow
      expect(decisionCrossA.status).toBe('requires_approval')

      // Verify store isolation
      expect(fx.workdirStore.listByUser(userA).length).toBe(1)
      expect(fx.workdirStore.listByUser(userB).length).toBe(1)
      expect(fx.workdirStore.listByUser(userA)[0].id).not.toBe(fx.workdirStore.listByUser(userB)[0].id)
    })

    it('user A reads from workdir A, user B reads from workdir B', async () => {
      const userA = 'user-a'
      const userB = 'user-b'
      const sessionA = 'session-a'
      const sessionB = 'session-b'

      const workdirA = fx.workdirService.createDefaultWorkdir(userA)
      const workdirB = fx.workdirService.createDefaultWorkdir(userB)

      fx.workdirService.setActiveWorkdir(sessionA, workdirA.id, userA)
      fx.workdirService.setActiveWorkdir(sessionB, workdirB.id, userB)

      mkdirSync(workdirA.path, { recursive: true })
      mkdirSync(workdirB.path, { recursive: true })

      writeFileSync(join(workdirA.path, 'secret-a.txt'), 'Secret A', 'utf-8')
      writeFileSync(join(workdirB.path, 'secret-b.txt'), 'Secret B', 'utf-8')

      const readHandler = createMockFileReadTool().handler

      const resultA = await readHandler(
        { path: join(workdirA.path, 'secret-a.txt') },
        makeToolContext(userA, sessionA, workdirA.path, workdirA.id),
      )
      expect(resultA.success).toBe(true)
      expect((resultA.data as { content: string }).content).toBe('Secret A')

      const resultB = await readHandler(
        { path: join(workdirB.path, 'secret-b.txt') },
        makeToolContext(userB, sessionB, workdirB.path, workdirB.id),
      )
      expect(resultB.success).toBe(true)
      expect((resultB.data as { content: string }).content).toBe('Secret B')

      expect(fx.approvalStore.findPendingBySession(sessionA).length).toBe(0)
      expect(fx.approvalStore.findPendingBySession(sessionB).length).toBe(0)
    })
  })

  // ===========================================================================
  // Scenario 9: Deleted workdir cannot be selected
  // ===========================================================================
  describe('Scenario 9: Deleted workdir isolation', () => {
    it('cannot set a soft-deleted workdir as active', () => {
      const user = 'user-delete-test'
      const session = 'session-delete-test'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      mkdirSync(workdir.path, { recursive: true })

      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      expect(fx.workdirService.getActiveWorkdir(session, user)?.id).toBe(workdir.id)

      fx.workdirService.softDeleteWorkdir(workdir.id, user)

      expect(fx.workdirService.getActiveWorkdir(session, user)).toBeNull()
    })

    it('cannot select a soft-deleted workdir', () => {
      const user = 'user-delete-select'
      const session = 'session-delete-select'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.softDeleteWorkdir(workdir.id, user)

      expect(() => {
        fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      }).toThrow()
    })

    it('permission auto-allow does not apply when workDirRoot is absent', () => {
      const user = 'user-delete-perm'
      const session = 'session-delete-perm'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      // Before deletion: auto-allowed
      const decisionBefore = checkPermissionDirect(
        'tool:file_write',
        join(workdir.path, 'test.txt'),
        user,
        session,
        'write',
        workdir.path,
        workdir.id,
      )
      expect(decisionBefore.allowed).toBe(true)
      expect(decisionBefore.metadata?.workdirAutoAllow).toBe(true)

      // After deletion: no workDirRoot → no auto-allow
      const decisionAfter = checkPermissionDirect(
        'tool:file_write',
        join(workdir.path, 'test.txt'),
        user,
        session,
        'write',
      )
      expect(decisionAfter.allowed).toBe(false)
      expect(decisionAfter.status).toBe('requires_approval')
    })
  })

  // ===========================================================================
  // Scenario 10: Audit trail for workdir auto-allow
  // ===========================================================================
  describe('Scenario 10: Audit trail', () => {
    it('emits permission_granted audit event for workdir auto-allow', () => {
      const user = 'user-audit'
      const session = 'session-audit'

      const workdir = fx.workdirService.createDefaultWorkdir(user)
      fx.workdirService.setActiveWorkdir(session, workdir.id, user)
      mkdirSync(workdir.path, { recursive: true })

      checkPermissionDirect(
        'tool:file_write',
        join(workdir.path, 'audit-test.txt'),
        user,
        session,
        'write',
        workdir.path,
        workdir.id,
      )

      const events = fx.eventStore.query({ sessionId: session })
      const permissionEvents = events.filter(
        (e) => (e as { eventType: string }).eventType === 'permission_granted',
      )
      expect(permissionEvents.length).toBeGreaterThan(0)

      const workdirEvent = permissionEvents.find(
        (e) => (e as { payload?: { reason?: string } }).payload?.reason?.includes('Workdir-scoped auto-allow'),
      )
      expect(workdirEvent).toBeDefined()
    })
  })
})
