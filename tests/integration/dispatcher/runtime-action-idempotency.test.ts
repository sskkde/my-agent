import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRuntimeDispatcher } from '../../../src/dispatcher/runtime-dispatcher.js'
import { createAdapterRegistry } from '../../../src/dispatcher/adapter-registry.js'
import type { RuntimeAction, RuntimeAdapter } from '../../../src/dispatcher/types.js'
import type { RuntimeActionStore, EventStore } from '../../../src/storage/index.js'
import type { RuntimeActionState } from '../../../src/storage/runtime-action-store.js'

function createMockRuntimeActionStore(): RuntimeActionStore {
  const actions = new Map<string, ReturnType<RuntimeActionStore['findById']>>()
  const idempotencyMap = new Map<string, string>()

  return {
    save: (action) => {
      actions.set(action.actionId, { ...action })
      if (action.idempotencyKey && !idempotencyMap.has(action.idempotencyKey)) {
        idempotencyMap.set(action.idempotencyKey, action.actionId)
      }
    },
    findById: (id) => actions.get(id) ?? null,
    findByIdempotencyKey: (key) => {
      const actionId = idempotencyMap.get(key)
      return actionId ? (actions.get(actionId) ?? null) : null
    },
    updateStatus: (actionId, status, statusMessage, result) => {
      const action = actions.get(actionId)
      if (action) {
        action.status = status as RuntimeActionState
        if (statusMessage !== undefined) action.statusMessage = statusMessage
        if (result !== undefined) action.result = result
        actions.set(actionId, action)
      }
    },
    query: () => [],
  }
}

function createMockEventStore(): EventStore {
  return {
    append: () => {},
    query: () => [],
    findByCorrelationId: () => [],
    findByCausationId: () => [],
    updateUserIdForSession: () => 0,
  }
}

function createMockAdapter(result: unknown): RuntimeAdapter {
  return {
    execute: vi.fn().mockResolvedValue(result),
  }
}

function createAllowPermissionHook() {
  return vi.fn().mockResolvedValue({ allowed: true })
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
  }
}

function createDispatcher(actionStore: RuntimeActionStore, eventStore: EventStore) {
  const adapterRegistry = createAdapterRegistry()
  adapterRegistry.register('tool_plane', createMockAdapter({ data: 'result' }))

  return {
    adapterRegistry,
    dispatcher: createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
      permissionHook: createAllowPermissionHook(),
    }),
  }
}

describe('RuntimeAction Idempotency – completed state', () => {
  let actionStore: RuntimeActionStore
  let eventStore: EventStore
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore()
    eventStore = createMockEventStore()
    const ctx = createDispatcher(actionStore, eventStore)
    dispatcher = ctx.dispatcher
  })

  it('should return_previous for duplicate with completed state (default behavior)', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-1',
      idempotencyKey: 'key-completed-1',
      status: 'completed',
      result: { data: 'original result' },
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-1',
      idempotencyKey: 'key-completed-1',
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-1',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('duplicate')
    expect(result.result).toEqual({ data: 'original result' })
    expect(result.idempotency?.duplicateOfActionId).toBe('orig-1')
  })
})

describe('RuntimeAction Idempotency – in-flight states (return_previous)', () => {
  let actionStore: RuntimeActionStore
  let eventStore: EventStore
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore()
    eventStore = createMockEventStore()
    const ctx = createDispatcher(actionStore, eventStore)
    dispatcher = ctx.dispatcher
  })

  it('should return_previous with waitingState when original is dispatching', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-disp',
      idempotencyKey: 'key-dispatching',
      status: 'dispatching',
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-disp',
      idempotencyKey: 'key-dispatching',
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-disp',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('duplicate')
    expect(result.idempotency?.duplicateOfActionId).toBe('orig-disp')
    expect(result.waitingState).toBeDefined()
    expect(result.waitingState?.waitingFor).toBe('target_runtime')
  })

  it('should return_previous with waitingState when original is queued', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-queued',
      idempotencyKey: 'key-queued',
      status: 'queued',
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-queued',
      idempotencyKey: 'key-queued',
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-queued',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('duplicate')
    expect(result.waitingState).toBeDefined()
    expect(result.waitingState?.waitingFor).toBe('target_runtime')
  })

  it('should return_previous with waitingState when original is waiting_for_approval', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-wfa',
      idempotencyKey: 'key-wfa',
      status: 'waiting_for_approval',
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-wfa',
      idempotencyKey: 'key-wfa',
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-wfa',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('duplicate')
    expect(result.waitingState?.waitingFor).toBe('approval')
  })
})

describe('RuntimeAction Idempotency – terminal states (return_previous)', () => {
  let actionStore: RuntimeActionStore
  let eventStore: EventStore
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore()
    eventStore = createMockEventStore()
    const ctx = createDispatcher(actionStore, eventStore)
    dispatcher = ctx.dispatcher
  })

  const terminalScenarios: Array<{ status: RuntimeActionState; label: string }> = [
    { status: 'failed', label: 'failed' },
    { status: 'timeout', label: 'timeout' },
    { status: 'cancelled', label: 'cancelled' },
    { status: 'denied', label: 'denied' },
  ]

  for (const scenario of terminalScenarios) {
    it(`should return_previous for duplicate when original is ${scenario.label}`, async () => {
      const existing = makeBaseAction({
        actionId: `orig-${scenario.label}`,
        idempotencyKey: `key-${scenario.label}`,
        status: scenario.status,
        result: { outcome: scenario.label },
      })
      actionStore.save(existing)

      const duplicate = makeBaseAction({
        actionId: `dup-${scenario.label}`,
        idempotencyKey: `key-${scenario.label}`,
      })

      const result = await dispatcher.dispatch({
        requestId: `req-${scenario.label}`,
        action: duplicate,
        context: { callerModule: 'gateway' },
      })

      expect(result.status).toBe('duplicate')
      expect(result.result).toEqual({ outcome: scenario.label })
    })
  }
})

describe('RuntimeAction Idempotency – duplicateBehavior = fail', () => {
  let actionStore: RuntimeActionStore
  let eventStore: EventStore
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore()
    eventStore = createMockEventStore()
    const ctx = createDispatcher(actionStore, eventStore)
    dispatcher = ctx.dispatcher
  })

  it('should reject duplicate with DUPLICATE_REJECTED when behavior is fail (completed)', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-fail-1',
      idempotencyKey: 'key-fail-completed',
      status: 'completed',
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-fail-1',
      idempotencyKey: 'key-fail-completed',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-fail-completed',
          duplicateBehavior: 'fail',
        },
      },
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-fail-1',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('duplicate_rejected')
    expect(result.error?.message).toContain('terminal state')
    expect(result.error?.recoverable).toBe(false)
  })

  it('should reject duplicate with DUPLICATE_REJECTED when behavior is fail (in-flight)', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-fail-2',
      idempotencyKey: 'key-fail-inflight',
      status: 'dispatching',
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-fail-2',
      idempotencyKey: 'key-fail-inflight',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-fail-inflight',
          duplicateBehavior: 'fail',
        },
      },
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-fail-2',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('duplicate_rejected')
    expect(result.error?.message).toContain('in-flight')
  })

  it('should reject duplicate when behavior is fail (timeout terminal)', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-fail-3',
      idempotencyKey: 'key-fail-timeout',
      status: 'timeout',
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-fail-3',
      idempotencyKey: 'key-fail-timeout',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-fail-timeout',
          duplicateBehavior: 'fail',
        },
      },
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-fail-3',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('duplicate_rejected')
  })
})

describe('RuntimeAction Idempotency – duplicateBehavior = drop', () => {
  let actionStore: RuntimeActionStore
  let eventStore: EventStore
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore()
    eventStore = createMockEventStore()
    const ctx = createDispatcher(actionStore, eventStore)
    dispatcher = ctx.dispatcher
  })

  it('should silently drop duplicate when behavior is drop (completed)', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-drop-1',
      idempotencyKey: 'key-drop-completed',
      status: 'completed',
      result: { data: 'should not be returned' },
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-drop-1',
      idempotencyKey: 'key-drop-completed',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-drop-completed',
          duplicateBehavior: 'drop',
        },
      },
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-drop-1',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('duplicate')
    expect(result.result).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it('should silently drop duplicate when behavior is drop (in-flight)', async () => {
    const existing = makeBaseAction({
      actionId: 'orig-drop-2',
      idempotencyKey: 'key-drop-inflight',
      status: 'dispatching',
    })
    actionStore.save(existing)

    const duplicate = makeBaseAction({
      actionId: 'dup-drop-2',
      idempotencyKey: 'key-drop-inflight',
      policy: {
        mode: 'sync',
        priority: 'normal',
        idempotency: {
          enabled: true,
          key: 'key-drop-inflight',
          duplicateBehavior: 'drop',
        },
      },
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-drop-2',
      action: duplicate,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('duplicate')
    expect(result.result).toBeUndefined()
    expect(result.error).toBeUndefined()

    const droppedAction = actionStore.findById('dup-drop-2')
    expect(droppedAction?.status).toBe('duplicate')
  })
})

describe('RuntimeAction Idempotency – no idempotencyKey', () => {
  let actionStore: RuntimeActionStore
  let eventStore: EventStore
  let dispatcher: ReturnType<typeof createRuntimeDispatcher>

  beforeEach(() => {
    actionStore = createMockRuntimeActionStore()
    eventStore = createMockEventStore()
    const ctx = createDispatcher(actionStore, eventStore)
    dispatcher = ctx.dispatcher
  })

  it('should proceed normally when no idempotencyKey is set', async () => {
    const action = makeBaseAction({
      actionId: 'no-key-1',
    })

    const result = await dispatcher.dispatch({
      requestId: 'req-no-key',
      action,
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('completed')
  })
})
