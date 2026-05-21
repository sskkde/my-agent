import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js';
import { createPermissionGrantStore, type PermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createConnectorPolicyStore, type ConnectorPolicyStore } from '../../../src/storage/connector-policy-store.js';
import {
  createPermissionEngine,
  type PermissionEngine,
} from '../../../src/permissions/permission-engine.js';
import {
  createPermissionContext,
  type PermissionCheckRequest,
} from '../../../src/permissions/types.js';

describe('Connector Policy', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let approvalStore: ApprovalStore;
  let grantStore: PermissionGrantStore;
  let eventStore: EventStore;
  let connectorPolicyStore: ConnectorPolicyStore;
  let permissionEngine: PermissionEngine;

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
            tenant_id TEXT NOT NULL DEFAULT 'org_default',
            created_at TEXT NOT NULL
          );
          CREATE INDEX idx_events_session ON events(session_id);
          CREATE INDEX idx_events_user ON events(user_id);
          CREATE INDEX idx_events_type ON events(event_type);
        `,
        down: `DROP TABLE IF EXISTS events;`,
      },
      {
        version: 4,
        name: 'create_connector_policies_table',
        up: `
          CREATE TABLE connector_policies (
            policy_id TEXT PRIMARY KEY,
            connector_id TEXT NOT NULL,
            resource_pattern TEXT NOT NULL,
            action TEXT NOT NULL,
            effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
            allowed_scopes TEXT,
            risk_cap TEXT,
            audit_label TEXT,
            user_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT
          );
          CREATE INDEX idx_connector_policies_connector ON connector_policies(connector_id);
          CREATE INDEX idx_connector_policies_effect ON connector_policies(effect);
        `,
        down: `DROP TABLE IF EXISTS connector_policies;`,
      },
    ];

    migrations.apply(storeMigrations);

    approvalStore = createApprovalStore(connection);
    grantStore = createPermissionGrantStore(connection);
    eventStore = createEventStore(connection);
    connectorPolicyStore = createConnectorPolicyStore(connection);
    permissionEngine = createPermissionEngine({
      approvalStore,
      grantStore,
      eventStore,
      connectorPolicyStore,
    });
  });

  afterEach(() => {
    connection?.close();
  });

  describe('ConnectorPolicyStore', () => {
    it('should create and retrieve a policy', () => {
      const policy = connectorPolicyStore.create({
        policyId: 'policy_001',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'deny',
        auditLabel: 'email_send_blocked',
      });

      expect(policy.policyId).toBe('policy_001');
      expect(policy.connectorId).toBe('mock_email');
      expect(policy.effect).toBe('deny');

      const retrieved = connectorPolicyStore.getById('policy_001');
      expect(retrieved).toBeDefined();
      expect(retrieved?.policyId).toBe('policy_001');
    });

    it('should list policies by connector', () => {
      connectorPolicyStore.create({
        policyId: 'policy_002',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'deny',
      });

      connectorPolicyStore.create({
        policyId: 'policy_003',
        connectorId: 'mock_calendar',
        resourcePattern: '*',
        action: 'create_event',
        effect: 'allow',
      });

      const emailPolicies = connectorPolicyStore.getPoliciesByConnector('mock_email');
      expect(emailPolicies.length).toBe(1);
      expect(emailPolicies[0].policyId).toBe('policy_002');

      const calendarPolicies = connectorPolicyStore.getPoliciesByConnector('mock_calendar');
      expect(calendarPolicies.length).toBe(1);
    });

    it('should match resource patterns with glob', () => {
      connectorPolicyStore.create({
        policyId: 'policy_glob',
        connectorId: 'mock_docs',
        resourcePattern: 'documents/sensitive/*',
        action: 'read',
        effect: 'deny',
      });

      const policies = connectorPolicyStore.getEffectivePolicies(
        'mock_docs',
        'documents/sensitive/secret.txt',
        'read'
      );

      expect(policies.length).toBe(1);
      expect(policies[0].effect).toBe('deny');

      const noMatch = connectorPolicyStore.getEffectivePolicies(
        'mock_docs',
        'documents/public/readme.txt',
        'read'
      );
      expect(noMatch.length).toBe(0);
    });

    it('should match action wildcard', () => {
      connectorPolicyStore.create({
        policyId: 'policy_wildcard',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: '*',
        effect: 'deny',
      });

      const policies = connectorPolicyStore.getEffectivePolicies(
        'mock_email',
        'inbox',
        'send'
      );

      expect(policies.length).toBe(1);
    });

    it('should prioritize deny policies', () => {
      connectorPolicyStore.create({
        policyId: 'allow_policy',
        connectorId: 'mock_calendar',
        resourcePattern: '*',
        action: 'create_event',
        effect: 'allow',
      });

      connectorPolicyStore.create({
        policyId: 'deny_policy',
        connectorId: 'mock_calendar',
        resourcePattern: '*',
        action: 'create_event',
        effect: 'deny',
      });

      const policies = connectorPolicyStore.getEffectivePolicies(
        'mock_calendar',
        'calendar',
        'create_event'
      );

      expect(policies.length).toBe(2);
      expect(policies[0].effect).toBe('deny');
    });

    it('should filter by user when specified', () => {
      connectorPolicyStore.create({
        policyId: 'global_deny',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'deny',
      });

      connectorPolicyStore.create({
        policyId: 'user_allow',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'allow',
        userId: 'user_special',
      });

      const policiesForUser = connectorPolicyStore.getEffectivePolicies(
        'mock_email',
        'inbox',
        'send',
        'user_special'
      );

      expect(policiesForUser.length).toBe(2);
      // User-specific policies take precedence over global policies
      expect(policiesForUser[0].effect).toBe('allow');

      const policiesForOther = connectorPolicyStore.getEffectivePolicies(
        'mock_email',
        'inbox',
        'send',
        'user_other'
      );

      expect(policiesForOther.length).toBe(1);
      expect(policiesForOther[0].effect).toBe('deny');
    });
  });

  describe('PermissionEngine.checkConnectorPolicy', () => {
    it('should return denied: false when no policies exist', () => {
      const result = permissionEngine.checkConnectorPolicy(
        'mock_email',
        'inbox',
        'send',
        'user_123'
      );

      expect(result.denied).toBe(false);
    });

    it('should return denied: true when deny policy matches', () => {
      connectorPolicyStore.create({
        policyId: 'deny_send',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'deny',
        auditLabel: 'email_send_blocked',
      });

      const result = permissionEngine.checkConnectorPolicy(
        'mock_email',
        'inbox',
        'send',
        'user_123'
      );

      expect(result.denied).toBe(true);
      expect(result.policy?.policyId).toBe('deny_send');
      expect(result.policy?.auditLabel).toBe('email_send_blocked');
    });

    it('should enforce risk cap', () => {
      connectorPolicyStore.create({
        policyId: 'risk_cap_policy',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'allow',
        riskCap: 'medium',
      });

      const lowRiskResult = permissionEngine.checkConnectorPolicy(
        'mock_email',
        'inbox',
        'send',
        'user_123',
        'low'
      );
      expect(lowRiskResult.denied).toBe(false);

      const highRiskResult = permissionEngine.checkConnectorPolicy(
        'mock_email',
        'inbox',
        'send',
        'user_123',
        'high'
      );
      expect(highRiskResult.denied).toBe(true);
    });

    it('should enforce allowed scopes for write operations', () => {
      connectorPolicyStore.create({
        policyId: 'read_only_policy',
        connectorId: 'mock_docs',
        resourcePattern: '*',
        action: '*',
        effect: 'allow',
        allowedScopes: ['read'],
      });

      const readResult = permissionEngine.checkConnectorPolicy(
        'mock_docs',
        'document.txt',
        'read',
        'user_123'
      );
      expect(readResult.denied).toBe(false);

      const writeResult = permissionEngine.checkConnectorPolicy(
        'mock_docs',
        'document.txt',
        'write',
        'user_123'
      );
      expect(writeResult.denied).toBe(true);
    });
  });

  describe('PermissionEngine.checkPermission with connector policy', () => {
    it('should deny operation when connector policy denies', () => {
      connectorPolicyStore.create({
        policyId: 'deny_email_send',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'deny',
        auditLabel: 'email_send_blocked',
      });

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_email.send',
        operationType: 'execute',
        connectorId: 'mock_email',
        connectorResource: 'inbox',
        connectorAction: 'send',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
      expect(decision.policyRef).toBe('deny_email_send');
      expect(decision.auditLabel).toBe('email_send_blocked');
    });

    it('should emit audit event with policyRef when denied', () => {
      connectorPolicyStore.create({
        policyId: 'deny_policy_audit',
        connectorId: 'mock_calendar',
        resourcePattern: '*',
        action: 'create_event',
        effect: 'deny',
        auditLabel: 'calendar_create_blocked',
      });

      const context = createPermissionContext('user_123', 'sess_789', 'ask_on_write');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_calendar.create_event',
        operationType: 'execute',
        connectorId: 'mock_calendar',
        connectorResource: 'calendar',
        connectorAction: 'create_event',
      };

      permissionEngine.checkPermission(request);

      const events = eventStore.query({
        eventType: 'connector_policy_denied',
        userId: 'user_123',
      });

      expect(events.length).toBeGreaterThan(0);
      const payload = events[0].payload as Record<string, unknown>;
      expect(payload.policyRef).toBe('deny_policy_audit');
      expect(payload.auditLabel).toBe('calendar_create_blocked');
      expect(payload.connectorId).toBe('mock_calendar');
      expect(payload.connectorResource).toBe('calendar');
      expect(payload.connectorAction).toBe('create_event');
    });

    it('should not deny when connector policy allows', () => {
      connectorPolicyStore.create({
        policyId: 'allow_email_read',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'read',
        effect: 'allow',
      });

      const context = createPermissionContext('user_123', 'sess_456', 'ask_on_write');
      const request: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_email.read',
        operationType: 'read',
        connectorId: 'mock_email',
        connectorResource: 'inbox',
        connectorAction: 'read',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(true);
    });

    it('bypass grant cannot override connector hard deny', () => {
      connectorPolicyStore.create({
        policyId: 'hard_deny_send',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'deny',
        auditLabel: 'email_send_hard_deny',
      });

      const userId = 'user_with_bypass';
      grantStore.create({
        id: 'bypass_grant_001',
        userId,
        scope: 'session',
        action: '*',
        riskLevelMax: 'high',
      });

      const context = createPermissionContext(
        userId,
        'sess_bypass',
        'ask_on_write',
        grantStore.findActiveByUserAndScope(userId, 'session')
      );

      const request: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_email.send',
        operationType: 'execute',
        connectorId: 'mock_email',
        connectorResource: 'inbox',
        connectorAction: 'send',
        riskLevel: 'high',
      };

      const decision = permissionEngine.checkPermission(request);

      expect(decision.allowed).toBe(false);
      expect(decision.status).toBe('denied');
      expect(decision.policyRef).toBe('hard_deny_send');
      expect(decision.reason).toContain('Connector policy');
    });

    it('should allow read but require approval for high-risk write with allowed scopes', () => {
      connectorPolicyStore.create({
        policyId: 'scoped_access',
        connectorId: 'mock_docs',
        resourcePattern: '*',
        action: '*',
        effect: 'allow',
        allowedScopes: ['read'],
        riskCap: 'medium',
      });

      const context = createPermissionContext('user_123', 'sess_docs', 'ask_on_write');

      const readRequest: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_docs.read',
        operationType: 'read',
        connectorId: 'mock_docs',
        connectorResource: 'document.txt',
        connectorAction: 'read',
        riskLevel: 'low',
      };

      const readDecision = permissionEngine.checkPermission(readRequest);
      expect(readDecision.allowed).toBe(true);

      const writeRequest: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_docs.write',
        operationType: 'write',
        connectorId: 'mock_docs',
        connectorResource: 'document.txt',
        connectorAction: 'write',
        riskLevel: 'low',
      };

      const writeDecision = permissionEngine.checkPermission(writeRequest);
      expect(writeDecision.allowed).toBe(false);
    });

    it('should deny high-risk operation exceeding risk cap', () => {
      connectorPolicyStore.create({
        policyId: 'risk_limited',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'allow',
        riskCap: 'low',
      });

      const context = createPermissionContext('user_123', 'sess_risk', 'ask_on_write');

      const lowRiskRequest: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_email.send',
        operationType: 'execute',
        connectorId: 'mock_email',
        connectorResource: 'inbox',
        connectorAction: 'send',
        riskLevel: 'low',
      };

      const lowRiskDecision = permissionEngine.checkPermission(lowRiskRequest);
      expect(lowRiskDecision.allowed).toBe(true);

      const highRiskRequest: PermissionCheckRequest = {
        context,
        actionType: 'connector.mock_email.send',
        operationType: 'execute',
        connectorId: 'mock_email',
        connectorResource: 'inbox',
        connectorAction: 'send',
        riskLevel: 'high',
      };

      const highRiskDecision = permissionEngine.checkPermission(highRiskRequest);
      expect(highRiskDecision.allowed).toBe(false);
      expect(highRiskDecision.policyRef).toBe('risk_limited');
    });
  });

  describe('Policy management', () => {
    it('should delete a policy', () => {
      connectorPolicyStore.create({
        policyId: 'policy_to_delete',
        connectorId: 'mock_email',
        resourcePattern: '*',
        action: 'send',
        effect: 'deny',
      });

      expect(connectorPolicyStore.getById('policy_to_delete')).toBeDefined();

      connectorPolicyStore.delete('policy_to_delete');

      expect(connectorPolicyStore.getById('policy_to_delete')).toBeNull();
    });

    it('should update a policy', () => {
      connectorPolicyStore.create({
        policyId: 'policy_to_update',
        connectorId: 'mock_email',
        resourcePattern: 'inbox/*',
        action: 'send',
        effect: 'allow',
      });

      const updated = connectorPolicyStore.update('policy_to_update', {
        effect: 'deny',
        auditLabel: 'updated_to_deny',
      });

      expect(updated.effect).toBe('deny');
      expect(updated.auditLabel).toBe('updated_to_deny');

      const retrieved = connectorPolicyStore.getById('policy_to_update');
      expect(retrieved?.effect).toBe('deny');
    });
  });
});
