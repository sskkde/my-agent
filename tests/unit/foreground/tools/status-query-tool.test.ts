import { describe, it, expect, vi } from 'vitest';
import { handleStatusQuery, STATUS_QUERY_TOOL_ID } from '../../../../src/foreground/tools/status-query-tool.js';
import type { RuntimeDispatcher, DispatchResult } from '../../../../src/dispatcher/types.js';

describe('status-query-tool', () => {
  describe('STATUS_QUERY_TOOL_ID', () => {
    it('should have correct tool ID', () => {
      expect(STATUS_QUERY_TOOL_ID).toBe('foreground_status_query');
    });
  });

  describe('handleStatusQuery', () => {
    it('Status query returns active work — runtime action is server-created and dispatched', async () => {
      const mockDispatch = vi.fn().mockResolvedValue({
        requestId: 'turn-001',
        actionId: 'action-test-123',
        status: 'completed',
        targetRuntime: 'gateway',
        result: { activeRuns: 2, pendingApprovals: 1 },
        createdAt: '2024-01-15T10:00:00.000Z',
      } as DispatchResult);

      const mockRuntimeDispatcher = {
        dispatch: mockDispatch,
      } as RuntimeDispatcher;

      const deps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-001',
      };

      const result = await handleStatusQuery(deps);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.runtimeActionId).toMatch(/^action-\d+-[a-z0-9]+$/);
      expect(result.data?.statusText).toContain('Status:');
      expect(result.userVisibleSummary).toBeDefined();
      expect(result.runtimeSummary).toBeDefined();
      expect(result.runtimeSummary?.runtimeActionIds).toHaveLength(1);

      // Verify dispatch was called with correct parameters
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      const dispatchCall = mockDispatch.mock.calls[0][0];
      expect(dispatchCall.requestId).toBe('turn-001');
      expect(dispatchCall.action.actionType).toBe('query_active_work');
      expect(dispatchCall.action.targetRuntime).toBe('gateway');
      expect(dispatchCall.action.targetAction).toBe('query');
      expect(dispatchCall.action.source.sourceModule).toBe('foreground_status_query_tool');
      expect(dispatchCall.action.userId).toBe('user-123');
      expect(dispatchCall.action.sessionId).toBe('session-456');
      expect(dispatchCall.action.payload.queryType).toBe('active_work_status');
      expect(dispatchCall.context.callerModule).toBe('foreground_status_query_tool');
      expect(dispatchCall.context.userId).toBe('user-123');
      expect(dispatchCall.context.sessionId).toBe('session-456');
    });

    it('Status query returns failure on dispatch error', async () => {
      const mockDispatch = vi.fn().mockRejectedValue(new Error('Dispatch failed'));

      const mockRuntimeDispatcher = {
        dispatch: mockDispatch,
      } as RuntimeDispatcher;

      const deps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-001',
      };

      const result = await handleStatusQuery(deps);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('STATUS_QUERY_FAILED');
      expect(result.error?.message).toBe('Dispatch failed');
      expect(result.error?.recoverable).toBe(false);
      expect(result.userVisibleSummary).toBe('Status check failed due to an error.');
      expect(result.data).toBeUndefined();

      // Verify dispatch was attempted
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it('should handle failed dispatch status', async () => {
      const mockDispatch = vi.fn().mockResolvedValue({
        requestId: 'turn-001',
        actionId: 'action-test-456',
        status: 'failed',
        targetRuntime: 'gateway',
        error: {
          code: 'TARGET_RUNTIME_ERROR',
          message: 'Gateway unavailable',
          recoverable: true,
        },
        createdAt: '2024-01-15T10:00:00.000Z',
      } as DispatchResult);

      const mockRuntimeDispatcher = {
        dispatch: mockDispatch,
      } as RuntimeDispatcher;

      const deps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-001',
      };

      const result = await handleStatusQuery(deps);

      expect(result.success).toBe(true);
      expect(result.data?.statusText).toContain('Status check failed');
      expect(result.data?.statusText).toContain('Gateway unavailable');
    });

    it('should handle pending dispatch status', async () => {
      const mockDispatch = vi.fn().mockResolvedValue({
        requestId: 'turn-001',
        actionId: 'action-test-789',
        status: 'accepted',
        targetRuntime: 'gateway',
        createdAt: '2024-01-15T10:00:00.000Z',
      } as DispatchResult);

      const mockRuntimeDispatcher = {
        dispatch: mockDispatch,
      } as RuntimeDispatcher;

      const deps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-001',
      };

      const result = await handleStatusQuery(deps);

      expect(result.success).toBe(true);
      expect(result.data?.statusText).toBe('Status check is pending.');
    });

    it('should use custom user message when provided', async () => {
      const mockDispatch = vi.fn().mockResolvedValue({
        requestId: 'turn-001',
        actionId: 'action-test-999',
        status: 'completed',
        targetRuntime: 'gateway',
        result: 'All systems operational',
        createdAt: '2024-01-15T10:00:00.000Z',
      } as DispatchResult);

      const mockRuntimeDispatcher = {
        dispatch: mockDispatch,
      } as RuntimeDispatcher;

      const deps = {
        runtimeDispatcher: mockRuntimeDispatcher,
        userId: 'user-123',
        sessionId: 'session-456',
        turnId: 'turn-001',
      };

      const customMessage = 'Checking your current work status...';
      const result = await handleStatusQuery(deps, customMessage);

      expect(result.success).toBe(true);
      expect(result.userVisibleSummary).toBe(customMessage);
    });
  });
});
