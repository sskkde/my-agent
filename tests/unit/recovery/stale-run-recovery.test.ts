import { describe, expect, it, vi } from 'vitest'
import { createStaleRunRecovery } from '../../../src/recovery/stale-run-recovery.js'
import { KERNEL_RUN_STATES, RUNTIME_ACTION_STATES } from '../../../src/shared/states.js'
import type { RuntimeAction, RuntimeActionStore } from '../../../src/storage/runtime-action-store.js'
import type { KernelRun, KernelRunStore } from '../../../src/storage/kernel-run-store.js'

function createMockRuntimeActionStore(): Pick<RuntimeActionStore, 'listStaleByStatus' | 'updateStatus'> & {
  updates: Array<{ actionId: string; status: string; statusMessage?: string }>
} {
  const updates: Array<{ actionId: string; status: string; statusMessage?: string }> = []
  return {
    listStaleByStatus: vi.fn(() => []),
    updateStatus: vi.fn((actionId, status, statusMessage) => {
      updates.push({ actionId, status, statusMessage })
    }),
    updates,
  }
}

function createMockKernelRunStore(): Pick<KernelRunStore, 'listStaleInStates' | 'markFailedWithResult'> & {
  failures: Array<{ runId: string; finalResult: unknown }>
} {
  const failures: Array<{ runId: string; finalResult: unknown }> = []
  return {
    listStaleInStates: vi.fn(() => []),
    markFailedWithResult: vi.fn((runId, finalResult) => {
      failures.push({ runId, finalResult })
    }),
    failures,
  }
}

function makeAction(overrides: Partial<RuntimeAction>): RuntimeAction {
  const now = new Date().toISOString()
  return {
    actionId: 'action-1',
    actionType: 'execute_tool',
    source: { sourceModule: 'test' },
    targetRuntime: 'tool_plane',
    targetAction: 'test_tool',
    payload: {},
    status: RUNTIME_ACTION_STATES.DISPATCHING,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function makeKernelRun(overrides: Partial<KernelRun>): KernelRun {
  const now = new Date().toISOString()
  return {
    runId: 'krun-1',
    agentId: 'agent-1',
    invocationSource: 'test',
    status: KERNEL_RUN_STATES.INITIALIZING,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('StaleRunRecovery', () => {
  it('marks stale dispatching runtime actions as timeout', () => {
    const actionStore = createMockRuntimeActionStore()
    const kernelStore = createMockKernelRunStore()
    const now = new Date('2024-06-01T01:00:00.000Z')

    vi.mocked(actionStore.listStaleByStatus).mockImplementation((status) => {
      if (status === RUNTIME_ACTION_STATES.DISPATCHING) {
        return [makeAction({ actionId: 'stale-action', status: RUNTIME_ACTION_STATES.DISPATCHING })]
      }
      return []
    })

    const recovery = createStaleRunRecovery({
      runtimeActionStore: actionStore,
      kernelRunStore: kernelStore,
      runtimeActionThresholdMs: 60_000,
      kernelRunThresholdMs: 130_000,
      now: () => now,
    })

    const result = recovery.recover()

    expect(result.staleActionsMarked).toBe(1)
    expect(result.staleActions[0]).toMatchObject({
      actionId: 'stale-action',
      previousStatus: 'dispatching',
      newStatus: 'timeout',
    })
    expect(actionStore.updateStatus).toHaveBeenCalledWith(
      'stale-action',
      RUNTIME_ACTION_STATES.TIMEOUT,
      expect.stringContaining('Stale action'),
    )
  })

  it('marks stale initializing kernel runs as failed with final_result note', () => {
    const actionStore = createMockRuntimeActionStore()
    const kernelStore = createMockKernelRunStore()
    const now = new Date('2024-06-01T01:00:00.000Z')

    vi.mocked(kernelStore.listStaleInStates).mockImplementation(() => [
      makeKernelRun({ runId: 'stale-krun', status: KERNEL_RUN_STATES.INITIALIZING }),
    ])

    const recovery = createStaleRunRecovery({
      runtimeActionStore: actionStore,
      kernelRunStore: kernelStore,
      runtimeActionThresholdMs: 60_000,
      kernelRunThresholdMs: 130_000,
      now: () => now,
    })

    const result = recovery.recover()

    expect(result.staleKernelRunsMarked).toBe(1)
    expect(result.staleKernelRuns[0]).toMatchObject({
      runId: 'stale-krun',
      previousStatus: 'initializing',
      newStatus: KERNEL_RUN_STATES.FAILED,
    })
    expect(kernelStore.markFailedWithResult).toHaveBeenCalledWith(
      'stale-krun',
      expect.objectContaining({
        recovered: true,
        previousStatus: KERNEL_RUN_STATES.INITIALIZING,
        reason: expect.stringContaining('Stale kernel run'),
      }),
    )
  })

  it('does not touch waiting_for_approval runtime actions by default', () => {
    const actionStore = createMockRuntimeActionStore()
    const kernelStore = createMockKernelRunStore()
    const now = new Date('2024-06-01T01:00:00.000Z')

    vi.mocked(actionStore.listStaleByStatus).mockImplementation(() => [])

    const recovery = createStaleRunRecovery({
      runtimeActionStore: actionStore,
      kernelRunStore: kernelStore,
      runtimeActionThresholdMs: 60_000,
      kernelRunThresholdMs: 130_000,
      now: () => now,
    })

    recovery.recover()

    const calls = vi.mocked(actionStore.listStaleByStatus).mock.calls
    const sweptStatuses = calls.map(([status]) => status)
    expect(sweptStatuses).not.toContain(RUNTIME_ACTION_STATES.WAITING_FOR_APPROVAL)
  })

  it('does not sweep terminal kernel run states', () => {
    const actionStore = createMockRuntimeActionStore()
    const kernelStore = createMockKernelRunStore()
    const now = new Date('2024-06-01T01:00:00.000Z')

    vi.mocked(kernelStore.listStaleInStates).mockImplementation((states) => {
      const stateSet = new Set(states)
      expect(stateSet).not.toContain(KERNEL_RUN_STATES.COMPLETED)
      expect(stateSet).not.toContain(KERNEL_RUN_STATES.FAILED)
      expect(stateSet).not.toContain(KERNEL_RUN_STATES.CANCELLED)
      expect(stateSet).not.toContain(KERNEL_RUN_STATES.INTERRUPTED)
      expect(stateSet).not.toContain(KERNEL_RUN_STATES.PARTIAL_SUCCESS)
      expect(stateSet).not.toContain(KERNEL_RUN_STATES.MAX_ITERATIONS_REACHED)
      return []
    })

    const recovery = createStaleRunRecovery({
      runtimeActionStore: actionStore,
      kernelRunStore: kernelStore,
      runtimeActionThresholdMs: 60_000,
      kernelRunThresholdMs: 130_000,
      now: () => now,
    })

    recovery.recover()
  })

  it('returns empty result when nothing is stale', () => {
    const actionStore = createMockRuntimeActionStore()
    const kernelStore = createMockKernelRunStore()
    const now = new Date('2024-06-01T01:00:00.000Z')

    const recovery = createStaleRunRecovery({
      runtimeActionStore: actionStore,
      kernelRunStore: kernelStore,
      runtimeActionThresholdMs: 60_000,
      kernelRunThresholdMs: 130_000,
      now: () => now,
    })

    const result = recovery.recover()

    expect(result.staleActionsMarked).toBe(0)
    expect(result.staleKernelRunsMarked).toBe(0)
    expect(result.staleActions).toHaveLength(0)
    expect(result.staleKernelRuns).toHaveLength(0)
  })

  it('sweeps multiple stale kernel runs in different non-terminal states', () => {
    const actionStore = createMockRuntimeActionStore()
    const kernelStore = createMockKernelRunStore()
    const now = new Date('2024-06-01T01:00:00.000Z')

    vi.mocked(kernelStore.listStaleInStates).mockImplementation(() => [
      makeKernelRun({ runId: 'stale-init', status: KERNEL_RUN_STATES.INITIALIZING }),
      makeKernelRun({ runId: 'stale-sampling', status: KERNEL_RUN_STATES.SAMPLING_MODEL }),
      makeKernelRun({ runId: 'stale-dispatching', status: KERNEL_RUN_STATES.DISPATCHING_TOOLS }),
    ])

    const recovery = createStaleRunRecovery({
      runtimeActionStore: actionStore,
      kernelRunStore: kernelStore,
      runtimeActionThresholdMs: 60_000,
      kernelRunThresholdMs: 130_000,
      now: () => now,
    })

    const result = recovery.recover()

    expect(result.staleKernelRunsMarked).toBe(3)
    expect(kernelStore.markFailedWithResult).toHaveBeenCalledTimes(3)
  })

  it('uses now() override for threshold computation', () => {
    const actionStore = createMockRuntimeActionStore()
    const kernelStore = createMockKernelRunStore()
    const fixedNow = new Date('2024-06-01T01:00:00.000Z')

    vi.mocked(actionStore.listStaleByStatus).mockImplementation((_status, olderThanIso) => {
      expect(olderThanIso).toBe(new Date(fixedNow.getTime() - 60_000).toISOString())
      return []
    })
    const kernelOlderThan: string[] = []
    vi.mocked(kernelStore.listStaleInStates).mockImplementation((_states, olderThanIso) => {
      kernelOlderThan.push(olderThanIso)
      return []
    })

    const recovery = createStaleRunRecovery({
      runtimeActionStore: actionStore,
      kernelRunStore: kernelStore,
      runtimeActionThresholdMs: 60_000,
      kernelRunThresholdMs: 130_000,
      now: () => fixedNow,
    })

    recovery.recover()
    expect(kernelOlderThan[0]).toBe(new Date(fixedNow.getTime() - 130_000).toISOString())
  })
})
