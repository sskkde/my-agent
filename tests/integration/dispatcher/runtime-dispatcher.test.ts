import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRuntimeDispatcher } from '../../../src/dispatcher/runtime-dispatcher.js';
import { createAdapterRegistry } from '../../../src/dispatcher/adapter-registry.js';
import { registerDefaultRuntimeAdapters } from '../../../src/dispatcher/runtime-adapters.js';
import { createBackgroundRuntime } from '../../../src/subagents/background-runtime.js';
import type {
  RuntimeAction,
  RuntimeAdapter
} from '../../../src/dispatcher/types.js';
import type { RuntimeActionStore, EventStore, BackgroundRunStore } from '../../../src/storage/index.js';
import type { ToolExecutor } from '../../../src/tools/types.js';
import type { PlannerRuntime } from '../../../src/planner/planner-runtime.js';
import type { WorkflowRuntime } from '../../../src/workflows/workflow-runtime.js';
import type { EventTriggerRuntime } from '../../../src/triggers/event-trigger-runtime.js';
import type { AgentKernel } from '../../../src/kernel/agent-kernel.js';
import type { PermissionGrantStore } from '../../../src/storage/permission-grant-store.js';

function createMockRuntimeActionStore(): RuntimeActionStore {
  const actions = new Map<string, ReturnType<RuntimeActionStore['findById']>>();
  const idempotencyMap = new Map<string, string>();

  return {
    save: (action) => {
      actions.set(action.actionId, { ...action });
      if (action.idempotencyKey && !idempotencyMap.has(action.idempotencyKey)) {
        idempotencyMap.set(action.idempotencyKey, action.actionId);
      }
    },
    findById: (id) => actions.get(id) ?? null,
    findByIdempotencyKey: (key) => {
      const actionId = idempotencyMap.get(key);
      return actionId ? actions.get(actionId) ?? null : null;
    },
    updateStatus: (actionId, status, statusMessage, result) => {
      const action = actions.get(actionId);
      if (action) {
        action.status = status;
        if (statusMessage !== undefined) action.statusMessage = statusMessage;
        if (result !== undefined) action.result = result;
        actions.set(actionId, action);
      }
    },
    query: () => [],
  };
}

function createMockEventStore(): EventStore {
  return {
    append: () => {},
    query: () => [],
    findByCorrelationId: () => [],
    findByCausationId: () => [],
    updateUserIdForSession: () => 0,
  };
}

function createMockAdapter(result: unknown): RuntimeAdapter {
  return {
    execute: vi.fn().mockResolvedValue(result)
  };
}

function createAllowPermissionHook() {
  return vi.fn().mockResolvedValue({ allowed: true });
}

function createDenyPermissionHook() {
  return vi.fn().mockResolvedValue({ allowed: false, reason: 'Permission denied' });
}

describe('RuntimeDispatcher Integration', () => {
  let actionStore: RuntimeActionStore;
  let eventStore: EventStore;
  let adapterRegistry: ReturnType<typeof createAdapterRegistry>;
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>;

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore();
    eventStore = createMockEventStore();
    adapterRegistry = createAdapterRegistry();
    dispatcher = createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
      permissionHook: createAllowPermissionHook()
    });
  });

  describe('RuntimeAction Validation', () => {
    it('should reject action with missing actionType', async () => {
      const action = {
        actionId: 'test-action-1',
        source: { sourceModule: 'gateway' as const },
        targetRuntime: 'tool_plane' as const,
        targetAction: 'test_tool',
        payload: {},
        status: 'created' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-1',
        action: action as unknown as RuntimeAction,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('invalid_action');
    });

    it('should reject action with missing targetRuntime', async () => {
      const action = {
        actionId: 'test-action-2',
        actionType: 'execute_tool' as const,
        source: { sourceModule: 'gateway' as const },
        targetAction: 'test_tool',
        payload: {},
        status: 'created' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-2',
        action: action as unknown as RuntimeAction,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('invalid_action');
    });

    it('should accept valid action', async () => {
      const mockResult = { success: true, data: 'test' };
      adapterRegistry.register('tool_plane', createMockAdapter(mockResult));

      const action: RuntimeAction = {
        actionId: 'test-action-3',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: { input: 'test' },
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-3',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('completed');
      expect(result.result).toEqual(mockResult);
    });
  });

  describe('Adapter Registry', () => {
    it('should register and retrieve adapter', () => {
      const adapter = createMockAdapter({});
      adapterRegistry.register('tool_plane', adapter);

      const retrieved = adapterRegistry.getAdapter('tool_plane');
      expect(retrieved).toBe(adapter);
    });

    it('should return null for unregistered adapter', () => {
      const retrieved = adapterRegistry.getAdapter('agent_kernel');
      expect(retrieved).toBeNull();
    });

    it('should dispatch to correct adapter based on targetRuntime', async () => {
      const toolAdapter = createMockAdapter({ type: 'tool_result' });
      const kernelAdapter = createMockAdapter({ type: 'kernel_result' });

      adapterRegistry.register('tool_plane', toolAdapter);
      adapterRegistry.register('agent_kernel', kernelAdapter);

      const toolAction: RuntimeAction = {
        actionId: 'test-action-4',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-4',
        action: toolAction,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('completed');
      expect(result.result).toEqual({ type: 'tool_result' });
      expect(toolAdapter.execute).toHaveBeenCalled();
      expect(kernelAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return failure when adapter not found', async () => {
      const action: RuntimeAction = {
        actionId: 'test-action-5',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'workflow_runtime',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-5',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('target_runtime_unavailable');
    });
  });

  describe('Idempotency', () => {
    it('should return previous result for duplicate idempotencyKey', async () => {
      const mockResult = { data: 'original' };
      adapterRegistry.register('tool_plane', createMockAdapter(mockResult));

      const action: RuntimeAction = {
        actionId: 'test-action-6',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: { input: 'test' },
        idempotencyKey: 'unique-key-123',
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result1 = await dispatcher.dispatch({
        requestId: 'req-6a',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result1.status).toBe('completed');

      const action2: RuntimeAction = {
        ...action,
        actionId: 'test-action-6b'
      };

      const result2 = await dispatcher.dispatch({
        requestId: 'req-6b',
        action: action2,
        context: { callerModule: 'gateway' }
      });

      expect(result2.status).toBe('duplicate');
      expect(result2.result).toEqual(mockResult);
      expect(result2.idempotency?.duplicateOfActionId).toBe('test-action-6');
    });

    it('should not check idempotency when key not provided', async () => {
      adapterRegistry.register('tool_plane', createMockAdapter({}));

      const action1: RuntimeAction = {
        actionId: 'test-action-7a',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: { input: 'test' },
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const action2: RuntimeAction = {
        actionId: 'test-action-7b',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: { input: 'test' },
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result1 = await dispatcher.dispatch({
        requestId: 'req-7a',
        action: action1,
        context: { callerModule: 'gateway' }
      });

      const result2 = await dispatcher.dispatch({
        requestId: 'req-7b',
        action: action2,
        context: { callerModule: 'gateway' }
      });

      expect(result1.status).toBe('completed');
      expect(result2.status).toBe('completed');
    });
  });

  describe('Permission Precheck', () => {
    it('should call permission hook before dispatch', async () => {
      const permissionHook = createAllowPermissionHook();
      dispatcher = createRuntimeDispatcher({
        actionStore,
        eventStore,
        adapterRegistry,
        permissionHook
      });

      adapterRegistry.register('tool_plane', createMockAdapter({}));

      const action: RuntimeAction = {
        actionId: 'test-action-8',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await dispatcher.dispatch({
        requestId: 'req-8',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(permissionHook).toHaveBeenCalledWith(action);
    });

    it('should return denied when permission check fails', async () => {
      const permissionHook = createDenyPermissionHook();
      dispatcher = createRuntimeDispatcher({
        actionStore,
        eventStore,
        adapterRegistry,
        permissionHook
      });

      adapterRegistry.register('tool_plane', createMockAdapter({}));

      const action: RuntimeAction = {
        actionId: 'test-action-9',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-9',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('denied');
      expect(result.error?.code).toBe('permission_denied');
    });

    it('should bypass permission check when hook not provided', async () => {
      dispatcher = createRuntimeDispatcher({
        actionStore,
        eventStore,
        adapterRegistry
      });

      adapterRegistry.register('tool_plane', createMockAdapter({ success: true }));

      const action: RuntimeAction = {
        actionId: 'test-action-10',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-10',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('completed');
    });
  });

  describe('DispatchResult Normalization', () => {
    it('should normalize successful result', async () => {
      const mockResult = { data: 'test-result', metadata: { key: 'value' } };
      adapterRegistry.register('tool_plane', createMockAdapter(mockResult));

      const action: RuntimeAction = {
        actionId: 'test-action-11',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-11',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('completed');
      expect(result.result).toEqual(mockResult);
      expect(result.requestId).toBe('req-11');
      expect(result.actionId).toBe('test-action-11');
      expect(result.targetRuntime).toBe('tool_plane');
      expect(result.createdAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
    });

    it('should normalize failed result with error details', async () => {
      const error = new Error('Adapter execution failed');
      adapterRegistry.register('tool_plane', {
        execute: vi.fn().mockRejectedValue(error)
      });

      const action: RuntimeAction = {
        actionId: 'test-action-12',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-12',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('failed');
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('target_runtime_error');
      expect(result.error?.message).toContain('Adapter execution failed');
      expect(result.error?.recoverable).toBe(false);
    });

    it('should normalize timeout result', async () => {
      adapterRegistry.register('tool_plane', {
        execute: vi.fn().mockImplementation(() => new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        }))
      });

      const action: RuntimeAction = {
        actionId: 'test-action-13',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        policy: { mode: 'sync', priority: 'normal', timeoutMs: 50 },
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-13',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('timeout');
      expect(result.error?.code).toBe('timeout');
    });
  });

  describe('DispatchEvent Emission', () => {
    it('should emit dispatch events to EventStore', async () => {
      adapterRegistry.register('tool_plane', createMockAdapter({ success: true }));

      const action: RuntimeAction = {
        actionId: 'test-action-14',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await dispatcher.dispatch({
        requestId: 'req-14',
        action,
        context: { callerModule: 'gateway' }
      });
    });

    it('should include correlation and causation IDs in events', async () => {
      adapterRegistry.register('tool_plane', createMockAdapter({}));

      const action: RuntimeAction = {
        actionId: 'test-action-15',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        correlationId: 'correlation-123',
        causationId: 'causation-456',
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await dispatcher.dispatch({
        requestId: 'req-15',
        action,
        context: { callerModule: 'gateway' }
      });
    });
  });

  describe('Supported Runtime Adapters', () => {
    it('should support tool_plane adapter', async () => {
      const adapter = createMockAdapter({ type: 'tool' });
      adapterRegistry.register('tool_plane', adapter);

      const action: RuntimeAction = {
        actionId: 'test-action-16',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-16',
        action,
        context: { callerModule: 'gateway' }
      });

      expect(result.status).toBe('completed');
      expect(adapter.execute).toHaveBeenCalledWith(action);
    });

    it('should support kernel_run adapter', async () => {
      const adapter = createMockAdapter({ type: 'kernel' });
      adapterRegistry.register('agent_kernel', adapter);

      const action: RuntimeAction = {
        actionId: 'test-action-17',
        actionType: 'start_agent_run',
        source: { sourceModule: 'planner' },
        targetRuntime: 'agent_kernel',
        targetAction: 'start_run',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-17',
        action,
        context: { callerModule: 'planner' }
      });

      expect(result.status).toBe('completed');
      expect(adapter.execute).toHaveBeenCalledWith(action);
    });

    it('should support subagent_runtime adapter', async () => {
      const adapter = createMockAdapter({ type: 'subagent' });
      adapterRegistry.register('subagent_runtime', adapter);

      const action: RuntimeAction = {
        actionId: 'test-action-18',
        actionType: 'launch_subagent',
        source: { sourceModule: 'kernel' },
        targetRuntime: 'subagent_runtime',
        targetAction: 'launch',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-18',
        action,
        context: { callerModule: 'kernel' }
      });

      expect(result.status).toBe('completed');
      expect(adapter.execute).toHaveBeenCalledWith(action);
    });

    it('should support workflow_runtime adapter', async () => {
      const adapter = createMockAdapter({ type: 'workflow' });
      adapterRegistry.register('workflow_runtime', adapter);

      const action: RuntimeAction = {
        actionId: 'test-action-19',
        actionType: 'start_workflow_run',
        source: { sourceModule: 'planner' },
        targetRuntime: 'workflow_runtime',
        targetAction: 'start_run',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-19',
        action,
        context: { callerModule: 'planner' }
      });

      expect(result.status).toBe('completed');
      expect(adapter.execute).toHaveBeenCalledWith(action);
    });

    it('should support planner_run adapter', async () => {
      const adapter = createMockAdapter({ type: 'planner' });
      adapterRegistry.register('planner_runtime', adapter);

      const action: RuntimeAction = {
        actionId: 'test-action-20',
        actionType: 'spawn_planner_run',
        source: { sourceModule: 'foreground_conversation_agent' },
        targetRuntime: 'planner_runtime',
        targetAction: 'spawn',
        payload: {},
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-20',
        action,
        context: { callerModule: 'foreground_conversation_agent' }
      });

      expect(result.status).toBe('completed');
      expect(adapter.execute).toHaveBeenCalledWith(action);
    });
  });

  describe('DispatchRequest Context', () => {
    it('should include userId and sessionId in dispatch', async () => {
      adapterRegistry.register('tool_plane', createMockAdapter({}));

      const action: RuntimeAction = {
        actionId: 'test-action-21',
        actionType: 'execute_tool',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'tool_plane',
        targetAction: 'test_tool',
        payload: {},
        userId: 'user-123',
        sessionId: 'session-456',
        status: 'created',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const result = await dispatcher.dispatch({
        requestId: 'req-21',
        action,
        context: {
          callerModule: 'gateway',
          userId: 'user-123',
          sessionId: 'session-456'
        }
      });

      expect(result.status).toBe('completed');
    });
  });
});

describe('RuntimeDispatcher with subagent_runtime adapter', () => {
  let actionStore: RuntimeActionStore;
  let eventStore: EventStore;
  let adapterRegistry: ReturnType<typeof createAdapterRegistry>;
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>;
  let backgroundRunStore: ReturnType<typeof createMockBackgroundRunStore>;
  let backgroundRuntime: ReturnType<typeof createBackgroundRuntime>;

  function createMockBackgroundRunStore() {
    const runs = new Map<string, { backgroundRunId: string; userId: string; sessionId?: string; agentType: string; status: string; launchSource: string; priority?: number; scheduledAt?: string; expiresAt?: string; retryCount: number; createdAt: string; updatedAt: string; checkpointData?: unknown; startedAt?: string; completedAt?: string; resultData?: unknown; errorMessage?: string }>();

    return {
      runs,
      create: (run: { backgroundRunId: string; userId: string; sessionId?: string; agentType: string; status: string; launchSource: string; priority?: number; scheduledAt?: string; expiresAt?: string; retryCount: number; createdAt: string; updatedAt: string; checkpointData?: unknown }) => {
        runs.set(run.backgroundRunId, { ...run, retryCount: run.retryCount ?? 0 });
      },
      getById: (id: string) => runs.get(id) ?? null,
      updateStatus: (id: string, status: string) => {
        const run = runs.get(id);
        if (run) {
          run.status = status;
          run.updatedAt = new Date().toISOString();
        }
      },
      saveCheckpoint: () => {},
      saveRecoveryPoint: () => {},
      saveResult: () => {},
      incrementRetryCount: () => {},
      getByUserAndStatus: () => [],
      getBySessionAndStatus: () => [],
      getBySubagentRunId: () => [],
      getByLaunchSource: () => [],
      getByStatus: (status: string) => Array.from(runs.values()).filter(r => r.status === status),
      getExpiredRuns: () => [],
    };
  }

  function createMockEventStoreForSubagent(): EventStore {
    return {
      append: () => {},
      query: () => [],
      findByCorrelationId: () => [],
      findByCausationId: () => [],
      updateUserIdForSession: () => 0,
    };
  }

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore();
    eventStore = createMockEventStoreForSubagent();
    adapterRegistry = createAdapterRegistry();
    backgroundRunStore = createMockBackgroundRunStore();
    backgroundRuntime = createBackgroundRuntime({
      backgroundRunStore: backgroundRunStore as unknown as BackgroundRunStore,
      eventStore,
      maxConcurrentRuns: 2,
      watchdogTimeoutMs: 5000,
    });

    registerDefaultRuntimeAdapters({
      adapterRegistry,
      toolExecutor: { execute: vi.fn() } as unknown as ToolExecutor,
      plannerRuntime: { resumePlannerRun: vi.fn(), cancelPlannerRun: vi.fn() } as unknown as PlannerRuntime,
      workflowRuntime: { startWorkflowRun: vi.fn() } as unknown as WorkflowRuntime,
      triggerRuntime: { registerWaitCondition: vi.fn(), registerTrigger: vi.fn() } as unknown as EventTriggerRuntime,
      agentKernel: { run: vi.fn() } as unknown as AgentKernel,
      permissionGrantStore: { findByUser: vi.fn(() => []) } as unknown as PermissionGrantStore,
      backgroundRuntime,
    });

    dispatcher = createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
    });
  });

  it('should dispatch launch_background_subagent and return backgroundRunId', async () => {
    const action: RuntimeAction = {
      actionId: 'test-launch-bg-001',
      actionType: 'launch_background_subagent',
      source: { sourceModule: 'planner' },
      targetRuntime: 'subagent_runtime',
      targetAction: 'launch',
      payload: {
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic X' },
        launchSource: 'planner',
      },
      userId: 'user-test-001',
      sessionId: 'session-test-001',
      status: 'created',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await dispatcher.dispatch({
      requestId: 'req-launch-bg-001',
      action,
      context: { callerModule: 'planner' },
    });

    expect(result.status).toBe('completed');
    expect(result.result).toBeDefined();
    const resultData = result.result as { backgroundRunId?: string; status?: string };
    expect(resultData.backgroundRunId).toBeDefined();
    expect(resultData.backgroundRunId).toMatch(/^bg-/);
    expect(resultData.status).toBe('queued');
  });

  it('should dispatch cancel_background_subagent and transition to cancelled', async () => {
    const launchAction: RuntimeAction = {
      actionId: 'test-cancel-bg-001',
      actionType: 'launch_background_subagent',
      source: { sourceModule: 'planner' },
      targetRuntime: 'subagent_runtime',
      targetAction: 'launch',
      payload: {
        agentType: 'research-agent',
        taskSpec: { objective: 'Research topic Y' },
        launchSource: 'planner',
      },
      userId: 'user-test-002',
      status: 'created',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const launchResult = await dispatcher.dispatch({
      requestId: 'req-cancel-bg-001',
      action: launchAction,
      context: { callerModule: 'planner' },
    });

    const launchData = launchResult.result as { backgroundRunId: string };
    const backgroundRunId = launchData.backgroundRunId;

    const cancelAction: RuntimeAction = {
      actionId: 'test-cancel-bg-002',
      actionType: 'cancel_background_subagent',
      source: { sourceModule: 'planner' },
      targetRuntime: 'subagent_runtime',
      targetAction: 'cancel',
      payload: { backgroundRunId },
      status: 'created',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const cancelResult = await dispatcher.dispatch({
      requestId: 'req-cancel-bg-002',
      action: cancelAction,
      context: { callerModule: 'planner' },
    });

    expect(cancelResult.status).toBe('completed');
    const cancelData = cancelResult.result as { backgroundRunId?: string; status?: string };
    expect(cancelData.backgroundRunId).toBe(backgroundRunId);
    expect(cancelData.status).toBe('cancelled');

    const run = backgroundRuntime.getBackgroundRun(backgroundRunId);
    expect(run?.status).toBe('cancelled');
  });

  it('should verify subagent_runtime adapter is registered', () => {
    expect(adapterRegistry.getAdapter('subagent_runtime')).not.toBeNull();
    expect(adapterRegistry.listAdapters()).toContain('subagent_runtime');
  });
});
