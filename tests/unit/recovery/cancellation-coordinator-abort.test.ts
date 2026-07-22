import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCancellationCoordinator } from '../../../src/recovery/cancellation-coordinator.js'
import { CANCELLATION_STATUSES } from '../../../src/shared/cancellation.js'
import * as runAbortRegistry from '../../../src/kernel/run-abort-registry.js'

function makeMockConfig(overrides?: Record<string, unknown>) {
  return {
    toolExecutionStore: {
      getById: vi.fn(),
      updateStatus: vi.fn(),
      saveResult: vi.fn(),
    },
    plannerRunStore: {} as any,
    backgroundRunStore: {} as any,
    kernelRunStore: {
      getById: vi.fn(),
      updateStatus: vi.fn(),
    },
    eventStore: {
      append: vi.fn(),
    },
    ...overrides,
  }
}

describe('CancellationCoordinator abort wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls abortRun with the kernelRunId when cancelling a running run', async () => {
    const kernelRunId = 'turn_corr_123'
    const config = makeMockConfig({
      kernelRunStore: {
        getById: vi.fn().mockReturnValue({
          runId: kernelRunId,
          status: 'running',
          pendingToolCalls: [],
        }),
        updateStatus: vi.fn(),
      },
    })
    const coordinator = createCancellationCoordinator(config as any)

    const abortSpy = vi.spyOn(runAbortRegistry, 'abortRun')

    const result = await coordinator.cancelKernelRun(kernelRunId)

    expect(result.status).toBe(CANCELLATION_STATUSES.COMPLETED)
    expect(abortSpy).toHaveBeenCalledWith(kernelRunId)
  })

  it('does not call abortRun when the run is already terminal', async () => {
    const kernelRunId = 'turn_corr_456'
    const config = makeMockConfig({
      kernelRunStore: {
        getById: vi.fn().mockReturnValue({
          runId: kernelRunId,
          status: 'cancelled',
          pendingToolCalls: [],
        }),
        updateStatus: vi.fn(),
      },
    })
    const coordinator = createCancellationCoordinator(config as any)

    const abortSpy = vi.spyOn(runAbortRegistry, 'abortRun')

    const result = await coordinator.cancelKernelRun(kernelRunId)

    expect(result.status).toBe(CANCELLATION_STATUSES.ALREADY_TERMINAL)
    expect(abortSpy).not.toHaveBeenCalled()
  })

  it('does not throw when abortRun returns false (run not registered)', async () => {
    const kernelRunId = 'turn_corr_789'
    const config = makeMockConfig({
      kernelRunStore: {
        getById: vi.fn().mockReturnValue({
          runId: kernelRunId,
          status: 'running',
          pendingToolCalls: [],
        }),
        updateStatus: vi.fn(),
      },
    })
    const coordinator = createCancellationCoordinator(config as any)

    const abortSpy = vi.spyOn(runAbortRegistry, 'abortRun').mockReturnValue(false)

    const result = await coordinator.cancelKernelRun(kernelRunId)

    expect(result.status).toBe(CANCELLATION_STATUSES.COMPLETED)
    expect(abortSpy).toHaveBeenCalledWith(kernelRunId)
  })
})
