import { describe, expect, it, vi } from 'vitest'
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
  }
}

function createValidAction(): RuntimeAction {
  const now = new Date().toISOString()
  return {
    actionId: 'valid-action',
    actionType: 'execute_tool',
    source: { sourceModule: 'gateway' },
    targetRuntime: 'tool_plane',
    targetAction: 'test_tool',
    payload: {},
    status: 'created',
    createdAt: now,
    updatedAt: now,
  }
}

describe('RuntimeDispatcher validation failures', () => {
  it.each([
    {
      name: 'missing actionId',
      actionPatch: { actionId: undefined },
      lookupActionId: 'valid-action',
      expectedMessage: 'Missing required field: actionId',
    },
    {
      name: 'invalid targetRuntime',
      actionPatch: { targetRuntime: 'not_a_runtime' },
      lookupActionId: 'valid-action',
      expectedMessage: 'Invalid targetRuntime: not_a_runtime',
    },
    {
      name: 'missing source.sourceModule',
      actionPatch: { source: {} },
      lookupActionId: 'valid-action',
      expectedMessage: 'Missing required field: source.sourceModule',
    },
  ])(
    'rejects $name without saving executable action and emits validation telemetry',
    async ({ actionPatch, lookupActionId, expectedMessage }) => {
      const actionStore = createMockRuntimeActionStore()
      const eventStore = { append: vi.fn() }
      const auditRecorder = { recordDispatch: vi.fn() }
      const dispatcher = createRuntimeDispatcher({
        actionStore,
        eventStore,
        adapterRegistry: createAdapterRegistry(),
        auditRecorder: auditRecorder as never,
      })
      const action = { ...createValidAction(), ...actionPatch } as unknown as RuntimeAction

      const result = await dispatcher.dispatch({
        requestId: 'req-validation-failure',
        action,
        context: { callerModule: 'gateway' },
      })

      expect(result.status).toBe('failed')
      expect(result.error).toEqual({
        code: 'invalid_action',
        message: expectedMessage,
        recoverable: false,
      })
      expect(actionStore.save).not.toHaveBeenCalled()
      expect(actionStore.updateStatus).not.toHaveBeenCalled()
      expect(actionStore.findById(lookupActionId)).toBeNull()
      expect(eventStore.append).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'dispatch_requested' }))
      expect(eventStore.append).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'dispatch_validation_failed',
          payload: expect.objectContaining({
            status: 'failed',
            error: expect.objectContaining({ code: 'invalid_action', message: expectedMessage }),
          }),
        }),
      )
      expect(eventStore.append).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'dispatch_accepted' }))
      expect(auditRecorder.recordDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          payloadSummary: `validation failure: ${expectedMessage}`,
        }),
      )
    },
  )
})
