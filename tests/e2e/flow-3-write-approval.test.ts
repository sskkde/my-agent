import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createE2EHarness, type E2EHarness } from './test-harness.js';
import type { ToolDefinition } from '../../src/tools/types.js';
import type { PermissionContext } from '../../src/permissions/types.js';

describe('Flow 3: Write Tool with Approval', () => {
  let harness: E2EHarness;

  const mockWriteTool: ToolDefinition = {
    name: 'writeFile',
    description: 'Writes content to a file',
    category: 'write',
    sensitivity: 'high',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
    handler: async (params) => {
      return {
        success: true,
        data: { written: true, path: (params as { path: string }).path },
        resultPreview: `File written to ${(params as { path: string }).path}`,
      };
    },
  };

  beforeEach(() => {
    harness = createE2EHarness();
    harness.registerTool(mockWriteTool);
  });

  afterEach(() => {
    harness.close();
  });

  it('should create ApprovalRequest when write tool is triggered', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    const result = await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('PERMISSION_DENIED');

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    expect(pendingApprovals.length).toBeGreaterThan(0);

    const approval = pendingApprovals[0];
    expect(approval).toBeDefined();
    expect(approval.actionType).toBe('tool:writeFile');
    expect(approval.status).toBe('pending');
    expect(approval.userId).toBe(userId);
    expect(approval.sessionId).toBe(sessionId);
  });

  it('should have ApprovalRequest in pending state before approval', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    expect(pendingApprovals.length).toBe(1);

    const approval = pendingApprovals[0];
    expect(approval.status).toBe('pending');
    expect(approval.respondedAt).toBeNull();
    expect(approval.responseBy).toBeNull();
  });

  it('should execute tool after approval is granted', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    const approvalId = pendingApprovals[0].id;

    const approvalResult = await harness.sendApprovalResponse(userId, sessionId, approvalId, true);

    expect(approvalResult.success).toBe(true);
    expect(approvalResult.approvalId).toBe(approvalId);
    expect(approvalResult.toolExecution).toBeDefined();
    expect(['completed', 'failed']).toContain(approvalResult.toolExecution?.status);
  });

  it('should update ApprovalRequest to approved status', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    const approvalId = pendingApprovals[0].id;

    await harness.sendApprovalResponse(userId, sessionId, approvalId, true);

    const updatedApproval = harness.stores.approvalStore.getById(approvalId);
    expect(updatedApproval).toBeDefined();
    expect(updatedApproval?.status).toBe('approved');
    expect(updatedApproval?.respondedAt).toBeDefined();
    expect(updatedApproval?.responseBy).toBe(userId);
  });

  it('should create ToolExecutionResult after approval', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    const approvalId = pendingApprovals[0].id;

    const approvalResult = await harness.sendApprovalResponse(userId, sessionId, approvalId, true);

    expect(approvalResult.toolExecution).toBeDefined();
    expect(approvalResult.toolExecution?.toolName).toBe('writeFile');

    const toolExecutions = harness.stores.toolExecutionStore.getBySession(sessionId);
    expect(toolExecutions.length).toBeGreaterThan(0);

    const terminalExecutions = toolExecutions.filter(te =>
      te.status === 'completed' || te.status === 'failed' || te.status === 'denied'
    );
    expect(terminalExecutions.length).toBeGreaterThan(0);
  });

  it('should create AuditRecord in event store for approval flow', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    const approvalId = pendingApprovals[0].id;

    await harness.sendApprovalResponse(userId, sessionId, approvalId, true);

    const events = harness.stores.eventStore.query({ sessionId });
    const approvalEvents = events.filter(e => {
      const eventType = (e as { eventType: string }).eventType;
      return eventType.includes('approval') || eventType.includes('permission');
    });

    expect(approvalEvents.length).toBeGreaterThan(0);
  });

  it('should NOT execute write tool without approval', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    const result = await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PERMISSION_DENIED');

    const toolExecution = harness.stores.toolExecutionStore.getById(toolCallId);
    expect(toolExecution).toBeDefined();
    expect(toolExecution?.status).toBe('denied');
  });

  it('should reject write tool when approval is denied', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId,
      toolName: 'writeFile',
      params: { path: '/test/file.txt', content: 'Hello World' },
      userId,
      sessionId,
      permissionContext,
    });

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    const approvalId = pendingApprovals[0].id;

    const approvalResult = await harness.sendApprovalResponse(userId, sessionId, approvalId, false);

    expect(approvalResult.success).toBe(true);
    expect(approvalResult.toolExecution).toBeUndefined();

    const updatedApproval = harness.stores.approvalStore.getById(approvalId);
    expect(updatedApproval?.status).toBe('rejected');
  });

  it('should track multiple approval requests for different write operations', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    const permissionContext: PermissionContext = {
      userId,
      sessionId,
      mode: 'ask_on_write',
      grants: [],
      metadata: {},
    };

    const toolCallId1 = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId: toolCallId1,
      toolName: 'writeFile',
      params: { path: '/test/file1.txt', content: 'Content 1' },
      userId,
      sessionId,
      permissionContext,
    });

    const toolCallId2 = harness.idGenerator.custom('tool_call');
    await harness.toolExecutor.execute({
      toolCallId: toolCallId2,
      toolName: 'writeFile',
      params: { path: '/test/file2.txt', content: 'Content 2' },
      userId,
      sessionId,
      permissionContext,
    });

    const pendingApprovals = harness.stores.approvalStore.findPendingBySession(sessionId);
    expect(pendingApprovals.length).toBe(2);

    const approval1 = pendingApprovals[0];
    const approval2 = pendingApprovals[1];

    await harness.sendApprovalResponse(userId, sessionId, approval1.id, true);

    const remainingPending = harness.stores.approvalStore.findPendingBySession(sessionId);
    expect(remainingPending.length).toBe(1);
    expect(remainingPending[0].id).toBe(approval2.id);
  });
});
