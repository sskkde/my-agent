import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import { createApprovalStore, type ApprovalStore, APPROVAL_STATES } from '../../../src/storage/approval-store.js'
import { createPermissionGrantStore, type PermissionGrantStore } from '../../../src/storage/permission-grant-store.js'
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js'
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js'
import {
  createApprovalHandler,
  type ApprovalHandler,
  type ApprovalHandlerDeps,
} from '../../../src/permissions/approval-handler.js'
import { createGateway, type Gateway } from '../../../src/gateway/gateway.js'
import type { Stores as GatewayStores } from '../../../src/gateway/types.js'
import { createRuntimeDispatcher } from '../../../src/dispatcher/runtime-dispatcher.js'
import type { RuntimeDispatcher } from '../../../src/dispatcher/types.js'
import type { RuntimeAction, DispatchRequest, AdapterRegistry } from '../../../src/dispatcher/types.js'
import type { ApprovalResponse } from '../../../src/permissions/types.js'

let actionIdCounter = 0
function generateTestId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++actionIdCounter}`
}

describe('Approval Resume Flow Integration', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let approvalStore: ApprovalStore
  let permissionGrantStore: PermissionGrantStore
  let eventStore: EventStore
  let runtimeActionStore: RuntimeActionStore
  let approvalHandler: ApprovalHandler
  let gateway: Gateway
  let dispatcher: RuntimeDispatcher
  let gatewayStores: GatewayStores
  let dispatchedActions: RuntimeAction[]

  beforeEach(async () => {
    actionIdCounter = 0
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()

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
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_approval_user_status ON approval_requests(user_id, status);
          CREATE INDEX idx_approval_session_status ON approval_requests(session_id, status);
          CREATE INDEX idx_approval_expires ON approval_requests(expires_at);
          CREATE INDEX idx_approval_idempotency ON approval_requests(idempotency_key);
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
            payload TEXT,
            sensitivity TEXT NOT NULL,
            retention_class TEXT NOT NULL,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_events_session ON events(session_id);
          CREATE INDEX idx_events_correlation ON events(correlation_id);
          CREATE INDEX idx_events_approval ON events(approval_id);
        `,
        down: `DROP TABLE IF EXISTS events;`,
      },
      {
        version: 4,
        name: 'create_runtime_actions_table',
        up: `
          CREATE TABLE runtime_actions (
            action_id TEXT PRIMARY KEY,
            action_type TEXT NOT NULL,
            idempotency_key TEXT,
            source_module TEXT NOT NULL,
            source_action TEXT,
            target_runtime TEXT NOT NULL,
            target_action TEXT NOT NULL,
            payload TEXT NOT NULL,
            correlation_id TEXT,
            causation_id TEXT,
            session_id TEXT,
            user_id TEXT,
            planner_run_id TEXT,
            plan_id TEXT,
            run_id TEXT,
            workflow_run_id TEXT,
            workflow_step_run_id TEXT,
            background_run_id TEXT,
            subagent_run_id TEXT,
            tool_call_id TEXT,
            status TEXT NOT NULL,
            status_message TEXT,
            result TEXT,
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX idx_runtime_action_session ON runtime_actions(session_id);
          CREATE INDEX idx_runtime_action_status ON runtime_actions(status);
          CREATE INDEX idx_runtime_action_idempotency ON runtime_actions(idempotency_key);
        `,
        down: `DROP TABLE IF EXISTS runtime_actions;`,
      },
      {
        version: 5,
        name: 'create_summaries_table',
        up: `
          CREATE TABLE session_summaries (
            session_id TEXT PRIMARY KEY,
            summary_text TEXT,
            structured_state TEXT,
            updated_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS session_summaries;`,
      },
      {
        version: 6,
        name: 'create_transcripts_table',
        up: `
          CREATE TABLE transcripts (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_transcripts_session ON transcripts(session_id);
        `,
        down: `DROP TABLE IF EXISTS transcripts;`,
      },
    ]

    migrations.apply(storeMigrations)

    approvalStore = createApprovalStore(connection)
    permissionGrantStore = createPermissionGrantStore(connection)
    eventStore = createEventStore(connection)
    runtimeActionStore = createRuntimeActionStore(connection)

    dispatchedActions = []

    const mockAdapterRegistry: AdapterRegistry = {
      register: () => {},
      getAdapter: () => ({
        execute: async (action: RuntimeAction) => {
          dispatchedActions.push(action)
          return { success: true, actionId: action.actionId }
        },
      }),
      unregister: () => {},
      listAdapters: () => ['agent_kernel'],
    }

    const approvalDeps: ApprovalHandlerDeps = {
      approvalStore,
      grantStore: permissionGrantStore,
      eventStore,
    }
    approvalHandler = createApprovalHandler(approvalDeps)

    gatewayStores = {
      summaryStore: {
        getSessionMemory: () => null,
        saveSessionMemory: () => {},
      } as unknown as GatewayStores['summaryStore'],
      transcriptStore: {
        findBySession: () => [],
        append: () => {},
      } as unknown as GatewayStores['transcriptStore'],
      eventStore: eventStore as unknown as GatewayStores['eventStore'],
      runtimeActionStore: {
        findBySessionId: (sessionId: string) => {
          return runtimeActionStore.query({ sessionId })
        },
      } as unknown as GatewayStores['runtimeActionStore'],
    }

    gateway = createGateway({ stores: gatewayStores })

    dispatcher = createRuntimeDispatcher({
      actionStore: runtimeActionStore,
      eventStore,
      adapterRegistry: mockAdapterRegistry,
    })
  })

  afterEach(() => {
    connection?.close()
  })

  describe('Approved approval resumes target', () => {
    it('should create a resume RuntimeAction when approval is approved', async () => {
      const approvalRequest = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'tool_execution',
        operationType: 'execute',
        resource: 'file://sensitive.txt',
        justification: 'Need to read sensitive file',
        requestedBy: 'system',
      })

      expect(approvalRequest.status).toBe('pending')

      const waitingAction: RuntimeAction = {
        actionId: generateTestId('action'),
        actionType: 'execute_tool',
        source: { sourceModule: 'planner' },
        targetRuntime: 'agent_kernel',
        targetAction: 'execute_tool',
        payload: { toolName: 'file_read', path: 'sensitive.txt' },
        sessionId: 'sess_456',
        userId: 'user_123',
        targetRef: { runId: 'run_123', approvalId: approvalRequest.id },
        status: 'waiting_for_approval',
        correlationId: generateTestId('corr'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      runtimeActionStore.save(waitingAction)

      const approvalResponse: ApprovalResponse = {
        requestId: approvalRequest.id,
        responseType: 'approve_once',
        respondedBy: 'user_123',
        reason: 'Approved for this operation',
        respondedAt: new Date().toISOString(),
      }

      const envelope = gateway.normalizeInbound({
        eventType: 'approval_response',
        sourceChannel: 'user_interface',
        payload: { approvalResponse },
        userId: 'user_123',
        sessionId: 'sess_456',
      })

      expect(envelope.payload.approvalResponse).toBeDefined()

      const result = approvalHandler.processResponse(approvalResponse)

      expect(result.success).toBe(true)
      expect(result.approved).toBe(true)

      const updatedApproval = approvalStore.getById(approvalRequest.id)
      expect(updatedApproval?.status).toBe(APPROVAL_STATES.APPROVED)

      const resumeAction: RuntimeAction = {
        actionId: generateTestId('resume'),
        actionType: 'resume_agent_run',
        source: { sourceModule: 'permission' },
        targetRuntime: 'agent_kernel',
        targetAction: 'resume_agent_run',
        payload: {
          originalActionId: waitingAction.actionId,
          approvalId: approvalRequest.id,
          decision: 'approved',
        },
        sessionId: 'sess_456',
        userId: 'user_123',
        targetRef: { runId: 'run_123', approvalId: approvalRequest.id },
        status: 'created',
        correlationId: waitingAction.correlationId,
        causationId: envelope.envelopeId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const dispatchRequest: DispatchRequest = {
        requestId: generateTestId('req'),
        action: resumeAction,
        context: {
          callerModule: 'permission',
          userId: 'user_123',
          sessionId: 'sess_456',
        },
      }

      const dispatchResult = await dispatcher.dispatch(dispatchRequest)

      if (dispatchResult.status !== 'completed') {
        console.log('Dispatch failed:', dispatchResult.error)
      }

      expect(dispatchResult.status).toBe('completed')
      expect(dispatchedActions.length).toBe(1)
      expect(dispatchedActions[0].actionType).toBe('resume_agent_run')
      expect(dispatchedActions[0].payload.decision).toBe('approved')

      const savedAction = runtimeActionStore.findById(resumeAction.actionId)
      expect(savedAction?.status).toBe('completed')

      const events = eventStore.query({ sessionId: 'sess_456' })
      const approvalEvents = events.filter((e) => e.eventType === 'approval_responded')
      expect(approvalEvents.length).toBeGreaterThan(0)
    })
  })

  describe('Duplicate approval response idempotent', () => {
    it('should return previous decision for duplicate approval responses', async () => {
      const approvalRequest = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'tool_execution',
        operationType: 'execute',
        requestedBy: 'system',
      })

      const approvalResponse: ApprovalResponse = {
        requestId: approvalRequest.id,
        responseType: 'approve_once',
        respondedBy: 'user_123',
        reason: 'First approval',
        respondedAt: new Date().toISOString(),
      }

      const firstResult = approvalHandler.processResponse(approvalResponse)
      expect(firstResult.success).toBe(true)
      expect(firstResult.approved).toBe(true)

      const duplicateResponse: ApprovalResponse = {
        requestId: approvalRequest.id,
        responseType: 'approve_once',
        respondedBy: 'user_123',
        reason: 'Duplicate attempt',
        respondedAt: new Date().toISOString(),
      }

      const duplicateResult = approvalHandler.processResponse(duplicateResponse)

      expect(duplicateResult.success).toBe(false)
      expect(duplicateResult.approved).toBe(false)
      expect(duplicateResult.error).toContain('not pending')

      const approval = approvalStore.getById(approvalRequest.id)
      expect(approval?.status).toBe(APPROVAL_STATES.APPROVED)
      expect(approval?.responseReason).toBe('First approval')
    })
  })

  describe('Rejected approval resumes with denied outcome', () => {
    it('should create a resume RuntimeAction with denied outcome when approval is rejected', async () => {
      const approvalRequest = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'tool_execution',
        operationType: 'execute',
        resource: 'file://sensitive.txt',
        justification: 'Need to read sensitive file',
        requestedBy: 'system',
      })

      const waitingAction: RuntimeAction = {
        actionId: generateTestId('action'),
        actionType: 'execute_tool',
        source: { sourceModule: 'planner' },
        targetRuntime: 'agent_kernel',
        targetAction: 'execute_tool',
        payload: { toolName: 'file_read', path: 'sensitive.txt' },
        sessionId: 'sess_456',
        userId: 'user_123',
        targetRef: { runId: 'run_123', approvalId: approvalRequest.id },
        status: 'waiting_for_approval',
        correlationId: generateTestId('corr'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      runtimeActionStore.save(waitingAction)

      const rejectionResponse: ApprovalResponse = {
        requestId: approvalRequest.id,
        responseType: 'reject',
        respondedBy: 'user_123',
        reason: 'Security policy violation',
        respondedAt: new Date().toISOString(),
      }

      const result = approvalHandler.processResponse(rejectionResponse)

      expect(result.success).toBe(true)
      expect(result.approved).toBe(false)

      const updatedApproval = approvalStore.getById(approvalRequest.id)
      expect(updatedApproval?.status).toBe(APPROVAL_STATES.REJECTED)

      const resumeAction: RuntimeAction = {
        actionId: generateTestId('resume'),
        actionType: 'resume_agent_run',
        source: { sourceModule: 'permission' },
        targetRuntime: 'agent_kernel',
        targetAction: 'resume_agent_run',
        payload: {
          originalActionId: waitingAction.actionId,
          approvalId: approvalRequest.id,
          decision: 'rejected',
          reason: 'Security policy violation',
        },
        sessionId: 'sess_456',
        userId: 'user_123',
        targetRef: { runId: 'run_123', approvalId: approvalRequest.id },
        status: 'created',
        correlationId: waitingAction.correlationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const dispatchRequest: DispatchRequest = {
        requestId: generateTestId('req'),
        action: resumeAction,
        context: {
          callerModule: 'permission',
          userId: 'user_123',
          sessionId: 'sess_456',
        },
      }

      const dispatchResult = await dispatcher.dispatch(dispatchRequest)

      expect(dispatchResult.status).toBe('completed')
      expect(dispatchedActions.length).toBe(1)
      expect(dispatchedActions[0].payload.decision).toBe('rejected')
      expect(dispatchedActions[0].payload.reason).toBe('Security policy violation')
    })
  })

  describe('Target-already-cancelled handling', () => {
    it('should handle resuming when target runtime action is already cancelled', async () => {
      const approvalRequest = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'tool_execution',
        operationType: 'execute',
        requestedBy: 'system',
      })

      const cancelledAction: RuntimeAction = {
        actionId: generateTestId('action'),
        actionType: 'execute_tool',
        source: { sourceModule: 'planner' },
        targetRuntime: 'agent_kernel',
        targetAction: 'execute_tool',
        payload: { toolName: 'file_read', path: 'sensitive.txt' },
        sessionId: 'sess_456',
        userId: 'user_123',
        targetRef: { runId: 'run_123', approvalId: approvalRequest.id },
        status: 'cancelled',
        correlationId: generateTestId('corr'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      runtimeActionStore.save(cancelledAction)

      const approvalResponse: ApprovalResponse = {
        requestId: approvalRequest.id,
        responseType: 'approve_once',
        respondedBy: 'user_123',
        reason: 'Approved',
        respondedAt: new Date().toISOString(),
      }

      const result = approvalHandler.processResponse(approvalResponse)
      expect(result.success).toBe(true)

      const originalAction = runtimeActionStore.findById(cancelledAction.actionId)
      expect(originalAction?.status).toBe('cancelled')

      const resumeAction: RuntimeAction = {
        actionId: generateTestId('resume'),
        actionType: 'resume_agent_run',
        source: { sourceModule: 'permission' },
        targetRuntime: 'agent_kernel',
        targetAction: 'resume_agent_run',
        payload: {
          originalActionId: cancelledAction.actionId,
          approvalId: approvalRequest.id,
          decision: 'approved',
          targetAlreadyCancelled: true,
        },
        sessionId: 'sess_456',
        userId: 'user_123',
        targetRef: { runId: 'run_123', approvalId: approvalRequest.id },
        status: 'created',
        correlationId: cancelledAction.correlationId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      const dispatchRequest: DispatchRequest = {
        requestId: generateTestId('req'),
        action: resumeAction,
        context: {
          callerModule: 'permission',
          userId: 'user_123',
          sessionId: 'sess_456',
        },
      }

      const dispatchResult = await dispatcher.dispatch(dispatchRequest)

      expect(dispatchResult.status).toBe('completed')
      expect(dispatchedActions[0].payload.targetAlreadyCancelled).toBe(true)
    })
  })
})
