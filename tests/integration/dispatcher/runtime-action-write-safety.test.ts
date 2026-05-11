import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRuntimeDispatcher, isWriteActionClass, getWriteActionClass } from '../../../src/dispatcher/runtime-dispatcher.js';
import { createAdapterRegistry } from '../../../src/dispatcher/adapter-registry.js';
import type {
  RuntimeAction,
  RuntimeAdapter,
} from '../../../src/dispatcher/types.js';
import type { RuntimeActionStore, EventStore } from '../../../src/storage/index.js';
import type { RuntimeActionState } from '../../../src/storage/runtime-action-store.js';

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
        action.status = status as RuntimeActionState;
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
    execute: vi.fn().mockResolvedValue(result),
  };
}

function createAllowPermissionHook() {
  return vi.fn().mockResolvedValue({ allowed: true });
}

function makeBaseAction(overrides: Partial<RuntimeAction> = {}): RuntimeAction {
  return {
    actionId: `action-${Math.random().toString(36).substring(2, 9)}`,
    actionType: 'execute_tool',
    source: { sourceModule: 'gateway' },
    targetRuntime: 'tool_plane',
    targetAction: 'test_tool',
    payload: { input: 'test' },
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('WriteActionClass helpers', () => {
  it('should classify write as WriteActionClass', () => {
    expect(isWriteActionClass('write')).toBe(true);
    expect(getWriteActionClass('write')).toBe('write');
  });

  it('should classify delete as WriteActionClass', () => {
    expect(isWriteActionClass('delete')).toBe(true);
    expect(getWriteActionClass('delete')).toBe('delete');
  });

  it('should classify send as WriteActionClass', () => {
    expect(isWriteActionClass('send')).toBe(true);
    expect(getWriteActionClass('send')).toBe('send');
  });

  it('should classify execute as WriteActionClass', () => {
    expect(isWriteActionClass('execute')).toBe(true);
    expect(getWriteActionClass('execute')).toBe('execute');
  });

  it('should not classify read as WriteActionClass', () => {
    expect(isWriteActionClass('read')).toBe(false);
    expect(getWriteActionClass('read')).toBeNull();
  });

  it('should not classify search as WriteActionClass', () => {
    expect(isWriteActionClass('search')).toBe(false);
  });

  it('should not classify unknown actions as WriteActionClass', () => {
    expect(isWriteActionClass('unknown')).toBe(false);
    expect(isWriteActionClass('')).toBe(false);
  });
});

describe('WriteActionClass duplicate safety – write types escalate return_previous to fail', () => {
  let actionStore: RuntimeActionStore;
  let eventStore: EventStore;

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore();
    eventStore = createMockEventStore();
  });

  function createDispatcher() {
    const adapterRegistry = createAdapterRegistry();
    adapterRegistry.register('tool_plane', createMockAdapter({ data: 'result' }));

    return createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
      permissionHook: createAllowPermissionHook(),
    });
  }

  for (const writeTarget of ['write', 'delete', 'send', 'execute'] as const) {
    it(`should escalate return_previous to fail for write targetAction "${writeTarget}"`, async () => {
      const dispatcher = createDispatcher();

      const existing = makeBaseAction({
        actionId: `orig-${writeTarget}`,
        targetAction: writeTarget,
        idempotencyKey: `key-${writeTarget}`,
        status: 'completed',
        result: { side_effect: 'already_done' },
      });
      actionStore.save(existing);

      const duplicate = makeBaseAction({
        actionId: `dup-${writeTarget}`,
        targetAction: writeTarget,
        idempotencyKey: `key-${writeTarget}`,
        policy: {
          mode: 'sync',
          priority: 'normal',
          idempotency: {
            enabled: true,
            key: `key-${writeTarget}`,
            duplicateBehavior: 'return_previous',
          },
        },
      });

      const result = await dispatcher.dispatch({
        requestId: `req-${writeTarget}`,
        action: duplicate,
        context: { callerModule: 'gateway' },
      });

      expect(result.status).toBe('failed');
      expect(result.error?.code).toBe('duplicate_rejected');
      expect(result.error?.message).toContain(existing.actionId);
    });
  }

  it('should respect explicit fail behavior for write targetAction', async () => {
    const dispatcher = createDispatcher();

    const existing = makeBaseAction({
      actionId: 'orig-write-fail',
      targetAction: 'write',
      idempotencyKey: 'key-write-fail',
      status: 'completed',
    });
    actionStore.save(existing);

    const duplicate = makeBaseAction({
      actionId: 'dup-write-fail',
      targetAction: 'write',
      idempotencyKey: 'key-write-fail',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-write-fail',
          duplicateBehavior: 'fail',
        },
      },
    });

    const result = await dispatcher.dispatch({
      requestId: 'req-write-fail',
      action: duplicate,
      context: { callerModule: 'gateway' },
    });

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('duplicate_rejected');
  });

  it('should respect explicit drop behavior for write targetAction', async () => {
    const dispatcher = createDispatcher();

    const existing = makeBaseAction({
      actionId: 'orig-write-drop',
      targetAction: 'write',
      idempotencyKey: 'key-write-drop',
      status: 'dispatching',
    });
    actionStore.save(existing);

    const duplicate = makeBaseAction({
      actionId: 'dup-write-drop',
      targetAction: 'write',
      idempotencyKey: 'key-write-drop',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-write-drop',
          duplicateBehavior: 'drop',
        },
      },
    });

    const result = await dispatcher.dispatch({
      requestId: 'req-write-drop',
      action: duplicate,
      context: { callerModule: 'gateway' },
    });

    expect(result.status).toBe('duplicate');
    expect(result.error).toBeUndefined();
    expect(result.result).toBeUndefined();
  });
});

describe('WriteActionClass – non-write types keep return_previous behavior', () => {
  let actionStore: RuntimeActionStore;
  let eventStore: EventStore;

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore();
    eventStore = createMockEventStore();
  });

  function createDispatcher() {
    const adapterRegistry = createAdapterRegistry();
    adapterRegistry.register('tool_plane', createMockAdapter({ data: 'result' }));

    return createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
      permissionHook: createAllowPermissionHook(),
    });
  }

  it('should return_previous for read targetAction with completed status', async () => {
    const dispatcher = createDispatcher();

    const existing = makeBaseAction({
      actionId: 'orig-read',
      targetAction: 'read',
      idempotencyKey: 'key-read',
      status: 'completed',
      result: { data: 'cached' },
    });
    actionStore.save(existing);

    const duplicate = makeBaseAction({
      actionId: 'dup-read',
      targetAction: 'read',
      idempotencyKey: 'key-read',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-read',
          duplicateBehavior: 'return_previous',
        },
      },
    });

    const result = await dispatcher.dispatch({
      requestId: 'req-read',
      action: duplicate,
      context: { callerModule: 'gateway' },
    });

    expect(result.status).toBe('duplicate');
    expect(result.result).toEqual({ data: 'cached' });
  });
});
