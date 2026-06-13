import { describe, it, expect, vi } from 'vitest'
import { createRuntimeDispatcher } from '../../../src/dispatcher/runtime-dispatcher.js'
import { createAdapterRegistry } from '../../../src/dispatcher/adapter-registry.js'
import type { RuntimeAction, RuntimeAdapter } from '../../../src/dispatcher/types.js'
import type { EventStore, RuntimeActionStore } from '../../../src/storage/index.js'
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
    append: vi.fn(),
    query: () => [],
    findByCorrelationId: () => [],
    findByCausationId: () => [],
    updateUserIdForSession: () => 0,
  }
}

function makeAction(overrides: Partial<RuntimeAction> = {}): RuntimeAction {
  return {
    actionId: 'cancel-action',
    actionType: 'execute_tool',
    source: { sourceModule: 'gateway' },
    targetRuntime: 'tool_plane',
    targetAction: 'write',
    payload: {},
    status: 'created',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    policy: { mode: 'sync', priority: 'normal', timeoutMs: 20 },
    ...overrides,
  }
}

function createDispatcher(adapter: RuntimeAdapter, actionStore = createMockRuntimeActionStore()) {
  const adapterRegistry = createAdapterRegistry()
  adapterRegistry.register('tool_plane', adapter)
  return {
    actionStore,
    dispatcher: createRuntimeDispatcher({
      actionStore,
      eventStore: createMockEventStore(),
      adapterRegistry,
      permissionHook: vi.fn().mockResolvedValue({ allowed: true }),
    }),
  }
}

describe('RuntimeDispatcher cancellation', () => {
  it('passes an AbortSignal and lets adapters stop after abort', async () => {
    let observedAborted = false
    const adapter: RuntimeAdapter = {
      execute: vi.fn(
        (_action, context) =>
          new Promise((resolve) => {
            context.signal.addEventListener('abort', () => {
              observedAborted = true
              resolve({ stopped: true })
            })
          }),
      ),
    }
    const { dispatcher } = createDispatcher(adapter)

    const result = await dispatcher.dispatch({
      requestId: 'req-abort-stop',
      action: makeAction(),
      context: { callerModule: 'gateway' },
    })

    expect(result.status).toBe('timeout')
    expect(observedAborted).toBe(true)
    expect(adapter.execute).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ timeoutMs: 20 }))
  })

  it('does not commit completed state when an adapter resolves after timeout', async () => {
    const actionStore = createMockRuntimeActionStore()
    const statuses: RuntimeActionState[] = []
    const updateStatus = actionStore.updateStatus.bind(actionStore)
    actionStore.updateStatus = (actionId, status, statusMessage, result) => {
      statuses.push(status)
      updateStatus(actionId, status, statusMessage, result)
    }
    const adapter: RuntimeAdapter = {
      execute: vi.fn(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ success: true }), 50)
          }),
      ),
      cancelUnsupported: true,
    }
    const { dispatcher } = createDispatcher(adapter, actionStore)

    const result = await dispatcher.dispatch({
      requestId: 'req-late-success',
      action: makeAction({ actionId: 'late-success' }),
      context: { callerModule: 'gateway' },
    })
    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(result.status).toBe('timeout')
    expect(actionStore.findById('late-success')?.status).toBe('timeout')
    expect(statuses).toEqual(['dispatching', 'timeout'])
  })

  it('does not repeat write side effects after a timed-out write action', async () => {
    let sideEffects = 0
    const adapter: RuntimeAdapter = {
      execute: vi.fn(
        (_action, context) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => {
              sideEffects += 1
              resolve({ wrote: true })
            }, 50)
            context.signal.addEventListener('abort', () => {
              clearTimeout(timer)
              resolve({ cancelled: true })
            })
          }),
      ),
    }
    const { actionStore, dispatcher } = createDispatcher(adapter)

    const result = await dispatcher.dispatch({
      requestId: 'req-write-timeout',
      action: makeAction({ actionId: 'write-timeout', targetAction: 'write' }),
      context: { callerModule: 'gateway' },
    })
    await new Promise((resolve) => setTimeout(resolve, 70))

    expect(result.status).toBe('timeout')
    expect(actionStore.findById('write-timeout')?.status).toBe('timeout')
    expect(sideEffects).toBe(0)
  })
})
