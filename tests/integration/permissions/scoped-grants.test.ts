import { describe, it, expect, beforeEach } from 'vitest'
import { createConnectionManager } from '../../../src/storage/connection.js'
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js'
import { createApprovalStore } from '../../../src/storage/approval-store.js'
import { createEventStore } from '../../../src/storage/event-store.js'
import { createPermissionEngine, type PermissionEngineDeps } from '../../../src/permissions/permission-engine.js'
import { createPermissionContext, type PermissionCheckRequest } from '../../../src/permissions/types.js'
import { createMigrationRunner } from '../../../src/storage/migrations.js'
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js'

describe('Scoped Grants Integration', () => {
  let connection: ReturnType<typeof createConnectionManager>
  let grantStore: ReturnType<typeof createPermissionGrantStore>
  let approvalStore: ReturnType<typeof createApprovalStore>
  let eventStore: ReturnType<typeof createEventStore>
  let engine: ReturnType<typeof createPermissionEngine>

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    const migrationRunner = createMigrationRunner(connection)
    migrationRunner.init()
    migrationRunner.apply(allStoreMigrations)
    grantStore = createPermissionGrantStore(connection)
    approvalStore = createApprovalStore(connection)
    eventStore = createEventStore(connection)

    const deps: PermissionEngineDeps = {
      approvalStore,
      grantStore,
      eventStore,
    }
    engine = createPermissionEngine(deps)
  })

  describe('workflow scope', () => {
    it('allows operation when scope matches workflow_run', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const workflowRunId = 'wf-run-001'
      const actionType = 'execute_tool'
      const resource = 'tool:sensitive_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `workflow_run:${workflowRunId}`,
        action: actionType,
        resourcePattern: 'tool:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'workflow_run',
        scopeRef: workflowRunId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
      expect(decision.status).toBe('allowed')
    })

    it('denies operation when scope does not match workflow_run', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const workflowRunId = 'wf-run-001'
      const otherWorkflowRunId = 'wf-run-002'
      const actionType = 'execute_tool'
      const resource = 'tool:sensitive_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `workflow_run:${workflowRunId}`,
        action: actionType,
        resourcePattern: 'tool:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'workflow_run',
        scopeRef: otherWorkflowRunId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
    })
  })

  describe('background_run scope', () => {
    it('allows operation when scope matches background_run', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const backgroundRunId = 'bg-run-001'
      const actionType = 'execute_tool'
      const resource = 'tool:background_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `background_run:${backgroundRunId}`,
        action: actionType,
        resourcePattern: 'tool:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'background_run',
        scopeRef: backgroundRunId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })

    it('denies operation when scope does not match background_run', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const backgroundRunId = 'bg-run-001'
      const otherBackgroundRunId = 'bg-run-002'
      const actionType = 'execute_tool'
      const resource = 'tool:background_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `background_run:${backgroundRunId}`,
        action: actionType,
        resourcePattern: 'tool:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'background_run',
        scopeRef: otherBackgroundRunId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(false)
    })
  })

  describe('session scope', () => {
    it('allows operation when scope matches session', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const actionType = 'execute_tool'
      const resource = 'tool:session_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `session:${sessionId}`,
        action: actionType,
        resourcePattern: 'tool:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'session',
        scopeRef: sessionId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })
  })

  describe('one_shot scope', () => {
    it('allows operation for one_shot scope', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const oneShotId = 'one-shot-001'
      const actionType = 'execute_tool'
      const resource = 'tool:one_shot_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `one_shot:${oneShotId}`,
        action: actionType,
        resourcePattern: 'tool:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'one_shot',
        scopeRef: oneShotId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })
  })

  describe('plan scope', () => {
    it('allows operation when scope matches plan', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const planId = 'plan-001'
      const actionType = 'execute_tool'
      const resource = 'tool:plan_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `plan:${planId}`,
        action: actionType,
        resourcePattern: 'tool:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'plan',
        scopeRef: planId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })
  })

  describe('connector scope', () => {
    it('allows operation when scope matches connector', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const connectorId = 'mock_email'
      const actionType = 'execute_tool'
      const resource = 'connector:send_email'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: `connector:${connectorId}`,
        action: actionType,
        resourcePattern: 'connector:*',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'connector',
        scopeRef: connectorId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })
  })

  describe('grant expiry', () => {
    it('denies operation when grant has expired', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const actionType = 'execute_tool'
      const resource = 'tool:expired_action'

      const pastDate = new Date(Date.now() - 3600000).toISOString()
      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: 'session:session-001',
        action: actionType,
        resourcePattern: 'tool:*',
        expiresAt: pastDate,
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'session',
        scopeRef: sessionId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(false)
      expect(decision.status).toBe('requires_approval')
    })

    it('allows operation when grant has not expired', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const actionType = 'execute_tool'
      const resource = 'tool:valid_action'

      const futureDate = new Date(Date.now() + 3600000).toISOString()
      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: 'session:session-001',
        action: actionType,
        resourcePattern: 'tool:*',
        expiresAt: futureDate,
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        scopeType: 'session',
        scopeRef: sessionId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })
  })

  describe('riskLevelMax enforcement', () => {
    it('allows low risk operation when riskLevelMax is medium', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const actionType = 'execute_tool'
      const resource = 'tool:low_risk_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: 'session:session-001',
        action: actionType,
        resourcePattern: 'tool:*',
        riskLevelMax: 'medium',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        riskLevel: 'low',
        scopeType: 'session',
        scopeRef: sessionId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })

    it('denies high risk operation when riskLevelMax is medium', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const actionType = 'execute_tool'
      const resource = 'tool:high_risk_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: 'session:session-001',
        action: actionType,
        resourcePattern: 'tool:*',
        riskLevelMax: 'medium',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        riskLevel: 'high',
        scopeType: 'session',
        scopeRef: sessionId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(false)
    })

    it('allows critical risk operation when riskLevelMax is critical', async () => {
      const userId = 'user-001'
      const sessionId = 'session-001'
      const actionType = 'execute_tool'
      const resource = 'tool:critical_action'

      const grant = grantStore.create({
        id: 'grant-001',
        userId,
        scope: 'session:session-001',
        action: actionType,
        resourcePattern: 'tool:*',
        riskLevelMax: 'critical',
      })

      const context = createPermissionContext(userId, sessionId, 'ask_on_write', [grant])

      const request: PermissionCheckRequest = {
        context,
        actionType,
        resource,
        operationType: 'execute',
        riskLevel: 'critical',
        scopeType: 'session',
        scopeRef: sessionId,
      }

      const decision = engine.checkPermission(request)
      expect(decision.allowed).toBe(true)
    })
  })
})
