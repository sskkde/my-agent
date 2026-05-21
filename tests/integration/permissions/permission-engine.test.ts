import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createApprovalStore, type ApprovalStore, APPROVAL_STATES } from '../../../src/storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import {
  createPermissionEngine,
  type PermissionEngine,
} from '../../../src/permissions/permission-engine.js';
import {
  createApprovalHandler,
  type ApprovalHandler,
} from '../../../src/permissions/approval-handler.js';
import {
  createPermissionContext,
  type PermissionCheckRequest,
} from '../../../src/permissions/types.js';

describe('Permission & Approval Engine', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let approvalStore: ApprovalStore;
  let grantStore: PermissionGrantStore;
  let eventStore: EventStore;
  let permissionEngine: PermissionEngine;
  let approvalHandler: ApprovalHandler;

  beforeEach(async () => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();

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
    ];

    migrations.apply(storeMigrations);

    approvalStore = createApprovalStore(connection);
    grantStore = createPermissionGrantStore(connection);
    eventStore = createEventStore(connection);
    permissionEngine = createPermissionEngine({
      approvalStore,
      grantStore,
      eventStore,
    });
    approvalHandler = createApprovalHandler({
      approvalStore,
      grantStore,
      eventStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('PermissionEngine.checkPermission', () => {
    it('should allow read operations in read_only mode', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'read_only');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_read',
        operationType: 'read',
        resource: '/data/file.txt',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(true);
      expect(decision.status).toBe('allowed');
    });

    it('should deny write operations in read_only mode', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'read_only');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_write',
        operationType: 'write',
        resource: '/data/file.txt',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
      expect(decision.reason).toContain('read_only');
    });

    it('should allow all operations in ask_on_write mode for reads', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_read',
        operationType: 'read',
        resource: '/data/file.txt',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(true);
      expect(decision.status).toBe('allowed');
    });

    it('should require approval for write operations in ask_on_write mode', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_write',
        operationType: 'write',
        resource: '/data/file.txt',
        justification: 'Updating user profile',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('requires_approval');
      expect(decision.requestId).toBeDefined();
      expect(decision.approvalRequest).toBeDefined();
    });

    it('should deny all operations in hard_deny mode', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'hard_deny');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'any_action',
        operationType: 'read',
        resource: '/data/file.txt',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
      expect(decision.reason).toContain('hard_deny');
    });

    it('should allow reads in background_limited mode', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'background_limited');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'data_query',
        operationType: 'read',
        resource: '/data/query',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(true);
      expect(decision.status).toBe('allowed');
    });

    it('should deny writes in background_limited mode', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'background_limited');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_write',
        operationType: 'write',
        resource: '/data/file.txt',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
    });

    it('should respect existing grants for allowed operations', () => {
      const userId = 'user_granted';
      const scope = 'project_alpha';
      
      grantStore.create({
        id: `grant_${Date.now()}`,
        userId,
        scope,
        action: 'file_write',
        resourcePattern: '/data/project/.*',
      });

      const context = createPermissionContext(userId, 'sess_456', 'ask_on_write', 
        grantStore.findActiveByUserAndScope(userId, scope)
      );
      
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_write',
        operationType: 'write',
        resource: '/data/project/file.txt',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(true);
      expect(decision.status).toBe('allowed');
      expect(decision.grant).toBeDefined();
    });

    it('should emit audit event for permission check', () => {
      const context = createPermissionContext('user_123', 'sess_456', 'read_only');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_read',
        operationType: 'read',
        resource: '/data/file.txt',
      };

      permissionEngine.checkPermission(request);

      const events = eventStore.query({ 
        userId: 'user_123',
        sourceModule: 'permission'
      });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].eventType).toBe('permission_granted');
    });
  });

  describe('ApprovalHandler.createApproval', () => {
    it('should create an approval request', () => {
      const request = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'file_write',
        operationType: 'write',
        resource: '/data/file.txt',
        justification: 'Need to update config',
        requestedBy: 'system',
      });

      expect(request.id).toBeDefined();
      expect(request.status).toBe('pending');
      expect(request.userId).toBe('user_123');
      expect(request.actionType).toBe('file_write');
    });

    it('should set expiry on approval request', () => {
      const request = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'file_write',
        operationType: 'write',
        requestedBy: 'system',
        expiresInMs: 3600000,
      });

      expect(request.expiresAt).toBeDefined();
      const expiry = new Date(request.expiresAt!);
      const now = new Date();
      expect(expiry.getTime()).toBeGreaterThan(now.getTime());
    });
  });

  describe('ApprovalHandler.processResponse', () => {
    it('should approve a pending request with approve_once', () => {
      const approval = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'file_write',
        operationType: 'write',
        requestedBy: 'system',
      });

      const result = approvalHandler.processResponse({
        requestId: approval.id,
        responseType: 'approve_once',
        respondedBy: 'admin_user',
        respondedAt: new Date().toISOString(),
      });

      expect(result.success).toBe(true);
      expect(result.approved).toBe(true);

      const updated = approvalStore.getById(approval.id);
      expect(updated?.status).toBe(APPROVAL_STATES.APPROVED);
    });

    it('should reject a pending request', () => {
      const approval = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'file_write',
        operationType: 'write',
        requestedBy: 'system',
      });

      const result = approvalHandler.processResponse({
        requestId: approval.id,
        responseType: 'reject',
        respondedBy: 'admin_user',
        respondedAt: new Date().toISOString(),
        reason: 'Not authorized',
      });

      expect(result.success).toBe(true);
      expect(result.approved).toBe(false);

      const updated = approvalStore.getById(approval.id);
      expect(updated?.status).toBe(APPROVAL_STATES.REJECTED);
    });

    it('should create a grant with approve_always', () => {
      const approval = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'file_write',
        operationType: 'write',
        resource: '/data/project/.*',
        requestedBy: 'system',
      });

      const result = approvalHandler.processResponse({
        requestId: approval.id,
        responseType: 'approve_always',
        respondedBy: 'admin_user',
        respondedAt: new Date().toISOString(),
        grantScope: 'project_alpha',
        grantDuration: 86400000,
      });

      expect(result.success).toBe(true);
      expect(result.approved).toBe(true);
      expect(result.grant).toBeDefined();

      const grant = result.grant!;
      expect(grant.userId).toBe('user_123');
      expect(grant.scope).toBe('project_alpha');
      expect(grant.action).toBe('file_write');
    });

    it('should emit audit event for approval response', () => {
      const approval = approvalHandler.createApproval({
        userId: 'user_123',
        sessionId: 'sess_456',
        actionType: 'file_write',
        operationType: 'write',
        requestedBy: 'system',
      });

      approvalHandler.processResponse({
        requestId: approval.id,
        responseType: 'approve_once',
        respondedBy: 'admin_user',
        respondedAt: new Date().toISOString(),
      });

      const events = eventStore.query({ 
        userId: 'user_123',
        eventType: 'approval_responded' 
      });
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe('Persona permission policy', () => {
    it('should not allow persona to bypass hard_deny policy', () => {
      const context = createPermissionContext('persona_user', 'sess_456', 'hard_deny');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'file_read',
        operationType: 'read',
        resource: '/data/file.txt',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
    });

    it('should not allow workflow publication to bypass policy', () => {
      const context = createPermissionContext('workflow_user', 'sess_456', 'hard_deny');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'publish_workflow',
        operationType: 'write',
        resource: 'workflow_definition',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
    });
  });

  describe('PermissionGrant storage and expiry', () => {
    it('should store created grants', () => {
      const grant = grantStore.create({
        id: `grant_${Date.now()}`,
        userId: 'user_123',
        scope: 'test_scope',
        action: 'file_write',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const retrieved = grantStore.getById(grant.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.userId).toBe('user_123');
    });

    it('should find active grants by user and scope', () => {
      const userId = 'user_active';
      const scope = 'active_scope';
      
      grantStore.create({
        id: `grant_${Date.now()}_1`,
        userId,
        scope,
        action: 'read',
      });

      grantStore.create({
        id: `grant_${Date.now()}_2`,
        userId,
        scope,
        action: 'write',
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });

      const active = grantStore.findActiveByUserAndScope(userId, scope);
      expect(active.length).toBe(2);
    });

    it('should not return expired grants as active', () => {
      const userId = 'user_expired';
      const scope = 'expired_scope';
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      
      grantStore.create({
        id: `grant_${Date.now()}`,
        userId,
        scope,
        action: 'read',
        expiresAt: pastDate,
      });

      const active = grantStore.findActiveByUserAndScope(userId, scope);
      expect(active.length).toBe(0);
    });
  });
});
