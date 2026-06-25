import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  validateExecParams,
  MAX_EXEC_TIMEOUT_MS,
  MAX_EXEC_OUTPUT_CHARS,
} from '../../src/tools/builtins/command-safety.js'
import { validatePathSafety } from '../../src/tools/builtins/safe-paths.js'
import { createConnectionManager, type ConnectionManager } from '../../src/storage/connection.js'
import { createMigrationRunner } from '../../src/storage/migrations.js'
import { createApprovalStore, type ApprovalStore } from '../../src/storage/approval-store.js'
import { createPermissionGrantStore, type PermissionGrantStore } from '../../src/storage/permission-grant-store.js'
import { createEventStore, type EventStore } from '../../src/storage/event-store.js'
import { createPermissionEngine, type PermissionEngine } from '../../src/permissions/permission-engine.js'
import { createPermissionContext, type PermissionCheckRequest } from '../../src/permissions/types.js'

interface PermissionCheckResult {
  allowed: boolean
  requiresApproval: boolean
  reason?: string
}

type OperationType = 'file_read' | 'file_write' | 'exec' | 'code_execution'

function checkWorkdirPermission(
  operation: OperationType,
  targetPath: string,
  workdirRoot: string,
  _selectedWorkdir?: string,
): PermissionCheckResult {
  if (operation === 'exec' || operation === 'code_execution') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: 'Execution operations always require approval',
    }
  }

  const pathResult = validatePathSafety(targetPath, workdirRoot)
  if (!pathResult.safe) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Path rejected: ${pathResult.error?.code}`,
    }
  }

  return {
    allowed: true,
    requiresApproval: false,
  }
}

const DB_MIGRATIONS = [
  {
    version: 1,
    name: 'create_approval_requests_table',
    up: `
      CREATE TABLE approval_requests (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        risk_level TEXT,
        scope TEXT,
        scope_type TEXT,
        scope_ref TEXT,
        approval_code TEXT,
        action_type TEXT NOT NULL,
        resource TEXT,
        justification TEXT,
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        expires_at TEXT,
        responded_at TEXT,
        response_by TEXT,
        response_reason TEXT,
        idempotency_key TEXT UNIQUE,
        metadata TEXT,
        source_context TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_approval_user_status ON approval_requests(user_id, status);
      CREATE INDEX idx_approval_session_status ON approval_requests(session_id, status);
      CREATE INDEX idx_approval_expires ON approval_requests(expires_at);
    `,
    down: `DROP TABLE IF EXISTS approval_requests;`,
  },
  {
    version: 2,
    name: 'create_permission_grants_table',
    up: `
      CREATE TABLE permission_grants (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_pattern TEXT,
        conditions TEXT,
        risk_level_max TEXT,
        expires_at TEXT,
        source_context TEXT,
        revoked_at TEXT,
        revoked_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_grant_user ON permission_grants(user_id);
      CREATE INDEX idx_grant_scope ON permission_grants(scope);
    `,
    down: `DROP TABLE IF EXISTS permission_grants;`,
  },
  {
    version: 3,
    name: 'create_events_table',
    up: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source_module TEXT NOT NULL,
        user_id TEXT,
        session_id TEXT,
        correlation_id TEXT,
        causation_id TEXT,
        idempotency_key TEXT,
        planner_run_id TEXT,
        plan_id TEXT,
        run_id TEXT,
        workflow_run_id TEXT,
        workflow_step_run_id TEXT,
        background_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        approval_id TEXT,
        wait_condition_id TEXT,
        artifact_id TEXT,
        memory_id TEXT,
        payload TEXT NOT NULL,
        sensitivity TEXT NOT NULL,
        retention_class TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_events_session ON events(session_id);
      CREATE INDEX idx_events_user ON events(user_id);
      CREATE INDEX idx_events_type ON events(event_type);
    `,
    down: `DROP TABLE IF EXISTS events;`,
  },
]

describe('Workdir Permission Security', () => {
  let testDir: string
  let workdirRoot: string

  beforeEach(() => {
    testDir = join(tmpdir(), `workdir-permission-test-${Date.now()}`)
    workdirRoot = join(testDir, 'data', 'workdirs')
    mkdirSync(workdirRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('No-approval file writes in workdir', () => {
    it('should allow file write without approval when path is within workdir', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const result = checkWorkdirPermission('file_write', join(userDir, 'output.txt'), workdirRoot)
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(false)
    })

    it('should allow file read without approval when path is within workdir', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'input.txt'), 'data')

      const result = checkWorkdirPermission('file_read', join(userDir, 'input.txt'), workdirRoot)
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(false)
    })

    it('should reject file write to path outside workspace', () => {
      const result = checkWorkdirPermission('file_write', '/etc/passwd', workdirRoot)
      expect(result.allowed).toBe(false)
      expect(result.requiresApproval).toBe(false)
      expect(result.reason).toContain('OUTSIDE_WORKSPACE')
    })

    it('should reject file write to path with traversal', () => {
      const result = checkWorkdirPermission('file_write', '../escape.txt', workdirRoot)
      expect(result.allowed).toBe(false)
      expect(result.requiresApproval).toBe(false)
      expect(result.reason).toContain('PATH_ESCAPE')
    })

    it('should reject file write to sensitive files even in workdir', () => {
      const result = checkWorkdirPermission('file_write', '.env', workdirRoot)
      expect(result.allowed).toBe(false)
      expect(result.requiresApproval).toBe(false)
      expect(result.reason).toContain('SENSITIVE_FILE')
    })
  })

  describe('Exec approval preserved in workdir', () => {
    it('should require approval for exec even within workdir', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const result = checkWorkdirPermission('exec', join(userDir, 'script.sh'), workdirRoot)
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(true)
    })

    it('should require approval for code_execution even within workdir', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const result = checkWorkdirPermission('code_execution', join(userDir, 'code.ts'), workdirRoot)
      expect(result.allowed).toBe(true)
      expect(result.requiresApproval).toBe(true)
    })

    it('should require approval for exec outside workdir', () => {
      const result = checkWorkdirPermission('exec', '/tmp/script.sh', workdirRoot)
      expect(result.requiresApproval).toBe(true)
    })
  })

  describe('Exec safety with workdir context', () => {
    it('should validate exec params with workdir within workspace', () => {
      const result = validateExecParams({ command: 'ls -la', workdir: '.' })
      expect(result.valid).toBe(true)
      expect(result.normalized).toBeDefined()
    })

    it('should reject exec with workdir outside workspace', () => {
      const result = validateExecParams({ command: 'ls', workdir: '/tmp' })
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_OUTSIDE_WORKSPACE')
    })

    it('should reject exec with workdir traversal', () => {
      const result = validateExecParams({ command: 'ls', workdir: '../escape' })
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('WORKDIR_OUTSIDE_WORKSPACE')
    })

    it('should still reject dangerous commands regardless of workdir', () => {
      const result = validateExecParams({ command: 'rm -rf /', workdir: '.' })
      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('DANGEROUS_COMMAND')
    })

    it('should still enforce timeout limits regardless of workdir', () => {
      const result = validateExecParams({ command: 'ls', workdir: '.', timeoutMs: MAX_EXEC_TIMEOUT_MS + 10000 })
      expect(result.valid).toBe(true)
      expect(result.normalized?.timeoutMs).toBe(MAX_EXEC_TIMEOUT_MS)
    })

    it('should still enforce output limits regardless of workdir', () => {
      const result = validateExecParams({
        command: 'ls',
        workdir: '.',
        maxOutputChars: MAX_EXEC_OUTPUT_CHARS + 1000,
      })
      expect(result.valid).toBe(true)
      expect(result.normalized?.maxOutputChars).toBe(MAX_EXEC_OUTPUT_CHARS)
    })
  })

  describe('Operation type matrix', () => {
    it('file_read in workdir: no approval', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'data.json'), '{}')

      const result = checkWorkdirPermission('file_read', join(userDir, 'data.json'), workdirRoot)
      expect(result.requiresApproval).toBe(false)
    })

    it('file_write in workdir: no approval', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const result = checkWorkdirPermission('file_write', join(userDir, 'output.txt'), workdirRoot)
      expect(result.requiresApproval).toBe(false)
    })

    it('exec in workdir: requires approval', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const result = checkWorkdirPermission('exec', join(userDir, 'any'), workdirRoot)
      expect(result.requiresApproval).toBe(true)
    })

    it('code_execution in workdir: requires approval', () => {
      const userDir = join(workdirRoot, 'user-123')
      mkdirSync(userDir, { recursive: true })

      const result = checkWorkdirPermission('code_execution', join(userDir, 'any'), workdirRoot)
      expect(result.requiresApproval).toBe(true)
    })
  })

  describe('PermissionEngine workdir carve-out', () => {
    let connection: ConnectionManager
    let approvalStore: ApprovalStore
    let grantStore: PermissionGrantStore
    let eventStore: EventStore
    let permissionEngine: PermissionEngine

    beforeEach(() => {
      connection = createConnectionManager(':memory:')
      connection.open()
      const migrations = createMigrationRunner(connection)
      migrations.init()
      migrations.apply(DB_MIGRATIONS)

      approvalStore = createApprovalStore(connection)
      grantStore = createPermissionGrantStore(connection)
      eventStore = createEventStore(connection)
      permissionEngine = createPermissionEngine({ approvalStore, grantStore, eventStore })
    })

    afterEach(() => {
      connection?.close()
    })

    it('should auto-allow file_write in workdir without approval', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'test.txt'), 'content')

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_write',
        resource: join(userDir, 'output.txt'),
        operationType: 'write',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(true)
      expect(decision.status).toBe('allowed')
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
      expect(decision.metadata?.workDirRoot).toBe(workdirRoot)
      expect(decision.metadata?.workDirId).toBe('workdir-456')
    })

    it('should auto-allow file_read in workdir without approval', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'test.txt'), 'content')

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_read',
        resource: join(userDir, 'test.txt'),
        operationType: 'read',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(true)
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
    })

    it('should auto-allow file_edit in workdir without approval', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'test.txt'), 'content')

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_edit',
        resource: join(userDir, 'test.txt'),
        operationType: 'write',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(true)
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
    })

    it('should auto-allow file_apply_patch in workdir without approval', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'test.txt'), 'content')

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_apply_patch',
        resource: join(userDir, 'test.txt'),
        operationType: 'write',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(true)
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
    })

    it('should auto-allow file_glob in workdir without approval', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_glob',
        resource: join(userDir, '*.txt'),
        operationType: 'read',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(true)
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
    })

    it('should auto-allow file_grep in workdir without approval', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_grep',
        resource: join(userDir, 'pattern'),
        operationType: 'read',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(true)
      expect(decision.metadata?.workdirAutoAllow).toBe(true)
    })

    it('should NOT auto-allow file_write outside workdir', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_write',
        resource: '/tmp/outside-workdir.txt',
        operationType: 'write',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
      expect(decision.metadata?.workdirAutoAllow).toBeUndefined()
    })

    it('should NOT auto-allow exec tools even in workdir', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:exec',
        resource: join(userDir, 'script.sh'),
        operationType: 'execute',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
      expect(decision.metadata?.workdirAutoAllow).toBeUndefined()
    })

    it('should NOT auto-allow bash tools even in workdir', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:bash',
        resource: join(userDir, 'script.sh'),
        operationType: 'execute',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
    })

    it('should NOT auto-allow code_execution tools even in workdir', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:code_execution',
        resource: join(userDir, 'code.ts'),
        operationType: 'execute',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
    })

    it('should NOT auto-allow connector/admin/send tools in workdir', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')

      for (const toolId of ['connector_send', 'admin_config', 'manage_users']) {
        const request: PermissionCheckRequest = {
          context,
          actionType: `tool:${toolId}`,
          resource: join(userDir, 'any'),
          operationType: 'write',
          workDirRoot: workdirRoot,
          workDirId: 'workdir-456',
        }

        const decision = permissionEngine.checkPermission(request)
        expect(decision.allowed).toBe(false)
        expect(decision.metadata?.workdirAutoAllow).toBeUndefined()
      }
    })

    it('should NOT auto-allow when workDirRoot is not set', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_write',
        resource: '/tmp/file.txt',
        operationType: 'write',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
      expect(decision.metadata?.workdirAutoAllow).toBeUndefined()
    })

    it('should still deny in hard_deny mode even with workDirRoot', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'hard_deny')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_write',
        resource: join(userDir, 'output.txt'),
        operationType: 'write',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('denied')
      expect(decision.reason).toContain('hard_deny')
    })

    it('should deny high-risk ops in restricted mode even with workDirRoot', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'restricted')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_write',
        resource: join(userDir, 'output.txt'),
        operationType: 'write',
        riskLevel: 'high',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('denied')
      expect(decision.reason).toContain('Restricted')
    })

    it('should emit audit event for workdir auto-allow', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })
      writeFileSync(join(userDir, 'test.txt'), 'content')

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_write',
        resource: join(userDir, 'output.txt'),
        operationType: 'write',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      permissionEngine.checkPermission(request)

      const events = eventStore.query({ userId: 'user_123', sourceModule: 'permission' })
      expect(events.length).toBeGreaterThan(0)
      const lastEvent = events[events.length - 1]
      expect(lastEvent.eventType).toBe('permission_granted')
      const payload = typeof lastEvent.payload === 'string' ? JSON.parse(lastEvent.payload) : lastEvent.payload
      expect(payload.reason).toContain('Workdir-scoped auto-allow')
    })

    it('should NOT auto-allow delete operations in workdir', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_delete',
        resource: join(userDir, 'test.txt'),
        operationType: 'delete',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
      expect(decision.metadata?.workdirAutoAllow).toBeUndefined()
    })

    it('should NOT auto-allow file_write outside workdir root (path escape)', () => {
      const userDir = join(workdirRoot, 'user-123', 'workdir-456')
      mkdirSync(userDir, { recursive: true })

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write')
      const request: PermissionCheckRequest = {
        context,
        actionType: 'tool:file_write',
        resource: join(workdirRoot, '..', 'escape.txt'),
        operationType: 'write',
        workDirRoot: workdirRoot,
        workDirId: 'workdir-456',
      }

      const decision = permissionEngine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
      expect(decision.metadata?.workdirAutoAllow).toBeUndefined()
    })
  })
})
