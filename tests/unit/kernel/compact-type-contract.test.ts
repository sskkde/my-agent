import { describe, it, expect } from 'vitest'
import type {
  CompactExecutor,
  CompactExecutorInput,
  CompactExecutorResult,
} from '../../../src/kernel/types.js'
import { makeBaseConfig } from '../../helpers/kernel-compact.js'

// ─── Type Contract Tests ──────────────────────────────────────────────────────

describe('CompactExecutor type contract', () => {
  it('CompactExecutorInput accepts candidateItemIds, mustKeepItemIds, and contextItems', () => {
    const input: CompactExecutorInput = {
      candidateItemIds: ['a', 'b'],
      mustKeepItemIds: ['c'],
      contextItems: [],
    }

    expect(input.candidateItemIds).toEqual(['a', 'b'])
    expect(input.mustKeepItemIds).toEqual(['c'])
    expect(input.contextItems).toEqual([])
  })

  it('CompactExecutorResult is a discriminated union with applied or skipped status', () => {
    const applied: CompactExecutorResult = {
      status: 'applied',
      compactedItemIds: ['a'],
      summaryItem: {
        itemId: 'summary-1',
        sourceType: 'system_note',
        semanticType: 'summary',
        content: 'compacted',
        estimatedTokens: 10,
      },
      compressionRatio: 0.5,
    }
    const skipped: CompactExecutorResult = {
      status: 'skipped',
      reason: 'below_threshold',
    }

    expect(applied.status).toBe('applied')
    expect(skipped.status).toBe('skipped')
  })

  it('CompactExecutor is an async function accepting input and returning result', () => {
    const executor: CompactExecutor = async (input) => ({
      status: 'applied',
      compactedItemIds: [...input.candidateItemIds],
      summaryItem: {
        itemId: 'summary-1',
        sourceType: 'system_note',
        semanticType: 'summary',
        content: 'compacted',
        estimatedTokens: 10,
      },
      compressionRatio: 0.5,
    })

    expect(typeof executor).toBe('function')
  })

  it('KernelConfig accepts optional compactExecutor field', () => {
    const executor: CompactExecutor = async () => ({ status: 'skipped', reason: 'test' })
    const config = makeBaseConfig({ compactExecutor: executor })

    expect(config.compactExecutor).toBe(executor)
  })

  it('KernelConfig compactExecutor is optional', () => {
    const config = makeBaseConfig()

    expect(config.compactExecutor).toBeUndefined()
  })
})
