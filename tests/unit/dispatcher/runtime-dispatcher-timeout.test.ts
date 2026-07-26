import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createRuntimeDispatcher } from '../../../src/dispatcher/runtime-dispatcher.js'
import { createAdapterRegistry } from '../../../src/dispatcher/adapter-registry.js'
import type { RuntimeAction } from '../../../src/dispatcher/types.js'
import type { RuntimeActionStore } from '../../../src/storage/runtime-action-store.js'

function createMockRuntimeActionStore(): RuntimeActionStore {
  const actions = new Map<string, ReturnType<RuntimeActionStore['findById']>>()

  return {
    save: vi.fn((action) => actions.set(action.actionId, { ...action })),
    findById: vi.fn((id) => actions.get(id) ?? null),
    findByIdempotencyKey: vi.fn(() => null),
    query: vi.fn(() => []),
    updateStatus: vi.fn((actionId, status, statusMessage, result) => {
      const action = actions.get(actionId)
      if (action) {
        action.status = status
        if (statusMessage !== undefined) action.statusMessage = statusMessage
        if (result !== undefined) action.result = result
        actions.set(actionId, action)
      }
    }),
    listStaleByStatus: vi.fn(() => []),
  }
}

function createValidAction(timeoutMs: number): RuntimeAction {
  const now = new Date().toISOString()
  return {
    actionId: 'hang-action',
    actionType: 'execute_tool',
    source: { sourceModule: 'gateway' },
    targetRuntime: 'tool_plane',
    targetAction: 'test_tool',
    payload: {},
    policy: { mode: 'sync', priority: 'normal', timeoutMs },
    status: 'created',
    createdAt: now,
    updatedAt: now,
  }
}

describe('RuntimeDispatcher executeWithTimeout hang guarantee', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ends with status timeout when adapter never resolves', async () => {
    const actionStore = createMockRuntimeActionStore()
    const eventStore = { append: vi.fn() }
    const auditRecorder = { recordDispatch: vi.fn() }
    const adapterRegistry = createAdapterRegistry()

    const neverResolvingAdapter = {
      execute: () => new Promise(() => {}),
    }
    adapterRegistry.register('tool_plane', neverResolvingAdapter)

    const dispatcher = createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
      auditRecorder: auditRecorder as never,
    })

    const dispatchPromise = dispatcher.dispatch({
      requestId: 'req-hang',
      action: createValidAction(1000),
      context: { callerModule: 'gateway' },
    })

    await vi.advanceTimersByTimeAsync(1000)

    const result = await dispatchPromise

    expect(result.status).toBe('timeout')
    expect(result.error?.code).toBe('timeout')
    expect(result.actionId).toBe('hang-action')

    const updateStatusCalls = vi.mocked(actionStore.updateStatus).mock.calls
    const finalStatusCall = [...updateStatusCalls].reverse().find(([actionId]) => actionId === 'hang-action')
    expect(finalStatusCall).toBeDefined()
    expect(finalStatusCall?.[1]).toBe('timeout')
  })

  it('ends with status timeout when cancelUnsupported adapter never resolves', async () => {
    const actionStore = createMockRuntimeActionStore()
    const eventStore = { append: vi.fn() }
    const auditRecorder = { recordDispatch: vi.fn() }
    const adapterRegistry = createAdapterRegistry()

    const neverResolvingCancelUnsupportedAdapter = {
      execute: () => new Promise(() => {}),
      cancelUnsupported: true,
    }
    adapterRegistry.register('tool_plane', neverResolvingCancelUnsupportedAdapter)

    const dispatcher = createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
      auditRecorder: auditRecorder as never,
    })

    const dispatchPromise = dispatcher.dispatch({
      requestId: 'req-hang-cancel-unsupported',
      action: createValidAction(500),
      context: { callerModule: 'gateway' },
    })

    await vi.advanceTimersByTimeAsync(500)

    const result = await dispatchPromise

    expect(result.status).toBe('timeout')
    expect(result.error?.code).toBe('timeout')

    const updateStatusCalls = vi.mocked(actionStore.updateStatus).mock.calls
    const finalStatusCall = [...updateStatusCalls].reverse().find(([actionId]) => actionId === 'hang-action')
    expect(finalStatusCall?.[1]).toBe('timeout')
  })

  it('does not leave action in dispatching state after timeout', async () => {
    const actionStore = createMockRuntimeActionStore()
    const eventStore = { append: vi.fn() }
    const auditRecorder = { recordDispatch: vi.fn() }
    const adapterRegistry = createAdapterRegistry()

    adapterRegistry.register('tool_plane', {
      execute: () => new Promise(() => {}),
    })

    const dispatcher = createRuntimeDispatcher({
      actionStore,
      eventStore,
      adapterRegistry,
      auditRecorder: auditRecorder as never,
    })

    const dispatchPromise = dispatcher.dispatch({
      requestId: 'req-hang-no-dispatching',
      action: createValidAction(300),
      context: { callerModule: 'gateway' },
    })

    await vi.advanceTimersByTimeAsync(300)
    await dispatchPromise

    const action = actionStore.findById('hang-action')
    expect(action).not.toBeNull()
    expect(action?.status).not.toBe('dispatching')
    expect(action?.status).toBe('timeout')
  })
})
