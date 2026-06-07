import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import {
  createApprovalStore,
  type ApprovalStore,
  type CreateApprovalRequest,
  APPROVAL_STATES,
} from '../../../src/storage/approval-store.js'
import {
  createPermissionGrantStore,
  type PermissionGrantStore,
  type CreatePermissionGrant,
} from '../../../src/storage/permission-grant-store.js'
import {
  createTriggerStore,
  type TriggerStore,
  type CreateTriggerRegistration,
  type TriggerStatus,
} from '../../../src/storage/trigger-store.js'
import {
  createWaitConditionStore,
  type WaitConditionStore,
  type CreateWaitCondition,
  WAIT_CONDITION_STATES,
} from '../../../src/storage/wait-condition-store.js'

describe('Approval and Trigger Stores', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let approvalStore: ApprovalStore
  let permissionGrantStore: PermissionGrantStore
  let triggerStore: TriggerStore
  let waitConditionStore: WaitConditionStore

  beforeEach(async () => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()

    // Create tables using migrations
    const storeMigrations = [
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
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_approval_user_status ON approval_requests(user_id, status);
          CREATE INDEX idx_approval_session_status ON approval_requests(session_id, status);
          CREATE INDEX idx_approval_expires ON approval_requests(expires_at);
          CREATE INDEX idx_approval_idempotency ON approval_requests(idempotency_key);
        `,
        down: `
          DROP INDEX IF EXISTS idx_approval_user_status;
          DROP INDEX IF EXISTS idx_approval_session_status;
          DROP INDEX IF EXISTS idx_approval_expires;
          DROP INDEX IF EXISTS idx_approval_idempotency;
          DROP TABLE IF EXISTS approval_requests;
        `,
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
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_grant_user ON permission_grants(user_id);
          CREATE INDEX idx_grant_scope ON permission_grants(scope);
          CREATE INDEX idx_grant_expires ON permission_grants(expires_at);
        `,
        down: `
          DROP INDEX IF EXISTS idx_grant_user;
          DROP INDEX IF EXISTS idx_grant_scope;
          DROP INDEX IF EXISTS idx_grant_expires;
          DROP TABLE IF EXISTS permission_grants;
        `,
      },
      {
        version: 3,
        name: 'create_trigger_registrations_table',
        up: `
          CREATE TABLE trigger_registrations (
            id TEXT PRIMARY KEY,
            trigger_type TEXT NOT NULL,
            condition_type TEXT NOT NULL,
            condition_pattern TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            status TEXT NOT NULL,
            priority INTEGER DEFAULT 0,
            max_triggers INTEGER,
            trigger_count INTEGER DEFAULT 0,
            expires_at TEXT,
            metadata TEXT,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_trigger_target ON trigger_registrations(target_type, target_ref);
          CREATE INDEX idx_trigger_status ON trigger_registrations(status);
          CREATE INDEX idx_trigger_expires ON trigger_registrations(expires_at);
        `,
        down: `
          DROP INDEX IF EXISTS idx_trigger_target;
          DROP INDEX IF EXISTS idx_trigger_status;
          DROP INDEX IF EXISTS idx_trigger_expires;
          DROP TABLE IF EXISTS trigger_registrations;
        `,
      },
      {
        version: 4,
        name: 'create_wait_conditions_table',
        up: `
          CREATE TABLE wait_conditions (
            id TEXT PRIMARY KEY,
            wait_type TEXT NOT NULL,
            condition_pattern TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            status TEXT NOT NULL,
            priority INTEGER DEFAULT 0,
            timeout_at TEXT,
            satisfied_at TEXT,
            satisfied_by TEXT,
            result_data TEXT,
            metadata TEXT,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_wait_target ON wait_conditions(target_type, target_ref);
          CREATE INDEX idx_wait_status ON wait_conditions(status);
          CREATE INDEX idx_wait_timeout ON wait_conditions(timeout_at);
        `,
        down: `
          DROP INDEX IF EXISTS idx_wait_target;
          DROP INDEX IF EXISTS idx_wait_status;
          DROP INDEX IF EXISTS idx_wait_timeout;
          DROP TABLE IF EXISTS wait_conditions;
        `,
      },
    ]

    migrations.apply(storeMigrations)

    // Initialize stores
    approvalStore = createApprovalStore(connection)
    permissionGrantStore = createPermissionGrantStore(connection)
    triggerStore = createTriggerStore(connection)
    waitConditionStore = createWaitConditionStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('ApprovalRequest Store', () => {
    const createTestRequest = (overrides: Partial<CreateApprovalRequest> = {}): CreateApprovalRequest => ({
      id: `appr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      userId: 'user_123',
      sessionId: 'sess_456',
      status: APPROVAL_STATES.PENDING,
      actionType: 'tool_execution',
      requestedBy: 'system',
      requestedAt: new Date().toISOString(),
      ...overrides,
    })

    describe('create', () => {
      it('should create an approval request', () => {
        const request = createTestRequest()
        const created = approvalStore.create(request)

        expect(created.id).toBe(request.id)
        expect(created.userId).toBe(request.userId)
        expect(created.status).toBe(APPROVAL_STATES.PENDING)
        expect(created.createdAt).toBeDefined()
        expect(created.updatedAt).toBeDefined()
      })

      it('should enforce idempotency key uniqueness', () => {
        const idempotencyKey = 'unique-key-123'
        const request1 = createTestRequest({ idempotencyKey })
        approvalStore.create(request1)

        const request2 = createTestRequest({
          id: `appr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          idempotencyKey,
        })

        expect(() => approvalStore.create(request2)).toThrow()
      })
    })

    describe('getById', () => {
      it('should retrieve approval request by id', () => {
        const request = createTestRequest()
        approvalStore.create(request)

        const retrieved = approvalStore.getById(request.id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.id).toBe(request.id)
      })

      it('should return null for non-existent id', () => {
        const retrieved = approvalStore.getById('non_existent')
        expect(retrieved).toBeNull()
      })
    })

    describe('update', () => {
      it('should update approval request status', () => {
        const request = createTestRequest()
        approvalStore.create(request)

        const updated = approvalStore.update(request.id, {
          status: APPROVAL_STATES.APPROVED,
          respondedAt: new Date().toISOString(),
          responseBy: 'admin_user',
        })

        expect(updated.status).toBe(APPROVAL_STATES.APPROVED)
        expect(updated.respondedAt).toBeDefined()
        expect(updated.responseBy).toBe('admin_user')
        expect(updated.updatedAt).toBeDefined()
      })
    })

    describe('findPendingByUser', () => {
      it('should find pending approvals by user', () => {
        const userId = 'user_pending_test'
        approvalStore.create(createTestRequest({ userId, status: APPROVAL_STATES.PENDING }))
        approvalStore.create(createTestRequest({ userId, status: APPROVAL_STATES.APPROVED }))
        approvalStore.create(createTestRequest({ userId: 'other_user', status: APPROVAL_STATES.PENDING }))

        const pending = approvalStore.findPendingByUser(userId)
        expect(pending.length).toBe(1)
        expect(pending[0].userId).toBe(userId)
        expect(pending[0].status).toBe(APPROVAL_STATES.PENDING)
      })
    })

    describe('findPendingBySession', () => {
      it('should find pending approvals by session', () => {
        const sessionId = 'sess_pending_test'
        approvalStore.create(createTestRequest({ sessionId, status: APPROVAL_STATES.PENDING }))
        approvalStore.create(createTestRequest({ sessionId, status: APPROVAL_STATES.REJECTED }))
        approvalStore.create(createTestRequest({ sessionId: 'other_session', status: APPROVAL_STATES.PENDING }))

        const pending = approvalStore.findPendingBySession(sessionId)
        expect(pending.length).toBe(1)
        expect(pending[0].sessionId).toBe(sessionId)
        expect(pending[0].status).toBe(APPROVAL_STATES.PENDING)
      })
    })

    describe('findExpired', () => {
      it('should find expired approvals', () => {
        const pastDate = new Date(Date.now() - 86400000).toISOString() // Yesterday
        const futureDate = new Date(Date.now() + 86400000).toISOString() // Tomorrow

        approvalStore.create(createTestRequest({ expiresAt: pastDate, status: APPROVAL_STATES.PENDING }))
        approvalStore.create(createTestRequest({ expiresAt: futureDate, status: APPROVAL_STATES.PENDING }))

        const expired = approvalStore.findExpired(new Date().toISOString())
        expect(expired.length).toBe(1)
        expect(expired[0].expiresAt).toBe(pastDate)
      })
    })

    describe('delete', () => {
      it('should delete approval request', () => {
        const request = createTestRequest()
        approvalStore.create(request)

        approvalStore.delete(request.id)

        const retrieved = approvalStore.getById(request.id)
        expect(retrieved).toBeNull()
      })
    })
  })

  describe('PermissionGrant Store', () => {
    const createTestGrant = (overrides: Partial<CreatePermissionGrant> = {}): CreatePermissionGrant => ({
      id: `grant_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      userId: 'user_123',
      scope: 'project_alpha',
      action: 'read',
      ...overrides,
    })

    describe('create', () => {
      it('should create a permission grant', () => {
        const grant = createTestGrant()
        const created = permissionGrantStore.create(grant)

        expect(created.id).toBe(grant.id)
        expect(created.userId).toBe(grant.userId)
        expect(created.scope).toBe(grant.scope)
        expect(created.createdAt).toBeDefined()
      })
    })

    describe('getById', () => {
      it('should retrieve grant by id', () => {
        const grant = createTestGrant()
        permissionGrantStore.create(grant)

        const retrieved = permissionGrantStore.getById(grant.id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.id).toBe(grant.id)
      })
    })

    describe('findByUser', () => {
      it('should find grants by user', () => {
        const userId = 'user_grant_test'
        permissionGrantStore.create(createTestGrant({ userId }))
        permissionGrantStore.create(createTestGrant({ userId }))
        permissionGrantStore.create(createTestGrant({ userId: 'other_user' }))

        const grants = permissionGrantStore.findByUser(userId)
        expect(grants.length).toBe(2)
      })
    })

    describe('findActiveByUserAndScope', () => {
      it('should find active grants by user and scope', () => {
        const userId = 'user_active_test'
        const scope = 'test_scope'
        const pastDate = new Date(Date.now() - 86400000).toISOString()

        permissionGrantStore.create(createTestGrant({ userId, scope }))
        permissionGrantStore.create(createTestGrant({ userId, scope, expiresAt: pastDate }))
        permissionGrantStore.create(createTestGrant({ userId, scope: 'other_scope' }))

        const active = permissionGrantStore.findActiveByUserAndScope(userId, scope)
        expect(active.length).toBe(1)
      })
    })

    describe('findExpired', () => {
      it('should find expired grants', () => {
        const pastDate = new Date(Date.now() - 86400000).toISOString()
        const futureDate = new Date(Date.now() + 86400000).toISOString()

        permissionGrantStore.create(createTestGrant({ expiresAt: pastDate }))
        permissionGrantStore.create(createTestGrant({ expiresAt: futureDate }))

        const expired = permissionGrantStore.findExpired(new Date().toISOString())
        expect(expired.length).toBe(1)
      })
    })

    describe('revoke', () => {
      it('should revoke a grant', () => {
        const grant = createTestGrant()
        permissionGrantStore.create(grant)

        const revoked = permissionGrantStore.revoke(grant.id, 'user_requested')
        expect(revoked.revokedAt).toBeDefined()
        expect(revoked.revokedReason).toBe('user_requested')
      })
    })
  })

  describe('TriggerRegistration Store', () => {
    const createTestTrigger = (overrides: Partial<CreateTriggerRegistration> = {}): CreateTriggerRegistration => ({
      id: `trig_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      triggerType: 'event',
      conditionType: 'webhook',
      conditionPattern: '{"url": "/webhooks/test"}',
      targetType: 'runtime',
      targetRef: 'runtime_123',
      status: 'active' as TriggerStatus,
      ...overrides,
    })

    describe('create', () => {
      it('should create a trigger registration', () => {
        const trigger = createTestTrigger()
        const created = triggerStore.create(trigger)

        expect(created.id).toBe(trigger.id)
        expect(created.triggerType).toBe(trigger.triggerType)
        expect(created.status).toBe(trigger.status)
        expect(created.createdAt).toBeDefined()
      })
    })

    describe('getById', () => {
      it('should retrieve trigger by id', () => {
        const trigger = createTestTrigger()
        triggerStore.create(trigger)

        const retrieved = triggerStore.getById(trigger.id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.id).toBe(trigger.id)
      })
    })

    describe('findByTarget', () => {
      it('should find triggers by target', () => {
        const targetRef = 'runtime_target_test'
        triggerStore.create(createTestTrigger({ targetRef }))
        triggerStore.create(createTestTrigger({ targetRef }))
        triggerStore.create(createTestTrigger({ targetRef: 'other_runtime' }))

        const triggers = triggerStore.findByTarget('runtime', targetRef)
        expect(triggers.length).toBe(2)
      })
    })

    describe('findByStatus', () => {
      it('should find triggers by status', () => {
        triggerStore.create(createTestTrigger({ status: 'active' as TriggerStatus }))
        triggerStore.create(createTestTrigger({ status: 'active' as TriggerStatus }))
        triggerStore.create(createTestTrigger({ status: 'paused' as TriggerStatus }))

        const active = triggerStore.findByStatus('active' as TriggerStatus)
        expect(active.length).toBe(2)
      })
    })

    describe('incrementTriggerCount', () => {
      it('should increment trigger count', () => {
        const trigger = createTestTrigger()
        triggerStore.create(trigger)

        const updated = triggerStore.incrementTriggerCount(trigger.id)
        expect(updated.triggerCount).toBe(1)

        const updated2 = triggerStore.incrementTriggerCount(trigger.id)
        expect(updated2.triggerCount).toBe(2)
      })
    })

    describe('updateStatus', () => {
      it('should update trigger status', () => {
        const trigger = createTestTrigger({ status: 'active' as TriggerStatus })
        triggerStore.create(trigger)

        const updated = triggerStore.updateStatus(trigger.id, 'paused' as TriggerStatus)
        expect(updated.status).toBe('paused')
      })
    })

    describe('findExpired', () => {
      it('should find expired triggers', () => {
        const pastDate = new Date(Date.now() - 86400000).toISOString()
        const futureDate = new Date(Date.now() + 86400000).toISOString()

        triggerStore.create(createTestTrigger({ expiresAt: pastDate, status: 'active' as TriggerStatus }))
        triggerStore.create(createTestTrigger({ expiresAt: futureDate, status: 'active' as TriggerStatus }))

        const expired = triggerStore.findExpired(new Date().toISOString())
        expect(expired.length).toBe(1)
      })
    })

    describe('delete', () => {
      it('should delete trigger registration', () => {
        const trigger = createTestTrigger()
        triggerStore.create(trigger)

        triggerStore.delete(trigger.id)

        const retrieved = triggerStore.getById(trigger.id)
        expect(retrieved).toBeNull()
      })
    })
  })

  describe('WaitCondition Store', () => {
    const createTestWaitCondition = (overrides: Partial<CreateWaitCondition> = {}): CreateWaitCondition => ({
      id: `wait_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      waitType: 'event',
      conditionPattern: '{"event": "user_input"}',
      targetType: 'runtime',
      targetRef: 'runtime_123',
      status: WAIT_CONDITION_STATES.ACTIVE,
      ...overrides,
    })

    describe('create', () => {
      it('should create a wait condition', () => {
        const wait = createTestWaitCondition()
        const created = waitConditionStore.create(wait)

        expect(created.id).toBe(wait.id)
        expect(created.waitType).toBe(wait.waitType)
        expect(created.status).toBe(WAIT_CONDITION_STATES.ACTIVE)
        expect(created.createdAt).toBeDefined()
      })
    })

    describe('getById', () => {
      it('should retrieve wait condition by id', () => {
        const wait = createTestWaitCondition()
        waitConditionStore.create(wait)

        const retrieved = waitConditionStore.getById(wait.id)
        expect(retrieved).toBeDefined()
        expect(retrieved?.id).toBe(wait.id)
      })
    })

    describe('findByTarget', () => {
      it('should find wait conditions by target', () => {
        const targetRef = 'runtime_wait_test'
        waitConditionStore.create(createTestWaitCondition({ targetRef }))
        waitConditionStore.create(createTestWaitCondition({ targetRef }))
        waitConditionStore.create(createTestWaitCondition({ targetRef: 'other_runtime' }))

        const waits = waitConditionStore.findByTarget('runtime', targetRef)
        expect(waits.length).toBe(2)
      })
    })

    describe('findByStatus', () => {
      it('should find wait conditions by status', () => {
        waitConditionStore.create(createTestWaitCondition({ status: WAIT_CONDITION_STATES.ACTIVE }))
        waitConditionStore.create(createTestWaitCondition({ status: WAIT_CONDITION_STATES.ACTIVE }))
        waitConditionStore.create(createTestWaitCondition({ status: WAIT_CONDITION_STATES.SATISFIED }))

        const active = waitConditionStore.findByStatus(WAIT_CONDITION_STATES.ACTIVE)
        expect(active.length).toBe(2)
      })
    })

    describe('markSatisfied', () => {
      it('should mark wait condition as satisfied', () => {
        const wait = createTestWaitCondition()
        waitConditionStore.create(wait)

        const satisfied = waitConditionStore.markSatisfied(wait.id, 'event_123', { data: 'result' })
        expect(satisfied.status).toBe(WAIT_CONDITION_STATES.SATISFIED)
        expect(satisfied.satisfiedAt).toBeDefined()
        expect(satisfied.satisfiedBy).toBe('event_123')
        expect(satisfied.resultData).toEqual({ data: 'result' })
      })
    })

    describe('markFailed', () => {
      it('should mark wait condition as failed', () => {
        const wait = createTestWaitCondition()
        waitConditionStore.create(wait)

        const failed = waitConditionStore.markFailed(wait.id, 'Error occurred')
        expect(failed.status).toBe(WAIT_CONDITION_STATES.FAILED)
      })
    })

    describe('markTimeout', () => {
      it('should mark wait condition as timeout', () => {
        const wait = createTestWaitCondition()
        waitConditionStore.create(wait)

        const timeout = waitConditionStore.markTimeout(wait.id)
        expect(timeout.status).toBe(WAIT_CONDITION_STATES.TIMEOUT)
      })
    })

    describe('markCancelled', () => {
      it('should mark wait condition as cancelled', () => {
        const wait = createTestWaitCondition()
        waitConditionStore.create(wait)

        const cancelled = waitConditionStore.markCancelled(wait.id, 'User requested')
        expect(cancelled.status).toBe(WAIT_CONDITION_STATES.CANCELLED)
      })
    })

    describe('findExpired', () => {
      it('should find expired wait conditions', () => {
        const pastDate = new Date(Date.now() - 86400000).toISOString()
        const futureDate = new Date(Date.now() + 86400000).toISOString()

        waitConditionStore.create(
          createTestWaitCondition({ timeoutAt: pastDate, status: WAIT_CONDITION_STATES.ACTIVE }),
        )
        waitConditionStore.create(
          createTestWaitCondition({ timeoutAt: futureDate, status: WAIT_CONDITION_STATES.ACTIVE }),
        )

        const expired = waitConditionStore.findExpired(new Date().toISOString())
        expect(expired.length).toBe(1)
      })
    })

    describe('delete', () => {
      it('should delete wait condition', () => {
        const wait = createTestWaitCondition()
        waitConditionStore.create(wait)

        waitConditionStore.delete(wait.id)

        const retrieved = waitConditionStore.getById(wait.id)
        expect(retrieved).toBeNull()
      })
    })
  })

  describe('Integration: Cross-store operations', () => {
    it('should handle approval request and permission grant lifecycle', () => {
      // Create approval request
      const approvalId = `appr_${Date.now()}`
      const approval = approvalStore.create({
        id: approvalId,
        userId: 'user_lifecycle',
        sessionId: 'sess_lifecycle',
        status: APPROVAL_STATES.PENDING,
        actionType: 'grant_permission',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      expect(approval.status).toBe(APPROVAL_STATES.PENDING)

      // Approve it
      const approved = approvalStore.update(approvalId, {
        status: APPROVAL_STATES.APPROVED,
        respondedAt: new Date().toISOString(),
        responseBy: 'admin',
      })

      expect(approved.status).toBe(APPROVAL_STATES.APPROVED)

      // Create permission grant based on approval
      const grant = permissionGrantStore.create({
        id: `grant_${Date.now()}`,
        userId: approved.userId,
        scope: 'approved_scope',
        action: 'execute',
        sourceContext: JSON.stringify({ approvalId: approved.id }),
      })

      expect(grant.userId).toBe('user_lifecycle')

      // Find active grants
      const activeGrants = permissionGrantStore.findActiveByUserAndScope('user_lifecycle', 'approved_scope')
      expect(activeGrants.length).toBe(1)
    })

    it('should handle trigger and wait condition coordination', () => {
      // Create trigger
      const trigger = triggerStore.create({
        id: `trig_${Date.now()}`,
        triggerType: 'webhook',
        conditionType: 'http_post',
        conditionPattern: '{"path": "/webhook"}',
        targetType: 'wait_condition',
        targetRef: 'wait_123',
        status: 'active' as TriggerStatus,
      })

      // Create wait condition
      const wait = waitConditionStore.create({
        id: `wait_${Date.now()}`,
        waitType: 'trigger',
        conditionPattern: trigger.conditionPattern,
        targetType: 'runtime',
        targetRef: 'runtime_456',
        status: WAIT_CONDITION_STATES.ACTIVE,
      })

      expect(trigger.targetRef).toBe('wait_123')
      expect(wait.targetRef).toBe('runtime_456')

      // Increment trigger count
      triggerStore.incrementTriggerCount(trigger.id)

      // Mark wait as satisfied
      const satisfied = waitConditionStore.markSatisfied(wait.id, trigger.id)
      expect(satisfied.status).toBe(WAIT_CONDITION_STATES.SATISFIED)
    })
  })
})
