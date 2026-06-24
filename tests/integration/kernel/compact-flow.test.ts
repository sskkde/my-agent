import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ContextItem } from '../../../src/context/types.js'
import type {
  CompactExecutor,
  CompactExecutorInput,
  CompactExecutorResult,
  KernelTranscriptEntry,
} from '../../../src/kernel/types.js'
import { AgentKernel } from '../../../src/kernel/agent-kernel.js'
import {
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
    content: 'Compacted summary of multiple items',
    estimatedTokens: 50,
  }
}

function getCompactEntries(transcript: KernelTranscriptEntry[]): KernelTranscriptEntry[] {
  return transcript.filter((e) => e.type === 'compact')
}

// ─── Integration: Compact Flow ────────────────────────────────────────────────

describe('compact flow integration', () => {
  let mockExecutor: CompactExecutor
  let summaryItem: ContextItem

  beforeEach(() => {
    summaryItem = makeSummaryItem()
    mockExecutor = vi.fn<(input: CompactExecutorInput) => Promise<CompactExecutorResult>>()
  })

  it('context count drops after applied compaction', async () => {
    // Given: 20 items in bundle, 3 candidates compacted into 1 summary
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'applied',
      compactedItemIds: ['item-0', 'item-1', 'item-2'],
      summaryItem,
      compressionRatio: 0.3,
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

    // When: kernel runs with applied compaction
    const result = await kernel.run(makeRunInput(bundle))

    // Then: transcript shows compaction occurred
    const compactEntries = getCompactEntries(result.transcript)
    expect(compactEntries.length).toBeGreaterThanOrEqual(1)
    const lastCompact = compactEntries[compactEntries.length - 1]
    expect(lastCompact.content).toMatchObject({
      shouldCompact: true,
      executionResult: { status: 'applied', compactedItemIds: ['item-0', 'item-1', 'item-2'] },
    })
  })

  it('token estimate drops after applied compaction via context manager delta', async () => {
    // Given: executor returns applied with low-token summary
    const lowTokenSummary: ContextItem = {
      ...summaryItem,
      estimatedTokens: 10,
    }
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'applied',
      compactedItemIds: ['item-0', 'item-1', 'item-2'],
      summaryItem: lowTokenSummary,
      compressionRatio: 0.1,
    })
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0', 'item-1', 'item-2'],
        mustKeepItemIds: ['item-18', 'item-19'],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const applyDeltaSpy = vi.spyOn(config.contextManager, 'applyDelta')
    const kernel = new AgentKernel(config)

    // When: kernel runs
    await kernel.run(makeRunInput(bundle))

    // Then: applyDelta called with replaceKeys for compacted items
    expect(applyDeltaSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        replaceKeys: ['item-0', 'item-1', 'item-2'],
        items: [expect.objectContaining({ itemId: 'compact-summary-1' })],
      }),
    )
  })

  it('context unchanged on skipped compaction', async () => {
    // Given: executor returns skipped
    vi.mocked(mockExecutor).mockResolvedValue({
      status: 'skipped',
      reason: 'model returned empty response',
    })
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: [],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const applyDeltaSpy = vi.spyOn(config.contextManager, 'applyDelta')
    const kernel = new AgentKernel(config)

    // When: kernel runs with skipped compaction
    const result = await kernel.run(makeRunInput(bundle))

    // Then: finalStatus is NOT failed, applyDelta NOT called for compaction
    expect(result.finalStatus).not.toBe('failed')
    expect(applyDeltaSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: 'runtime_note' }),
    )
    // Then: transcript still has compact entry with skipped status
    const compactEntries = getCompactEntries(result.transcript)
    expect(compactEntries.length).toBeGreaterThanOrEqual(1)
    const lastCompact = compactEntries[compactEntries.length - 1]
    expect(lastCompact.content).toMatchObject({
      shouldCompact: true,
      executionResult: { status: 'skipped', reason: 'model returned empty response' },
    })
  })

  it('transcript contains structured compact result with trigger and execution data', async () => {
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
        candidateItemIds: ['item-0', 'item-1'],
        mustKeepItemIds: ['item-19'],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)

    // When: kernel runs
    const result = await kernel.run(makeRunInput(bundle))

    // Then: compact entry has both trigger data and execution result
    const compactEntries = getCompactEntries(result.transcript)
    expect(compactEntries.length).toBeGreaterThanOrEqual(1)
    const entry = compactEntries[compactEntries.length - 1]
    expect(entry).toMatchObject({
      type: 'compact',
      content: {
        shouldCompact: true,
        candidateItemIds: ['item-0', 'item-1'],
        mustKeepItemIds: ['item-19'],
        executionResult: {
          status: 'applied',
          compactedItemIds: ['item-0'],
        },
      },
    })
  })

  it('executor error does not change finalStatus', async () => {
    // Given: executor throws
    vi.mocked(mockExecutor).mockRejectedValue(new Error('LLM timeout'))
    const bundle = makeHighUtilizationBundle({
      compactHints: {
        shouldCompactSoon: true,
        candidateItemIds: ['item-0'],
        mustKeepItemIds: [],
      },
    })
    const config = makeBaseConfig({ compactExecutor: mockExecutor })
    const kernel = new AgentKernel(config)

    // When: kernel runs with throwing executor
    const result = await kernel.run(makeRunInput(bundle))

    // Then: finalStatus is NOT failed — executor errors are expected
    expect(result.finalStatus).not.toBe('failed')
    // Then: transcript has compact entry with skipped status
    const compactEntries = getCompactEntries(result.transcript)
    expect(compactEntries.length).toBeGreaterThanOrEqual(1)
    const lastCompact = compactEntries[compactEntries.length - 1]
    expect(lastCompact.content).toMatchObject({
      shouldCompact: true,
      executionResult: { status: 'skipped', reason: 'executor error' },
    })
  })
})
