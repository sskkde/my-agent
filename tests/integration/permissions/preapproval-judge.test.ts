import { describe, it, expect, beforeEach } from 'vitest';
import { createConnectionManager } from '../../../src/storage/connection.js';
import { createPermissionGrantStore } from '../../../src/storage/permission-grant-store.js';
import { createApprovalStore } from '../../../src/storage/approval-store.js';
import { createEventStore } from '../../../src/storage/event-store.js';
import { createConnectorPolicyStore } from '../../../src/storage/connector-policy-store.js';
import { createPermissionEngine, type PermissionEngineDeps } from '../../../src/permissions/permission-engine.js';
import {
  createPermissionContext,
  type PermissionCheckRequest,
} from '../../../src/permissions/types.js';
import { MockPreApprovalJudge } from '../../../src/permissions/pre-approval-judge.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';

describe('Pre-Approval Judge Integration', () => {
  let connection: ReturnType<typeof createConnectionManager>;
  let grantStore: ReturnType<typeof createPermissionGrantStore>;
  let approvalStore: ReturnType<typeof createApprovalStore>;
  let eventStore: ReturnType<typeof createEventStore>;
  let connectorPolicyStore: ReturnType<typeof createConnectorPolicyStore>;
  let mockJudge: MockPreApprovalJudge;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();
    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);
    grantStore = createPermissionGrantStore(connection);
    approvalStore = createApprovalStore(connection);
    eventStore = createEventStore(connection);
    connectorPolicyStore = createConnectorPolicyStore(connection);
    mockJudge = new MockPreApprovalJudge();
  });

  describe('advisory recommendations', () => {
    it('allows operation when judge recommends allow', async () => {
      mockJudge.setOverride('execute_tool:*:execute', {
        recommended: 'allow',
        confidence: 0.9,
        reason: 'Safe operation',
      });

      const deps: PermissionEngineDeps = {
        approvalStore,
        grantStore,
        eventStore,
        preApprovalJudge: mockJudge,
      };
      const engine = createPermissionEngine(deps);

      const userId = 'user-001';
      const sessionId = 'session-001';
      const context = createPermissionContext(userId, sessionId, 'ask_on_write', []);

      const request: PermissionCheckRequest = {
        context,
        actionType: 'execute_tool',
        resource: 'tool:safe_action',
        operationType: 'execute',
      };

      const decision = await engine.checkPermissionWithJudge!(request);
      expect(decision.status).toBe('requires_approval');
    });

    it('denies operation when judge recommends deny with high confidence for read operation', async () => {
      mockJudge.setOverride('read_data:tool:risky_action:read', {
        recommended: 'deny',
        confidence: 0.9,
        reason: 'Risky operation detected',
      });

      const deps: PermissionEngineDeps = {
        approvalStore,
        grantStore,
        eventStore,
        preApprovalJudge: mockJudge,
      };
      const engine = createPermissionEngine(deps);

      const userId = 'user-001';
      const sessionId = 'session-001';
      const context = createPermissionContext(userId, sessionId, 'read_only', []);

      const request: PermissionCheckRequest = {
        context,
        actionType: 'read_data',
        resource: 'tool:risky_action',
        operationType: 'read',
      };

      const decision = await engine.checkPermissionWithJudge!(request);
      expect(decision.status).toBe('denied');
      expect(decision.reason).toContain('Risky operation detected');
    });

    it('does not deny when judge confidence is low', async () => {
      mockJudge.setOverride('execute_tool:*:execute', {
        recommended: 'deny',
        confidence: 0.5,
        reason: 'Uncertain risk',
      });

      const deps: PermissionEngineDeps = {
        approvalStore,
        grantStore,
        eventStore,
        preApprovalJudge: mockJudge,
      };
      const engine = createPermissionEngine(deps);

      const userId = 'user-001';
      const sessionId = 'session-001';
      const context = createPermissionContext(userId, sessionId, 'ask_on_write', []);

      const request: PermissionCheckRequest = {
        context,
        actionType: 'execute_tool',
        resource: 'tool:uncertain_action',
        operationType: 'execute',
      };

      const decision = await engine.checkPermissionWithJudge!(request);
      expect(decision.status).toBe('requires_approval');
    });
  });

  describe('hard deny wins over judge', () => {
    it('denies operation even when judge recommends allow if connector policy denies', async () => {
      const connectorId = 'mock_email';

      connectorPolicyStore.create({
        policyId: 'policy-001',
        connectorId,
        resourcePattern: '*',
        action: '*',
        effect: 'deny',
        userId: undefined,
      });

      mockJudge.setOverride('execute_tool:*:execute', {
        recommended: 'allow',
        confidence: 1.0,
        reason: 'Safe operation',
      });

      const deps: PermissionEngineDeps = {
        approvalStore,
        grantStore,
        eventStore,
        connectorPolicyStore,
        preApprovalJudge: mockJudge,
      };
      const engine = createPermissionEngine(deps);

      const userId = 'user-001';
      const sessionId = 'session-001';
      const context = createPermissionContext(userId, sessionId, 'ask_on_write', []);

      const request: PermissionCheckRequest = {
        context,
        actionType: 'execute_tool',
        resource: 'connector:email',
        operationType: 'execute',
        connectorId,
        connectorResource: 'email',
        connectorAction: 'send',
      };

      const decision = await engine.checkPermissionWithJudge!(request);
      expect(decision.status).toBe('denied');
      expect(decision.reason).toContain('Connector policy');
    });

    it('denies operation even when judge recommends allow if hard_deny mode is set', async () => {
      mockJudge.setOverride('execute_tool:*:execute', {
        recommended: 'allow',
        confidence: 1.0,
        reason: 'Safe operation',
      });

      const deps: PermissionEngineDeps = {
        approvalStore,
        grantStore,
        eventStore,
        preApprovalJudge: mockJudge,
      };
      const engine = createPermissionEngine(deps);

      const userId = 'user-001';
      const sessionId = 'session-001';
      const context = createPermissionContext(userId, sessionId, 'hard_deny', []);

      const request: PermissionCheckRequest = {
        context,
        actionType: 'execute_tool',
        resource: 'tool:any_action',
        operationType: 'execute',
      };

      const decision = await engine.checkPermissionWithJudge!(request);
      expect(decision.status).toBe('denied');
      expect(decision.reason).toContain('hard_deny');
    });
  });

  describe('without pre-approval judge', () => {
    it('works normally without pre-approval judge', async () => {
      const deps: PermissionEngineDeps = {
        approvalStore,
        grantStore,
        eventStore,
      };
      const engine = createPermissionEngine(deps);

      const userId = 'user-001';
      const sessionId = 'session-001';
      const context = createPermissionContext(userId, sessionId, 'ask_on_write', []);

      const request: PermissionCheckRequest = {
        context,
        actionType: 'execute_tool',
        resource: 'tool:some_action',
        operationType: 'execute',
      };

      const decision = engine.checkPermission(request);
      expect(decision.status).toBe('requires_approval');
    });
  });
});
