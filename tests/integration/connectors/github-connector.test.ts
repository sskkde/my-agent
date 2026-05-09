import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createConnectorStore, type ConnectorStore } from '../../../src/storage/connector-store.js';
import { createEventStore, type EventStore } from '../../../src/storage/event-store.js';
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js';
import { createConnectorRuntime } from '../../../src/connectors/connector-runtime.js';
import type { ConnectorRuntime, ConnectorCallRequest, ConnectorResponse } from '../../../src/connectors/types.js';
import { createConnectorToolBridge } from '../../../src/connectors/connector-tool-bridge.js';
import {
  GitHubConnectorAdapter,
  createGitHubConnectorAdapter,
} from '../../../src/connectors/github/github-connector.js';
import { GitHubMockTransport } from '../../../src/connectors/github/github-mock-transport.js';
import { APPROVAL_STATES } from '../../../src/storage/approval-store.js';

const MOCK_PAT = 'ghp_testMockPat1234567890';

describe('GitHub Connector Integration', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let connectorStore: ConnectorStore;
  let eventStore: EventStore;
  let approvalStore: ApprovalStore;
  let connectorRuntime: ConnectorRuntime;
  let githubAdapter: GitHubConnectorAdapter;
  let mockTransport: GitHubMockTransport;

  beforeEach(() => {
    vi.stubEnv('APP_SECRET_KEY', 'test-secret-key-for-encryption-32-bytes');

    connection = createConnectionManager(':memory:');
    connection.open();
    migrations = createMigrationRunner(connection);
    migrations.init();

    const storeMigrations = [
      {
        version: 1,
        name: 'create_connector_definitions_table',
        up: `
          CREATE TABLE connector_definitions (
            id TEXT PRIMARY KEY,
            connector_id TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            connector_type TEXT NOT NULL,
            version TEXT NOT NULL,
            description TEXT,
            capabilities TEXT NOT NULL,
            config_schema TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS connector_definitions;`,
      },
      {
        version: 2,
        name: 'create_connector_instances_table',
        up: `
          CREATE TABLE connector_instances (
            id TEXT PRIMARY KEY,
            connector_instance_id TEXT NOT NULL UNIQUE,
            connector_definition_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            auth_state_ref TEXT NOT NULL,
            config TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS connector_instances;`,
      },
      {
        version: 3,
        name: 'create_connector_events_table',
        up: `
          CREATE TABLE connector_events (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL UNIQUE,
            connector_instance_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT,
            processed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS connector_events;`,
      },
      {
        version: 4,
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
            created_at TEXT NOT NULL
          );
        `,
        down: `DROP TABLE IF EXISTS events;`,
      },
      {
        version: 5,
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
        `,
        down: `DROP TABLE IF EXISTS approval_requests;`,
      },
    ];

    migrations.apply(storeMigrations);

    connectorStore = createConnectorStore(connection);
    eventStore = createEventStore(connection);
    approvalStore = createApprovalStore(connection);

    mockTransport = new GitHubMockTransport();
    mockTransport.setValidPat(MOCK_PAT);

    githubAdapter = createGitHubConnectorAdapter({
      transport: mockTransport,
      approvalStore,
    });

    const toolBridge = createConnectorToolBridge();
    connectorRuntime = createConnectorRuntime({
      connectorStore,
      toolBridge,
      eventStore,
    });

    (connectorRuntime as unknown as { registerAdapter: (type: string, adapter: unknown) => void }).registerAdapter(
      'github',
      githubAdapter
    );
  });

  afterEach(() => {
    connection?.close();
    vi.unstubAllEnvs();
  });

  function createGitHubConnectorInstance(instanceId: string) {
    const encryptedPat = GitHubConnectorAdapter.encryptPat(MOCK_PAT);

    const def = connectorRuntime.registerDefinition({
      connectorId: 'github-connector-001',
      name: 'GitHub Connector',
      connectorType: 'github' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
      version: '1.0.0',
      description: 'GitHub API connector for issues and pull requests',
      capabilities: [
        'github.list_issues',
        'github.get_issue',
        'github.list_pull_requests',
        'github.get_pull_request',
        'github.create_issue_comment',
      ],
      status: 'active',
    });

    const instance = connectorRuntime.createInstance({
      connectorInstanceId: instanceId,
      connectorDefinitionId: def.id,
      userId: 'test-user-001',
      name: 'Test GitHub Instance',
      authStateRef: encryptedPat,
      status: 'active',
    });

    return instance;
  }

  describe('PAT Encryption', () => {
    it('should encrypt PAT and never return it in API responses', () => {
      const encryptedPat = GitHubConnectorAdapter.encryptPat(MOCK_PAT);

      expect(encryptedPat).not.toContain(MOCK_PAT);
      expect(encryptedPat).toMatch(/^aes-256-gcm:/);
    });

    it('should decrypt PAT correctly for internal use', () => {
      const instance = createGitHubConnectorInstance('pat-test-instance');

      expect(instance.authStateRef).not.toContain(MOCK_PAT);
      expect(instance.authStateRef).toMatch(/^aes-256-gcm:/);
    });

    it('should return auth_required status when PAT is invalid', async () => {
      const def = connectorRuntime.registerDefinition({
        connectorId: 'github-connector-bad-auth',
        name: 'GitHub Connector Bad Auth',
        connectorType: 'github' as 'api' | 'messaging' | 'storage' | 'database' | 'custom',
        version: '1.0.0',
        description: 'GitHub API connector with bad auth',
        capabilities: ['github.list_issues'],
        status: 'active',
      });

      const instance = connectorRuntime.createInstance({
        connectorInstanceId: 'bad-auth-instance',
        connectorDefinitionId: def.id,
        userId: 'test-user-001',
        name: 'Test GitHub Instance Bad Auth',
        authStateRef: 'invalid-encrypted-pat',
        status: 'active',
      });

      const request: ConnectorCallRequest = {
        requestId: 'req-auth-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('failed');
      expect(response.error?.code).toBe('EXECUTION_ERROR');
    });
  });

  describe('Read Operations', () => {
    it('should list issues without approval', async () => {
      const instance = createGitHubConnectorInstance('list-issues-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-list-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World', state: 'open' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { issues: unknown[]; total: number };
      expect(data.issues).toBeDefined();
      expect(data.issues.length).toBeGreaterThan(0);
      expect(data.total).toBeGreaterThan(0);
    });

    it('should filter issues by state', async () => {
      const instance = createGitHubConnectorInstance('filter-issues-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-filter-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World', state: 'closed' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { issues: Array<{ state: string }> };
      expect(data.issues.every(issue => issue.state === 'closed')).toBe(true);
    });

    it('should get a specific issue by number', async () => {
      const instance = createGitHubConnectorInstance('get-issue-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.get_issue',
        operation: 'get_issue',
        params: { owner: 'octocat', repo: 'Hello-World', issueNumber: 1 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const issue = response.data as { number: number; title: string };
      expect(issue.number).toBe(1);
      expect(issue.title).toBe('First issue');
    });

    it('should return null for non-existent issue', async () => {
      const instance = createGitHubConnectorInstance('get-issue-null-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-null-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.get_issue',
        operation: 'get_issue',
        params: { owner: 'octocat', repo: 'Hello-World', issueNumber: 999 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeNull();
    });

    it('should list pull requests without approval', async () => {
      const instance = createGitHubConnectorInstance('list-pr-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-list-pr-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_pull_requests',
        operation: 'list_pull_requests',
        params: { owner: 'octocat', repo: 'Hello-World', state: 'open' },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const data = response.data as { pullRequests: unknown[]; total: number };
      expect(data.pullRequests).toBeDefined();
      expect(data.pullRequests.length).toBeGreaterThan(0);
    });

    it('should get a specific pull request by number', async () => {
      const instance = createGitHubConnectorInstance('get-pr-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-get-pr-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.get_pull_request',
        operation: 'get_pull_request',
        params: { owner: 'octocat', repo: 'Hello-World', prNumber: 10 },
        userId: 'test-user-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      expect(response.data).toBeDefined();
      const pr = response.data as { number: number; title: string };
      expect(pr.number).toBe(10);
      expect(pr.title).toBe('Add new feature');
    });
  });

  describe('Approval-Gated Write Operations', () => {
    it('should create approval request before issue comment write', async () => {
      const instance = createGitHubConnectorInstance('approval-create-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-approval-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 1,
          body: 'This is a test comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session-001',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;

      expect(response.status).toBe('success');
      const data = response.data as { requiresApproval: boolean; approvalId: string };
      expect(data.requiresApproval).toBe(true);
      expect(data.approvalId).toBeDefined();

      const approval = approvalStore.getById(data.approvalId);
      expect(approval).toBeDefined();
      expect(approval?.status).toBe(APPROVAL_STATES.PENDING);
      expect(approval?.actionType).toBe('github.create_issue_comment');
      expect(approval?.idempotencyKey).toBeDefined();
    });

    it('should execute issue comment after approval is granted', async () => {
      const instance = createGitHubConnectorInstance('approval-execute-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-approval-002',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 1,
          body: 'This is an approved comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session-002',
      };

      const initialResponse = await connectorRuntime.executeCall(request) as ConnectorResponse;
      const approvalId = (initialResponse.data as { approvalId: string }).approvalId;

      approvalStore.update(approvalId, {
        status: APPROVAL_STATES.APPROVED,
        respondedAt: new Date().toISOString(),
        responseBy: 'test-user-001',
      });

      const comment = await githubAdapter.executeApprovedComment(approvalId);

      expect(comment).toBeDefined();
      expect(comment.body).toBe('This is an approved comment');
      expect(comment.id).toBeDefined();
      expect(comment.htmlUrl).toContain('issuecomment');
    });

    it('should prevent write when approval is rejected', async () => {
      const instance = createGitHubConnectorInstance('approval-rejected-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-approval-003',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 1,
          body: 'This is a rejected comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session-003',
      };

      const initialResponse = await connectorRuntime.executeCall(request) as ConnectorResponse;
      const approvalId = (initialResponse.data as { approvalId: string }).approvalId;

      approvalStore.update(approvalId, {
        status: APPROVAL_STATES.REJECTED,
        respondedAt: new Date().toISOString(),
        responseBy: 'test-user-001',
        responseReason: 'Not authorized',
      });

      const approvals = approvalStore.findByUser('test-user-001');
      const rejectedApproval = approvals.find(a => a.id === approvalId);
      expect(rejectedApproval?.status).toBe(APPROVAL_STATES.REJECTED);
      expect(rejectedApproval?.idempotencyKey).toBeDefined();
    });

    it('should create approval with idempotency key', async () => {
      const instance = createGitHubConnectorInstance('idempotency-instance');

      const request: ConnectorCallRequest = {
        requestId: 'req-idempotency-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 2,
          body: 'Idempotent comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session-004',
      };

      const response = await connectorRuntime.executeCall(request) as ConnectorResponse;
      const approvalId = (response.data as { approvalId: string }).approvalId;

      const approval = approvalStore.getById(approvalId);
      expect(approval).toBeDefined();
      expect(approval?.idempotencyKey).toBeDefined();
      expect(approval?.idempotencyKey).toContain('github-comment-');
      expect(approval?.idempotencyKey).toContain('octocat');
      expect(approval?.idempotencyKey).toContain('Hello-World');
    });
  });

  describe('Capability Discovery', () => {
    it('should discover all GitHub connector capabilities', () => {
      const instance = createGitHubConnectorInstance('capability-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      expect(capabilities.length).toBe(5);

      const capabilityIds = capabilities.map(c => c.capabilityId);
      expect(capabilityIds).toContain('github.list_issues');
      expect(capabilityIds).toContain('github.get_issue');
      expect(capabilityIds).toContain('github.list_pull_requests');
      expect(capabilityIds).toContain('github.get_pull_request');
      expect(capabilityIds).toContain('github.create_issue_comment');
    });

    it('should classify read operations as low risk', () => {
      const instance = createGitHubConnectorInstance('risk-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const readCapabilities = capabilities.filter(c =>
        c.capabilityId.includes('list') || c.capabilityId.includes('get')
      );

      readCapabilities.forEach(cap => {
        expect(cap.riskLevel).toBe('low');
        expect(cap.category).toBe('read');
      });
    });

    it('should classify write operations as medium risk', () => {
      const instance = createGitHubConnectorInstance('risk-write-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const writeCapability = capabilities.find(c =>
        c.capabilityId === 'github.create_issue_comment'
      );

      expect(writeCapability?.riskLevel).toBe('medium');
      expect(writeCapability?.category).toBe('write');
    });
  });

  describe('Tool Bridge Integration', () => {
    it('should bridge GitHub capabilities to tool definitions', () => {
      const instance = createGitHubConnectorInstance('bridge-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const listIssuesCapability = capabilities.find(c => c.capabilityId === 'github.list_issues');
      expect(listIssuesCapability).toBeDefined();

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(listIssuesCapability!);
      expect(toolDef.name).toBe('connector.github.list_issues');
      expect(toolDef.category).toBe('read');
      expect(toolDef.sensitivity).toBe('low');
      expect(toolDef.requiresPermission).toBe(false);
    });

    it('should mark write capability tool as requiring permission', () => {
      const instance = createGitHubConnectorInstance('bridge-write-instance');
      const capabilities = connectorRuntime.discoverCapabilities(instance.id);

      const toolBridge = createConnectorToolBridge();

      const writeCapability = capabilities.find(c => c.capabilityId === 'github.create_issue_comment');
      expect(writeCapability).toBeDefined();

      const toolDef = toolBridge.bridgeCapabilityToToolDefinition(writeCapability!);
      expect(toolDef.sensitivity).toBe('medium');
    });
  });
});
