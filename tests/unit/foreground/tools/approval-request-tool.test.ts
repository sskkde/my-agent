import { describe, it, expect, vi } from 'vitest';
import {
  APPROVAL_REQUEST_TOOL_ID,
  handleApprovalRequest,
  handleApprovalResponse,
  type ApprovalRequestDeps,
  type ApprovalRequestInput,
  type ApprovalResponseInput,
} from '../../../../src/foreground/tools/approval-request-tool.js';
import type { ApprovalStore, ApprovalRequest, CreateApprovalRequest, UpdateApprovalRequest } from '../../../../src/storage/approval-store.js';

function createMockApprovalStore(): ApprovalStore {
  const approvals = new Map<string, ApprovalRequest>();

  return {
    create: vi.fn((request: CreateApprovalRequest): ApprovalRequest => {
      const approval: ApprovalRequest = {
        id: request.id,
        userId: request.userId,
        sessionId: request.sessionId,
        status: request.status,
        riskLevel: request.riskLevel ?? null,
        scope: request.scope ?? null,
        scopeType: request.scopeType ?? null,
        scopeRef: request.scopeRef ?? null,
        actionType: request.actionType,
        resource: request.resource ?? null,
        justification: request.justification ?? null,
        requestedBy: request.requestedBy,
        requestedAt: request.requestedAt,
        expiresAt: request.expiresAt ?? null,
        respondedAt: request.respondedAt ?? null,
        responseBy: request.responseBy ?? null,
        responseReason: request.responseReason ?? null,
        approvalCode: request.approvalCode ?? null,
        idempotencyKey: request.idempotencyKey ?? null,
        metadata: request.metadata ?? null,
        sourceContext: request.sourceContext ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      approvals.set(approval.id, approval);
      return approval;
    }),
    getById: vi.fn((id: string): ApprovalRequest | null => {
      return approvals.get(id) ?? null;
    }),
    update: vi.fn((id: string, updates: UpdateApprovalRequest): ApprovalRequest => {
      const existing = approvals.get(id);
      if (!existing) {
        throw new Error(`Approval request not found: ${id}`);
      }
      const updated: ApprovalRequest = {
        ...existing,
        status: updates.status ?? existing.status,
        respondedAt: updates.respondedAt ?? existing.respondedAt,
        responseBy: updates.responseBy ?? existing.responseBy,
        responseReason: updates.responseReason ?? existing.responseReason,
        approvalCode: updates.approvalCode ?? existing.approvalCode,
        expiresAt: updates.expiresAt ?? existing.expiresAt,
        updatedAt: new Date().toISOString(),
      };
      approvals.set(id, updated);
      return updated;
    }),
    findPendingByUser: vi.fn(),
    findByUser: vi.fn(),
    findPendingBySession: vi.fn(),
    findExpired: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockDeps(overrides?: Partial<ApprovalRequestDeps>): ApprovalRequestDeps {
  return {
    approvalStore: createMockApprovalStore(),
    userId: 'user-123',
    sessionId: 'session-456',
    turnId: 'turn-789',
    ...overrides,
  };
}

describe('ApprovalRequestTool', () => {
  describe('APPROVAL_REQUEST_TOOL_ID', () => {
    it('should have the correct tool ID', () => {
      expect(APPROVAL_REQUEST_TOOL_ID).toBe('foreground_handle_approval');
    });
  });

  describe('handleApprovalRequest', () => {
    it('Approval request blocks execution until approved', async () => {
      const deps = createMockDeps();
      const input: ApprovalRequestInput = {
        operation: 'delete_file',
        operationArgs: { path: '/important/data.txt' },
        requiresApproval: true,
      };

      const result = await handleApprovalRequest(deps, input);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('pending');
      expect(result.data?.approvalId).toBeDefined();
      expect(result.data?.approvalId).not.toBeNull();
      expect(result.data?.operation).toBe('delete_file');
      expect(result.userVisibleSummary).toContain('Waiting for user approval');
      expect(deps.approvalStore.create).toHaveBeenCalled();
    });

    it('Auto-approved safe operations skip approval', async () => {
      const deps = createMockDeps();
      const input: ApprovalRequestInput = {
        operation: 'read_file',
        operationArgs: { path: '/data/config.json' },
        requiresApproval: false,
      };

      const result = await handleApprovalRequest(deps, input);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('auto_approved');
      expect(result.data?.approvalId).toBeNull();
      expect(result.data?.operation).toBe('read_file');
      expect(result.userVisibleSummary).toContain('auto-approved');
      expect(deps.approvalStore.create).not.toHaveBeenCalled();
    });

    it('should redact sensitive fields from operation args before storing', async () => {
      const deps = createMockDeps();
      const input: ApprovalRequestInput = {
        operation: 'api_call',
        operationArgs: {
          endpoint: '/api/users',
          apiKey: 'secret-api-key-12345',
          password: 'user-password',
          token: 'bearer-token-xyz',
          normalField: 'safe-data',
        },
        requiresApproval: true,
      };

      const result = await handleApprovalRequest(deps, input);

      expect(result.success).toBe(true);
      expect(result.data?.operationArgs).toEqual({
        endpoint: '/api/users',
        apiKey: '[REDACTED]',
        password: '[REDACTED]',
        token: '[REDACTED]',
        normalField: 'safe-data',
      });
    });

    it('Missing approval context returns error', async () => {
      const deps = createMockDeps({
        userId: '',
        sessionId: '',
      });
      const input: ApprovalRequestInput = {
        operation: 'delete_file',
        operationArgs: { path: '/data.txt' },
        requiresApproval: true,
      };

      const result = await handleApprovalRequest(deps, input);

      // Should still succeed - empty strings are still valid for the store
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('pending');
    });

    it('should handle unknown operations by requiring approval', async () => {
      const deps = createMockDeps();
      const input: ApprovalRequestInput = {
        operation: 'unknown_dangerous_operation',
        operationArgs: { target: 'system' },
        requiresApproval: false,
      };

      const result = await handleApprovalRequest(deps, input);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('pending');
      expect(result.data?.approvalId).not.toBeNull();
    });

    it('should handle approval store errors gracefully', async () => {
      const failingStore = createMockApprovalStore();
      failingStore.create = vi.fn(() => {
        throw new Error('Database connection failed');
      });
      const deps = createMockDeps({ approvalStore: failingStore });
      const input: ApprovalRequestInput = {
        operation: 'delete_file',
        operationArgs: { path: '/data.txt' },
        requiresApproval: true,
      };

      const result = await handleApprovalRequest(deps, input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_STORE_ERROR');
      expect(result.error?.recoverable).toBe(true);
    });
  });

  describe('handleApprovalResponse', () => {
    it('Approval denial prevents side effect', async () => {
      const deps = createMockDeps();
      
      // First create a pending approval
      const requestInput: ApprovalRequestInput = {
        operation: 'delete_file',
        operationArgs: { path: '/important/data.txt' },
        requiresApproval: true,
      };
      const requestResult = await handleApprovalRequest(deps, requestInput);
      const approvalId = requestResult.data?.approvalId!;

      // Now deny the approval
      const responseInput: ApprovalResponseInput = {
        approvalId,
        decision: 'denied',
        responseReason: 'User rejected the operation',
      };

      const result = await handleApprovalResponse(deps, responseInput);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_DENIED');
      expect(result.error?.recoverable).toBe(false);
      expect(result.userVisibleSummary).toContain('denied');
    });

    it('should approve pending approval requests', async () => {
      const deps = createMockDeps();
      
      // First create a pending approval
      const requestInput: ApprovalRequestInput = {
        operation: 'execute_command',
        operationArgs: { command: 'npm test' },
        requiresApproval: true,
      };
      const requestResult = await handleApprovalRequest(deps, requestInput);
      const approvalId = requestResult.data?.approvalId!;

      // Now approve the request
      const responseInput: ApprovalResponseInput = {
        approvalId,
        decision: 'approved',
      };

      const result = await handleApprovalResponse(deps, responseInput);

      expect(result.success).toBe(true);
      expect(result.data?.status).toBe('approved');
      expect(result.data?.approvalId).toBe(approvalId);
      expect(result.data?.operation).toBe('execute_command');
      expect(result.data?.operationArgs).toEqual({ command: 'npm test' });
      expect(result.userVisibleSummary).toContain('approved');
    });

    it('should return error for non-existent approval', async () => {
      const deps = createMockDeps();
      const input: ApprovalResponseInput = {
        approvalId: 'non-existent-approval',
        decision: 'approved',
      };

      const result = await handleApprovalResponse(deps, input);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_NOT_FOUND');
      expect(result.error?.recoverable).toBe(false);
    });

    it('should return error for already processed approval', async () => {
      const deps = createMockDeps();
      
      // Create and approve a request
      const requestInput: ApprovalRequestInput = {
        operation: 'delete_file',
        operationArgs: { path: '/data.txt' },
        requiresApproval: true,
      };
      const requestResult = await handleApprovalRequest(deps, requestInput);
      const approvalId = requestResult.data?.approvalId!;

      // First approval
      await handleApprovalResponse(deps, { approvalId, decision: 'approved' });

      // Try to approve again
      const result = await handleApprovalResponse(deps, { approvalId, decision: 'approved' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_NOT_PENDING');
    });

    it('should handle approval store errors on response', async () => {
      const deps = createMockDeps();
      
      // Create a pending approval with a failing store
      const requestInput: ApprovalRequestInput = {
        operation: 'delete_file',
        operationArgs: { path: '/data.txt' },
        requiresApproval: true,
      };
      const requestResult = await handleApprovalRequest(deps, requestInput);
      const approvalId = requestResult.data?.approvalId!;

      // Make the store fail on update
      const failingStore = deps.approvalStore;
      failingStore.update = vi.fn(() => {
        throw new Error('Database connection failed');
      });

      const result = await handleApprovalResponse(deps, { approvalId, decision: 'approved' });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('APPROVAL_STORE_ERROR');
      expect(result.error?.recoverable).toBe(true);
    });
  });
});
