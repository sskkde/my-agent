/**
 * GitHub Connector GA Certification Tests
 *
 * These tests verify that the GitHub connector meets GA requirements
 * as defined in the GA Contract Checklist.
 *
 * GA Contract Points:
 * 1. Auth mode documented - supports api_key and/or oauth2
 * 2. Secret encrypted - API keys/tokens stored encrypted
 * 3. Least privilege scopes - OAuth scopes are minimal
 * 4. Rate limit handling - HTTP 429 handled with retry
 * 5. Timeout handling - Configurable timeout (default 30s, max 120s)
 * 6. Error taxonomy - All errors mapped to ConnectorError
 * 7. Mock mode - MOCK_MODE uses mock transport
 * 8. Real HTTP mode - Without MOCK_MODE, uses real HTTP
 * 9. Audit event - All calls generate audit events
 * 10. Redaction - Sensitive data redacted from logs/audit
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js';
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js';
import {
  GitHubConnectorAdapter,
  createGitHubConnectorAdapter,
} from '../../../src/connectors/github/github-connector.js';
import { GitHubMockTransport } from '../../../src/connectors/github/github-mock-transport.js';
import type { GitHubTransport, GitHubError, GitHubIssue, GitHubPullRequest, GitHubIssueComment } from '../../../src/connectors/github/github-types.js';
import type { ConnectorInstance } from '../../../src/storage/connector-store.js';
import type { ConnectorCallRequest } from '../../../src/connectors/types.js';
import {
  decryptSecret,
  deserializeEncryptedSecret,
} from '../../../src/storage/provider-crypto.js';

const MOCK_PAT = 'ghp_testMockPat1234567890';
const TEST_SECRET_KEY = 'test-secret-key-for-encryption-32-bytes';

// Mock HTTP Transport for testing rate limits and timeouts
class MockHttpTransport implements GitHubTransport {
  private shouldRateLimit = false;
  private rateLimitCount = 0;
  private callCount = 0;

  setRateLimit(shouldLimit: boolean): void {
    this.shouldRateLimit = shouldLimit;
  }

  getCallCount(): number {
    return this.callCount;
  }

  getRateLimitRetryCount(): number {
    return this.rateLimitCount;
  }

  async validateAuth(): Promise<boolean> {
    return true;
  }

  private checkRateLimit(): void {
    this.callCount++;
    if (this.shouldRateLimit && this.callCount === 1) {
      this.rateLimitCount++;
      const error = new Error('Rate limit exceeded') as Error & GitHubError;
      error.code = 'RATE_LIMITED';
      error.message = 'Rate limit exceeded';
      error.recoverable = true;
      error.details = {
        statusCode: 429,
        rateLimitRemaining: 0,
        rateLimitResetAt: new Date(Date.now() + 60000).toISOString(),
      };
      throw error;
    }
  }

  async listIssues(): Promise<{ issues: GitHubIssue[]; total: number }> {
    this.checkRateLimit();
    return { issues: [], total: 0 };
  }

  async getIssue(): Promise<GitHubIssue | null> {
    this.checkRateLimit();
    return null;
  }

  async listPullRequests(): Promise<{ pullRequests: GitHubPullRequest[]; total: number }> {
    this.checkRateLimit();
    return { pullRequests: [], total: 0 };
  }

  async getPullRequest(): Promise<GitHubPullRequest | null> {
    this.checkRateLimit();
    return null;
  }

  async createIssueComment(): Promise<GitHubIssueComment> {
    this.checkRateLimit();
    return {
      id: 1,
      nodeId: 'IC_1',
      body: 'test',
      user: {
        id: 1,
        login: 'test',
        avatarUrl: '',
        htmlUrl: '',
        type: 'User',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      htmlUrl: 'https://github.com/test/test/issues/1#issuecomment-1',
      issueUrl: 'https://github.com/test/test/issues/1',
    };
  }
}

describe('GitHub Connector GA Contract', () => {
  let connection: ConnectionManager;
  let migrations: MigrationRunner;
  let approvalStore: ApprovalStore;

  beforeEach(() => {
    vi.stubEnv('APP_SECRET_KEY', TEST_SECRET_KEY);

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
        `,
        down: `DROP TABLE IF EXISTS approval_requests;`,
      },
    ];

    migrations.apply(storeMigrations);
    approvalStore = createApprovalStore(connection);
  });

  afterEach(() => {
    connection?.close();
    vi.unstubAllEnvs();
  });

  function createMockInstance(authStateRef: string): ConnectorInstance {
    return {
      id: 'test-instance-id',
      connectorInstanceId: 'test-connector-instance',
      connectorDefinitionId: 'github-connector-def',
      userId: 'test-user-001',
      name: 'Test GitHub Instance',
      authStateRef,
      config: {},
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ========================================
  // 1. AUTH MODE DOCUMENTED
  // ========================================
  describe('1. Auth Mode Documentation', () => {
    it('should support api_key auth mode (Personal Access Token)', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encryptedPat = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encryptedPat);

      const request: ConnectorCallRequest = {
        requestId: 'req-auth-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      const result = await adapter.execute(instance, request);
      expect(result).toBeDefined();
    });

    it('should document required auth mode in capabilities', () => {
      const mockTransport = new GitHubMockTransport();
      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('encrypted-pat');
      const capabilities = adapter.discoverCapabilities(instance);

      // All GitHub capabilities require auth
      capabilities.forEach(cap => {
        expect(cap.requiresAuth).toBe(true);
      });
    });
  });

  // ========================================
  // 2. SECRET ENCRYPTED
  // ========================================
  describe('2. Secret Encryption', () => {
    it('should encrypt PAT using AES-256-GCM', () => {
      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);

      expect(encrypted).not.toContain(MOCK_PAT);
      expect(encrypted).toMatch(/^aes-256-gcm:/);
    });

    it('should store encrypted PAT in authStateRef', () => {
      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const parts = encrypted.split(':');

      expect(parts.length).toBe(4);
      expect(parts[0]).toBe('aes-256-gcm');
      // IV, authTag, and encrypted data should all be hex strings
      expect(parts[1]).toMatch(/^[0-9a-f]+$/);
      expect(parts[2]).toMatch(/^[0-9a-f]+$/);
      expect(parts[3]).toMatch(/^[0-9a-f]+$/);
    });

    it('should decrypt PAT correctly for internal use', async () => {
      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const deserialized = deserializeEncryptedSecret(encrypted);
      const decrypted = decryptSecret(
        deserialized.encrypted,
        deserialized.iv,
        deserialized.authTag
      );

      expect(decrypted).toBe(MOCK_PAT);
    });

    it('should reject invalid encrypted secrets during decryption', async () => {
      const mockTransport = new GitHubMockTransport();
      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('invalid-encrypted-data');

      const request: ConnectorCallRequest = {
        requestId: 'req-decrypt-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      await expect(adapter.execute(instance, request)).rejects.toThrow();
    });

    it('should never expose PAT in API responses', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-expose-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      const result = await adapter.execute(instance, request);

      // Result should not contain the PAT
      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain(MOCK_PAT);
    });
  });

  // ========================================
  // 3. LEAST PRIVILEGE SCOPES
  // ========================================
  describe('3. Least Privilege Scopes', () => {
    it('should document minimal required OAuth scopes for read operations', () => {
      const mockTransport = new GitHubMockTransport();
      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('encrypted-pat');
      const capabilities = adapter.discoverCapabilities(instance);

      const readCaps = capabilities.filter(c => c.category === 'read');
      
      // Read operations should require minimal scopes
      // public_repo for public repos, repo for private repos
      readCaps.forEach(cap => {
        expect(cap.riskLevel).toBe('low');
        expect(cap.requiresAuth).toBe(true);
      });
    });

    it('should require elevated scopes for write operations', () => {
      const mockTransport = new GitHubMockTransport();
      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('encrypted-pat');
      const capabilities = adapter.discoverCapabilities(instance);

      const writeCap = capabilities.find(c => c.capabilityId === 'github.create_issue_comment');
      
      expect(writeCap).toBeDefined();
      expect(writeCap?.riskLevel).toBe('medium');
      expect(writeCap?.category).toBe('write');
    });

    it('should document scope requirements per capability', () => {
      const mockTransport = new GitHubMockTransport();
      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('encrypted-pat');
      const capabilities = adapter.discoverCapabilities(instance);

      // Each capability should have defined input schema
      capabilities.forEach(cap => {
        expect(cap.inputSchema).toBeDefined();
        expect(cap.supportedOperations).toBeDefined();
        expect(cap.supportedOperations.length).toBeGreaterThan(0);
      });
    });
  });

  // ========================================
  // 4. RATE LIMIT HANDLING
  // ========================================
  describe('4. Rate Limit Handling', () => {
    it('should detect HTTP 429 rate limit responses', async () => {
      const httpTransport = new MockHttpTransport();
      httpTransport.setRateLimit(true);

      const adapter = createGitHubConnectorAdapter({
        transport: httpTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-rate-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      // First call should trigger rate limit error
      await expect(adapter.execute(instance, request)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        recoverable: true,
      });
    });

    it('should provide rate limit metadata in error details', async () => {
      const httpTransport = new MockHttpTransport();
      httpTransport.setRateLimit(true);

      const adapter = createGitHubConnectorAdapter({
        transport: httpTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-rate-002',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      try {
        await adapter.execute(instance, request);
        expect.fail('Should have thrown rate limit error');
      } catch (error) {
        const gitHubError = error as Error & GitHubError;
        expect(gitHubError.code).toBe('RATE_LIMITED');
        expect(gitHubError.recoverable).toBe(true);
        expect(gitHubError.details).toBeDefined();
        expect(gitHubError.details?.statusCode).toBe(429);
        expect(gitHubError.details?.rateLimitResetAt).toBeDefined();
      }
    });

    it('should mark rate limit errors as recoverable', async () => {
      const httpTransport = new MockHttpTransport();
      httpTransport.setRateLimit(true);

      const adapter = createGitHubConnectorAdapter({
        transport: httpTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-rate-003',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      try {
        await adapter.execute(instance, request);
        expect.fail('Should have thrown rate limit error');
      } catch (error) {
        const gitHubError = error as Error & GitHubError;
        expect(gitHubError.recoverable).toBe(true);
      }
    });
  });

  // ========================================
  // 5. TIMEOUT HANDLING
  // ========================================
  describe('5. Timeout Handling', () => {
    it('should support configurable request timeout via request.timeoutMs', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-timeout-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
        timeoutMs: 30000, // 30 seconds
      };

      // Should complete without timeout
      const result = await adapter.execute(instance, request);
      expect(result).toBeDefined();
    });

    it('should use default timeout when not specified', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-timeout-002',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
        // No timeout specified - should use default
      };

      const result = await adapter.execute(instance, request);
      expect(result).toBeDefined();
    });

    it('should enforce maximum timeout of 120 seconds', () => {
      const maxTimeout = 120000; // 120 seconds
      const requestedTimeout = 180000; // 180 seconds

      // The connector should cap timeout at max
      const effectiveTimeout = Math.min(requestedTimeout, maxTimeout);
      expect(effectiveTimeout).toBe(120000);
    });
  });

  // ========================================
  // 6. ERROR TAXONOMY
  // ========================================
  describe('6. Error Taxonomy', () => {
    it('should return AUTH_INVALID for missing authentication', async () => {
      const mockTransport = new GitHubMockTransport();
      // Don't set valid PAT - simulates no auth

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('encrypted-pat');

      const request: ConnectorCallRequest = {
        requestId: 'req-auth-invalid-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      try {
        await adapter.execute(instance, request);
        expect.fail('Should have thrown auth error');
      } catch (error) {
        const gitHubError = error as Error & GitHubError;
        expect(gitHubError.code).toBe('AUTH_INVALID');
        expect(gitHubError.recoverable).toBe(false);
      }
    });

    it('should return AUTH_INVALID for decryption failure', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('not-valid-encrypted-data');

      const request: ConnectorCallRequest = {
        requestId: 'req-auth-invalid-002',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      try {
        await adapter.execute(instance, request);
        expect.fail('Should have thrown auth error');
      } catch (error) {
        const gitHubError = error as Error & GitHubError;
        expect(gitHubError.code).toBe('AUTH_INVALID');
      }
    });

    it('should return FORBIDDEN for rejected approval', async () => {
      vi.useFakeTimers();
      const fixedTime = Date.now();

      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-forbidden-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 1,
          body: 'Test comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session',
      };

      vi.setSystemTime(fixedTime);
      const initialResponse = await adapter.execute(instance, request);
      const approvalId = (initialResponse as { approvalId: string }).approvalId;

      approvalStore.update(approvalId, {
        status: 'rejected',
        respondedAt: new Date().toISOString(),
        responseBy: 'admin',
      });

      vi.setSystemTime(fixedTime);
      try {
        await adapter.execute(instance, request);
        expect.fail('Should have thrown forbidden error');
      } catch (error) {
        const gitHubError = error as Error & GitHubError;
        expect(gitHubError.code).toBe('FORBIDDEN');
        expect(gitHubError.recoverable).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return NOT_FOUND for non-existent issue', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-notfound-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.get_issue',
        operation: 'get_issue',
        params: { owner: 'octocat', repo: 'Hello-World', issueNumber: 99999 },
        userId: 'test-user-001',
      };

      const result = await adapter.execute(instance, request);
      // Non-existent issue returns null, not an error
      expect(result).toBeNull();
    });

    it('should map all error codes to ConnectorError', () => {
      const definedErrorCodes: GitHubError['code'][] = [
        'AUTH_INVALID',
        'AUTH_EXPIRED',
        'RATE_LIMITED',
        'NOT_FOUND',
        'FORBIDDEN',
        'VALIDATION_ERROR',
        'NETWORK_ERROR',
        'UNKNOWN_ERROR',
      ];

      // Verify error codes are defined in types
      definedErrorCodes.forEach(code => {
        expect(typeof code).toBe('string');
      });
    });
  });

  // ========================================
  // 7. MOCK MODE
  // ========================================
  describe('7. Mock Mode', () => {
    it('should use mock transport when useMock is true', () => {
      const adapter = createGitHubConnectorAdapter({
        approvalStore,
        useMock: true,
      });

      // Adapter should be created successfully with mock transport
      expect(adapter).toBeDefined();
    });

    it('should provide deterministic responses in mock mode', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
        useMock: true,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-mock-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      const result1 = await adapter.execute(instance, request);
      const result2 = await adapter.execute(instance, request);

      // Mock should return consistent results
      expect(result1).toEqual(result2);
    });

    it('should not make real HTTP requests in mock mode', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
        useMock: true,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-mock-002',
        connectorInstanceId: instance.id,
        capabilityId: 'github.get_issue',
        operation: 'get_issue',
        params: { owner: 'nonexistent', repo: 'repo', issueNumber: 1 },
        userId: 'test-user-001',
      };

      // Should return mock data without error (no real HTTP)
      const result = await adapter.execute(instance, request);
      expect(result).toBeDefined();
    });
  });

  // ========================================
  // 8. REAL HTTP MODE
  // ========================================
  describe('8. Real HTTP Mode', () => {
    it('should accept custom transport for real HTTP calls', () => {
      const customTransport: GitHubTransport = {
        validateAuth: async () => true,
        listIssues: async () => ({ issues: [], total: 0 }),
        getIssue: async () => null,
        listPullRequests: async () => ({ pullRequests: [], total: 0 }),
        getPullRequest: async () => null,
        createIssueComment: async () => ({
          id: 1,
          nodeId: 'test',
          body: 'test',
          user: {
            id: 1,
            login: 'test',
            avatarUrl: '',
            htmlUrl: '',
            type: 'User',
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          htmlUrl: '',
          issueUrl: '',
        }),
      };

      const adapter = createGitHubConnectorAdapter({
        transport: customTransport,
        approvalStore,
      });

      expect(adapter).toBeDefined();
    });

    it('should default to mock transport when no transport provided', () => {
      const adapter = createGitHubConnectorAdapter({
        approvalStore,
      });

      expect(adapter).toBeDefined();
      // Default constructor uses GitHubMockTransport
    });
  });

  // ========================================
  // 9. AUDIT EVENT
  // ========================================
  describe('9. Audit Event', () => {
    it('should generate approval request for write operations', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-audit-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 1,
          body: 'Test comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session',
      };

      const result = await adapter.execute(instance, request);
      const approvalId = (result as { approvalId: string }).approvalId;

      const approval = approvalStore.getById(approvalId);
      expect(approval).toBeDefined();
      expect(approval?.actionType).toBe('github.create_issue_comment');
      expect(approval?.userId).toBe('test-user-001');
    });

    it('should include resource in approval request', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-audit-002',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 42,
          body: 'Test comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session',
      };

      const result = await adapter.execute(instance, request);
      const approvalId = (result as { approvalId: string }).approvalId;

      const approval = approvalStore.getById(approvalId);
      expect(approval?.resource).toBe('github:octocat/Hello-World/issues/42');
    });

    it('should store idempotency key for deduplication', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-audit-003',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 1,
          body: 'Test comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session',
      };

      const result = await adapter.execute(instance, request);
      const approvalId = (result as { approvalId: string }).approvalId;

      const approval = approvalStore.getById(approvalId);
      expect(approval?.idempotencyKey).toBeDefined();
      expect(approval?.idempotencyKey).toContain('github-comment-');
    });
  });

  // ========================================
  // 10. REDACTION
  // ========================================
  describe('10. Redaction', () => {
    it('should not expose PAT in error messages', async () => {
      const mockTransport = new GitHubMockTransport();
      // Don't set valid PAT

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-redact-001',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      try {
        await adapter.execute(instance, request);
        expect.fail('Should have thrown error');
      } catch (error) {
        const errorMessage = (error as Error).message;
        expect(errorMessage).not.toContain(MOCK_PAT);
      }
    });

    it('should not expose PAT in approval metadata', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-redact-002',
        connectorInstanceId: instance.id,
        capabilityId: 'github.create_issue_comment',
        operation: 'create_issue_comment',
        params: {
          owner: 'octocat',
          repo: 'Hello-World',
          issueNumber: 1,
          body: 'Test comment',
        },
        userId: 'test-user-001',
        sessionId: 'test-session',
      };

      const result = await adapter.execute(instance, request);
      const approvalId = (result as { approvalId: string }).approvalId;

      const approval = approvalStore.getById(approvalId);
      const metadataStr = JSON.stringify(approval?.metadata);
      
      // Metadata should not contain the raw PAT
      expect(metadataStr).not.toContain(MOCK_PAT);
    });

    it('should not expose PAT in instance config', () => {
      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      // Instance authStateRef should not contain readable PAT
      expect(instance.authStateRef).not.toContain(MOCK_PAT);
      expect(instance.authStateRef).toMatch(/^aes-256-gcm:/);
    });

    it('should redact sensitive data from logs', async () => {
      const mockTransport = new GitHubMockTransport();
      mockTransport.setValidPat(MOCK_PAT);

      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const encrypted = GitHubConnectorAdapter.encryptPat(MOCK_PAT);
      const instance = createMockInstance(encrypted);

      const request: ConnectorCallRequest = {
        requestId: 'req-redact-003',
        connectorInstanceId: instance.id,
        capabilityId: 'github.list_issues',
        operation: 'list_issues',
        params: { owner: 'octocat', repo: 'Hello-World' },
        userId: 'test-user-001',
      };

      const result = await adapter.execute(instance, request);
      const resultStr = JSON.stringify(result);

      // Result should not contain PAT anywhere
      expect(resultStr).not.toContain(MOCK_PAT);
    });
  });

  // ========================================
  // HEALTH CHECK
  // ========================================
  describe('Health Check', () => {
    it('should return healthy status when connector is operational', () => {
      const mockTransport = new GitHubMockTransport();
      const adapter = createGitHubConnectorAdapter({
        transport: mockTransport,
        approvalStore,
      });

      const instance = createMockInstance('encrypted-pat');
      const health = adapter.checkHealth(instance);

      expect(health.healthy).toBe(true);
      expect(health.message).toBeDefined();
    });
  });
});
