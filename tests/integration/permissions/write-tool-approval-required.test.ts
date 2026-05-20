import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createPermissionEngine, type PermissionEngine } from '../../../src/permissions/permission-engine.js';
import {
  createPermissionContext,
  type PermissionCheckRequest,
} from '../../../src/permissions/types.js';
import { buildDefaultRiskPolicies } from '../../../src/permissions/tool-risk-policy.js';

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
];

describe('Write-tool approval required', () => {
  let connection: ConnectionManager;
  let migrationRunner: MigrationRunner;
  let approvalStore: ApprovalStore;
  let grantStore: PermissionGrantStore;
  let eventStore: EventStore;
  let permissionEngine: PermissionEngine;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(STORE_MIGRATIONS);

    approvalStore = createApprovalStore(connection);
    grantStore = createPermissionGrantStore(connection);
    eventStore = createEventStore(connection);
    permissionEngine = createPermissionEngine({ approvalStore, grantStore, eventStore });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('ask_on_write mode triggers approval for write operations', () => {
    it('write operationType → requires_approval', () => {
      const ctx = createPermissionContext('u1', 's1', 'ask_on_write');
      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'artifact.create',
        operationType: 'write',
        resource: '/artifact/001',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
      expect(decision.requestId).toBeDefined();
      expect(decision.approvalRequest).toBeDefined();
    });

    it('delete operationType → requires_approval', () => {
      const ctx = createPermissionContext('u1', 's1', 'ask_on_write');
      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'artifact.delete',
        operationType: 'delete',
        resource: '/artifact/001',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
      expect(decision.requestId).toBeDefined();
    });

    it('execute operationType → requires_approval', () => {
      const ctx = createPermissionContext('u1', 's1', 'ask_on_write');
      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'command.run',
        operationType: 'execute',
        resource: 'npm install',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
    });

    it('read operationType → allowed (no approval)', () => {
      const ctx = createPermissionContext('u1', 's1', 'ask_on_write');
      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'file.read',
        operationType: 'read',
        resource: '/data/file.txt',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('allowed');
      expect(decision.allowed).toBe(true);
    });

    it('admin operationType → allowed (no approval needed for admin in ask_on_write)', () => {
      const ctx = createPermissionContext('u1', 's1', 'ask_on_write');
      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'admin.configure',
        operationType: 'admin',
        resource: '/settings',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('allowed');
      expect(decision.allowed).toBe(true);
    });
  });

  describe('risk level with grants', () => {
    it('grant with riskLevelMax covers low-risk request', () => {
      const userId = 'u_rl';
      const scope = 'sess_rl';

      grantStore.create({
        id: `grant_rl_${Date.now()}`,
        userId,
        scope,
        action: 'artifact.create',
        riskLevelMax: 'medium',
      });

      const ctx = createPermissionContext(
        userId,
        's1',
        'ask_on_write',
        grantStore.findActiveByUserAndScope(userId, scope),
      );

      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'artifact.create',
        operationType: 'write',
        resource: '/artifact/001',
        riskLevel: 'low',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('allowed');
      expect(decision.allowed).toBe(true);
    });

    it('grant with riskLevelMax does NOT cover higher-risk request', () => {
      const userId = 'u_rl_high';
      const scope = 'sess_rl_high';

      grantStore.create({
        id: `grant_rl_high_${Date.now()}`,
        userId,
        scope,
        action: 'artifact.create',
        riskLevelMax: 'medium',
      });

      const ctx = createPermissionContext(
        userId,
        's1',
        'ask_on_write',
        grantStore.findActiveByUserAndScope(userId, scope),
      );

      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'artifact.create',
        operationType: 'write',
        resource: '/artifact/001',
        riskLevel: 'critical',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('requires_approval');
      expect(decision.allowed).toBe(false);
    });

    it('grant with wildcard action covers specific action', () => {
      const userId = 'u_wc';
      const scope = 'sess_wc';

      grantStore.create({
        id: `grant_wc_${Date.now()}`,
        userId,
        scope,
        action: '*',
        riskLevelMax: 'high',
      });

      const ctx = createPermissionContext(
        userId,
        's1',
        'ask_on_write',
        grantStore.findActiveByUserAndScope(userId, scope),
      );

      const req: PermissionCheckRequest = {
        context: ctx,
        actionType: 'artifact.create',
        operationType: 'write',
        resource: '/artifact/001',
        riskLevel: 'high',
      };

      const decision = permissionEngine.checkPermission(req);
      expect(decision.status).toBe('allowed');
      expect(decision.allowed).toBe(true);
    });
  });

  describe('tool risk policy integration', () => {
    it('all 21 built-in tools have a risk policy', () => {
      const policies = buildDefaultRiskPolicies();
      expect(policies).toHaveLength(21);
    });

    it('write-category tools all require approval per policy', () => {
      const policies = buildDefaultRiskPolicies();
      const writePolicies = policies.filter((p) => {
        const tool = getToolSummary(p.toolName);
        return tool && tool.category === 'write';
      });

      for (const policy of writePolicies) {
        expect(policy.requiresApproval).toBe(true);
      }
    });

    it('non-write-category tools do NOT require approval per policy', () => {
      const policies = buildDefaultRiskPolicies();
      const nonWrite = policies.filter((p) => {
        const tool = getToolSummary(p.toolName);
        return tool && tool.category !== 'write';
      });

      for (const policy of nonWrite) {
        expect(policy.requiresApproval).toBe(false);
      }
    });
  });
});

import { BUILT_IN_TOOLS } from '../../../src/api/tool-catalog.js';
import type { ToolSummary } from '../../../src/api/types.js';

function getToolSummary(name: string): ToolSummary | undefined {
  return BUILT_IN_TOOLS.find((t) => t.name === name);
}
