import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { createApprovalStore, type ApprovalStore, APPROVAL_STATES } from '../../../src/storage/approval-store.js'
import { createPermissionGrantStore, type PermissionGrantStore } from '../../../src/storage/permission-grant-store.js'
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js'
import { createPermissionEngine, type PermissionEngine } from '../../../src/permissions/permission-engine.js'
import { createApprovalHandler, type ApprovalHandler } from '../../../src/permissions/approval-handler.js'
import {
  createPermissionContext,
  type PermissionCheckRequest,
  createAllowedDecision,
  createDeniedDecision,
} from '../../../src/permissions/types.js'

const STORE_MIGRATIONS = [
  {
    version: 1,
    name: 'create_approval_requests_table',
    up: `
      CREATE TABLE approval_requests (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL,
        status TEXT NOT NULL, risk_level TEXT, scope TEXT, scope_type TEXT,
        scope_ref TEXT, approval_code TEXT, action_type TEXT NOT NULL,
        resource TEXT, justification TEXT, requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL, expires_at TEXT, responded_at TEXT,
        response_by TEXT, response_reason TEXT, idempotency_key TEXT UNIQUE,
        metadata TEXT, source_context TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_approval_user_status ON approval_requests(user_id, status);
      CREATE INDEX idx_approval_session_status ON approval_requests(session_id, status);
    `,
    down: 'DROP TABLE IF EXISTS approval_requests;',
  },
  {
    version: 2,
    name: 'create_permission_grants_table',
    up: `
      CREATE TABLE permission_grants (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, scope TEXT NOT NULL,
        action TEXT NOT NULL, resource_pattern TEXT, conditions TEXT,
        risk_level_max TEXT, expires_at TEXT, source_context TEXT,
        revoked_at TEXT, revoked_reason TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_grant_user ON permission_grants(user_id);
      CREATE INDEX idx_grant_scope ON permission_grants(scope);
    `,
    down: 'DROP TABLE IF EXISTS permission_grants;',
  },
  {
    version: 3,
    name: 'create_events_table',
    up: `
      CREATE TABLE events (
        event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL,
        source_module TEXT NOT NULL, user_id TEXT, session_id TEXT,
        correlation_id TEXT, causation_id TEXT, idempotency_key TEXT,
        planner_run_id TEXT, plan_id TEXT, run_id TEXT, workflow_run_id TEXT,
        workflow_step_run_id TEXT, background_run_id TEXT, subagent_run_id TEXT,
        tool_call_id TEXT, approval_id TEXT, wait_condition_id TEXT,
        artifact_id TEXT, memory_id TEXT, payload TEXT NOT NULL,
        sensitivity TEXT NOT NULL, retention_class TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_events_session ON events(session_id);
    `,
    down: 'DROP TABLE IF EXISTS events;',
  },
]

describe('Approval rejection blocks side effects', () => {
  let connection: ConnectionManager
  let migrationRunner: MigrationRunner
  let approvalStore: ApprovalStore
  let grantStore: PermissionGrantStore
  let eventStore: EventStore
  let permissionEngine: PermissionEngine
  let approvalHandler: ApprovalHandler

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(STORE_MIGRATIONS)

    approvalStore = createApprovalStore(connection)
    grantStore = createPermissionGrantStore(connection)
    eventStore = createEventStore(connection)
    permissionEngine = createPermissionEngine({ approvalStore, grantStore, eventStore })
    approvalHandler = createApprovalHandler({ approvalStore, grantStore, eventStore })
  })

  afterEach(() => {
    connection?.close()
  })

  it('write operation triggers approval request with allowed=false', () => {
    const ctx = createPermissionContext('u1', 's1', 'ask_on_write')
    const req: PermissionCheckRequest = {
      context: ctx,
      actionType: 'artifact_create',
      operationType: 'write',
      resource: '/artifact/001',
    }

    const decision = permissionEngine.checkPermission(req)
    expect(decision.status).toBe('requires_approval')
    expect(decision.allowed).toBe(false)
    expect(decision.requestId).toBeDefined()
    expect(decision.approvalRequest).toBeDefined()
    expect(decision.approvalRequest!.status).toBe('pending')
  })

  it('rejected approval is persisted with REJECTED status', () => {
    const ctx = createPermissionContext('u_reject', 's_reject', 'ask_on_write')
    const req: PermissionCheckRequest = {
      context: ctx,
      actionType: 'artifact_create',
      operationType: 'write',
      resource: '/artifact/reject-test',
    }

    const decision = permissionEngine.checkPermission(req)
    const approvalId = decision.requestId!

    const result = approvalHandler.processResponse({
      requestId: approvalId,
      responseType: 'reject',
      respondedBy: 'admin',
      respondedAt: new Date().toISOString(),
      reason: 'Not authorized for this resource',
    })

    expect(result.success).toBe(true)
    expect(result.approved).toBe(false)

    const updated = approvalStore.getById(approvalId)
    expect(updated).toBeDefined()
    expect(updated!.status).toBe(APPROVAL_STATES.REJECTED)
    expect(updated!.responseReason).toContain('Not authorized')
  })

  it('rejected approval generates an audit event', () => {
    const ctx = createPermissionContext('u_audit', 's_audit', 'ask_on_write')
    const req: PermissionCheckRequest = {
      context: ctx,
      actionType: 'artifact_create',
      operationType: 'write',
      resource: '/artifact/audit-test',
    }

    const decision = permissionEngine.checkPermission(req)

    approvalHandler.processResponse({
      requestId: decision.requestId!,
      responseType: 'reject',
      respondedBy: 'admin',
      respondedAt: new Date().toISOString(),
      reason: 'Blocked by policy',
    })

    const rejectionEvents = eventStore.query({
      userId: 'u_audit',
      eventType: 'approval_responded',
    })

    expect(rejectionEvents.length).toBeGreaterThan(0)
    const rejection = rejectionEvents[0]
    expect(rejection.payload.decision).toBe('rejected')
  })

  it('rejected approval does NOT create a grant', () => {
    const ctx = createPermissionContext('u_nogrant', 's_nogrant', 'ask_on_write')
    const req: PermissionCheckRequest = {
      context: ctx,
      actionType: 'artifact_create',
      operationType: 'write',
      resource: '/artifact/no-grant',
    }

    const decision = permissionEngine.checkPermission(req)

    const result = approvalHandler.processResponse({
      requestId: decision.requestId!,
      responseType: 'reject',
      respondedBy: 'admin',
      respondedAt: new Date().toISOString(),
      reason: 'Denied',
    })

    expect(result.grant).toBeUndefined()

    const userId = 'u_nogrant'
    const allGrants = grantStore.findActiveByUserAndScope(userId, 'default')
    expect(allGrants.length).toBe(0)
  })

  it('subsequent permission check after rejection still requires approval', () => {
    const userId = 'u_again'
    const sessionId = 's_again'

    const ctx = createPermissionContext(userId, sessionId, 'ask_on_write')
    const req: PermissionCheckRequest = {
      context: ctx,
      actionType: 'artifact_create',
      operationType: 'write',
      resource: '/artifact/again',
    }

    const first = permissionEngine.checkPermission(req)
    approvalHandler.processResponse({
      requestId: first.requestId!,
      responseType: 'reject',
      respondedBy: 'admin',
      respondedAt: new Date().toISOString(),
      reason: 'Not allowed',
    })

    const second = permissionEngine.checkPermission(req)
    expect(second.status).toBe('requires_approval')
    expect(second.allowed).toBe(false)
  })

  it('approved approval with approve_always creates a grant for future use', () => {
    const userId = 'u_always'
    const sessionId = 's_always'

    const ctx = createPermissionContext(userId, sessionId, 'ask_on_write')
    const req: PermissionCheckRequest = {
      context: ctx,
      actionType: 'artifact_create',
      operationType: 'write',
      resource: '/artifact/always-test',
    }

    const decision = permissionEngine.checkPermission(req)

    const result = approvalHandler.processResponse({
      requestId: decision.requestId!,
      responseType: 'approve_always',
      respondedBy: 'admin',
      respondedAt: new Date().toISOString(),
      grantScope: 'session',
      grantDuration: 3600000,
    })

    expect(result.success).toBe(true)
    expect(result.approved).toBe(true)
    expect(result.grant).toBeDefined()

    const grants = grantStore.findActiveByUserAndScope(userId, 'session')
    expect(grants.length).toBe(1)
    expect(grants[0].action).toBe('artifact_create')
  })

  it('denied decision uses createDeniedDecision pattern', () => {
    const denied = createDeniedDecision('Blocked for security', 'policy-1', 'audit-high')
    expect(denied.status).toBe('denied')
    expect(denied.allowed).toBe(false)
    expect(denied.reason).toContain('security')
    expect(denied.policyRef).toBe('policy-1')
    expect(denied.auditLabel).toBe('audit-high')
  })

  it('allowed decision uses createAllowedDecision pattern', () => {
    const allowed = createAllowedDecision('Safe operation')
    expect(allowed.status).toBe('allowed')
    expect(allowed.allowed).toBe(true)
    expect(allowed.reason).toBe('Safe operation')
  })

  it('hard_deny mode blocks all operations including reads', () => {
    const ctx = createPermissionContext('u_hard', 's_hard', 'hard_deny')
    const readReq: PermissionCheckRequest = {
      context: ctx,
      actionType: 'file_read',
      operationType: 'read',
      resource: '/data/file.txt',
    }
    const writeReq: PermissionCheckRequest = {
      context: ctx,
      actionType: 'artifact_create',
      operationType: 'write',
      resource: '/artifact/001',
    }

    expect(permissionEngine.checkPermission(readReq).allowed).toBe(false)
    expect(permissionEngine.checkPermission(writeReq).allowed).toBe(false)
    expect(permissionEngine.checkPermission(readReq).status).toBe('denied')
    expect(permissionEngine.checkPermission(writeReq).status).toBe('denied')
  })
})
