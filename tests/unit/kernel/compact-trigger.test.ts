import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  CompactExecutor,
  CompactExecutorInput,
  CompactExecutorResult,
} from '../../../src/kernel/types.js'
import type { ContextItem } from '../../../src/context/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import {
  makeContextItem,
  makeHighUtilizationBundle,
  makeRunInput,
  makeBaseConfig,
} from '../../helpers/kernel-compact.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSummaryItem(): ContextItem {
  return {
    itemId: 'compact-summary-1',
    sourceType: 'system_note',
    semanticType: 'summary',
    content: 'Compacted summary of 3 items',
    estimatedTokens: 50,
  }
}

// ─── Kernel Trigger Branch Tests ─────────────────────────────────────────────

describe('compact trigger executor invocation', () => {
  let mockExecutor: CompactExecutor
  let summaryItem: ContextItem

  beforeEach(() => {
    summaryItem = makeSummaryItem()
    mockExecutor = vi.fn<(input: CompactExecutorInput) => Promise<CompactExecutorResult>>()
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'applied',
      compactedItemIds: ['item-0'],
      summaryItem,
      compressionRatio: 0.5,
    })
  })

  it('executor receives candidateItemIds and mustKeepItemIds when utilization exceeds threshold and shouldCompactSoon is true', async () => {
    // Given: kernel with executor, high utilization context, shouldCompactSoon=true
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['cand-1', 'cand-2'],
        mustKeepItemIds: ['keep-1'],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)
    const input = makeRunInput(bundle)

    // When: kernel runs and trigger conditions are met
    await kernel.run(input)

    // Then: executor is called with the candidate and must-keep IDs from hints, plus active runtime context
    expect(mockExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateItemIds: ['cand-1', 'cand-2'],
        mustKeepItemIds: ['keep-1'],
        contextItems: expect.any(Array),
      }),
    )
  })

  it('executor is NOT called when utilization is below threshold', async () => {
    // Given: low utilization (100 used / 100000 estimate = 0.1%)
    const items = [makeContextItem('item-0', 100)]
    const bundle = makeHighUtilizationBundle({
      orderedItems: items,
      tokenEstimate: 100_000,
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: [],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)

    // When: kernel runs with low utilization
    await kernel.run(makeRunInput(bundle))

    // Then: executor is not called
    expect(mockExecutor).not.toHaveBeenCalled()
  })

  it('executor is NOT called when shouldCompactSoon is false', async () => {
    // Given: high utilization but shouldCompactSoon=false
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: false,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: [],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)

    // When: kernel runs
    await kernel.run(makeRunInput(bundle))

    // Then: executor is not called
    expect(mockExecutor).not.toHaveBeenCalled()
  })

  it('executor is NOT called when no compactExecutor is configured', async () => {
    // Given: high utilization + shouldCompactSoon but NO executor in config
    const bundle = makeHighUtilizationBundle()
    const config = makeBaseConfig()
    const kernel = new AgentKernel(config)

    // When: kernel runs
    await kernel.run(makeRunInput(bundle))

    // Then: no error thrown, executor simply not present
    expect(config.compactExecutor).toBeUndefined()
  })
})

// ─── Context Update Tests ────────────────────────────────────────────────────

describe('compact context synchronization', () => {
  let mockExecutor: CompactExecutor
  let summaryItem: ContextItem

  beforeEach(() => {
    summaryItem = makeSummaryItem()
    mockExecutor = vi.fn<(input: CompactExecutorInput) => Promise<CompactExecutorResult>>()
  })

  it('contextItems updated with summary item after applied compaction', async () => {
    // Given: executor returns applied with compactedItemIds and summaryItem
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'applied',
      compactedItemIds: ['item-0', 'item-1', 'item-2'],
      summaryItem,
      compressionRatio: 0.5,
    })
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0', 'item-1', 'item-2'],
        mustKeepItemIds: ['item-18', 'item-19'],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)
    const result = await kernel.run(makeRunInput(bundle))

    // Then: transcript contains compact entry with applied status
    const compactEntries = result.transcript.filter((e) => e.type === 'compact')
    expect(compactEntries.length).toBeGreaterThanOrEqual(1)
    const lastCompact = compactEntries[compactEntries.length - 1]
    expect(lastCompact.content).toMatchObject({
      shouldCompact: true,
      executionResult: { status: 'applied' },
    })
  })

  it('applyDelta called with replaceKeys and summary item for consistency', async () => {
    // Given: executor returns applied
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'applied',
      compactedItemIds: ['item-0'],
      summaryItem,
      compressionRatio: 0.5,
    })
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: ['item-18', 'item-19'],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const applyDeltaSpy = vi.spyOn(config.contextManager, 'applyDelta')
    const kernel = new AgentKernel(config)

    // When: kernel runs with applied compaction
    await kernel.run(makeRunInput(bundle))

    // Then: applyDelta is called with replaceKeys and summary item
    expect(applyDeltaSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        replaceKeys: expect.arrayContaining(['item-0']),
        items: expect.arrayContaining([expect.objectContaining({ itemId: 'compact-summary-1' })]),
      }),
    )
  })

  it('compact transcript entry includes trigger data and execution result', async () => {
    // Given: executor returns applied
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'applied',
      compactedItemIds: ['item-0'],
      summaryItem,
      compressionRatio: 0.5,
    })
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: ['item-18', 'item-19'],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)

    // When: kernel runs
    const result = await kernel.run(makeRunInput(bundle))

    // Then: compact transcript entry has trigger data and execution result
    const compactEntries = result.transcript.filter((e) => e.type === 'compact')
    expect(compactEntries.length).toBeGreaterThanOrEqual(1)
    const lastCompact = compactEntries[compactEntries.length - 1]
    expect(lastCompact.content).toEqual(
      expect.objectContaining({
        shouldCompact: true,
        candidateItemIds: expect.any(Array),
        mustKeepItemIds: expect.any(Array),
        executionResult: { status: 'applied', compactedItemIds: ['item-0'] },
      }),
    )
  })

  it('expected skipped compaction does not change finalStatus', async () => {
    // Given: executor returns skipped
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'skipped',
      reason: 'insufficient items',
    })
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: [],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)

    // When: kernel runs with skipped compaction
    const result = await kernel.run(makeRunInput(bundle))

    // Then: finalStatus is NOT 'failed' — compaction failure is expected
    expect(result.finalStatus).not.toBe('failed')
    expect(['completed', 'max_iterations_reached']).toContain(result.finalStatus)
  })

  it('compact transcript committed even when executor skips', async () => {
    // Given: executor returns skipped
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'skipped',
      reason: 'model returned empty',
    })
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: [],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)

    // When: kernel runs
    const result = await kernel.run(makeRunInput(bundle))

    // Then: compact transcript entry is still committed
    const compactEntries = result.transcript.filter((e) => e.type === 'compact')
    expect(compactEntries.length).toBeGreaterThanOrEqual(1)
    const lastCompact = compactEntries[compactEntries.length - 1]
    expect(lastCompact.content).toEqual(
      expect.objectContaining({
        shouldCompact: true,
        executionResult: { status: 'skipped', reason: 'model returned empty' },
      }),
    )
  })
})
