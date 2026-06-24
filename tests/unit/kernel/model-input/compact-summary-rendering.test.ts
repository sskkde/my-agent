import { describe, it, expect } from 'vitest'
import { applyCompactToBundle } from '../../../../src/kernel/model-input/compact-summary-rendering.js'
import type { ContextItem } from '../../../../src/context/types.js'
import type { ContextBundleData, ContextItemData } from '../../../../src/kernel/model-input/model-input-types.js'
import { projectContextBundle } from '../../../../src/kernel/model-input/context-bundle-projection.js'

// ─── Given: helpers to build test fixtures ──────────────────────────────────

function makeItem(itemId: string, content: string, overrides?: Partial<ContextItemData>): ContextItemData {
  return {
    itemId,
    content,
    semanticType: 'fact',
    ...overrides,
  }
}

function makeSummaryItem(itemId: string, content: string): ContextItem {
  return {
    itemId,
    sourceType: 'memory',
    semanticType: 'summary',
    content,
    isPinned: false,
    isCompressible: false,
    isReplaceableByRef: true,
  }
}

// ─── applyCompactToBundle: summary metadata ─────────────────────────────────

describe('applyCompactToBundle', () => {
  describe('summary item metadata', () => {
    it('propagates sourceType: memory to the summary block', () => {
      // Given: a bundle with items and a compaction result
      const bundle: ContextBundleData = {
        orderedItems: [makeItem('a', 'item a'), makeItem('b', 'item b')],
      }
      const summaryItem = makeSummaryItem('sum-1', 'Compacted summary')

      // When: we apply compaction
      const result = applyCompactToBundle(bundle, ['a'], summaryItem)

      // Then: the summary block carries sourceType memory
      expect(result.summaryBlock.sourceType).toBe('memory')
    })

    it('propagates semanticType: summary to the summary block', () => {
      const bundle: ContextBundleData = {
        orderedItems: [makeItem('a', 'item a')],
      }
      const summaryItem = makeSummaryItem('sum-1', 'Compacted summary')

      const result = applyCompactToBundle(bundle, ['a'], summaryItem)

      expect(result.summaryBlock.semanticType).toBe('summary')
    })

    it('source ContextItem has isCompressible: false', () => {
      // The ContextItemData projection doesn't carry isCompressible/isReplaceableByRef
      // (those are selection-time flags, not rendering-time). Verify on the source item.
      const summaryItem = makeSummaryItem('sum-1', 'Compacted summary')

      expect(summaryItem.isCompressible).toBe(false)
    })

    it('source ContextItem has isReplaceableByRef: true', () => {
      const summaryItem = makeSummaryItem('sum-1', 'Compacted summary')

      expect(summaryItem.isReplaceableByRef).toBe(true)
    })
  })

  describe('compacted items removal', () => {
    it('removes compacted items from orderedItems', () => {
      const bundle: ContextBundleData = {
        orderedItems: [makeItem('a', 'item a'), makeItem('b', 'item b'), makeItem('c', 'item c')],
      }
      const summaryItem = makeSummaryItem('sum-1', 'Summary of a and b')

      const result = applyCompactToBundle(bundle, ['a', 'b'], summaryItem)

      expect(result.bundle.orderedItems).toHaveLength(1)
      expect(result.bundle.orderedItems![0].itemId).toBe('c')
    })

    it('removes compacted items from pinnedItems', () => {
      const bundle: ContextBundleData = {
        pinnedItems: [makeItem('p1', 'pinned 1'), makeItem('p2', 'pinned 2')],
        orderedItems: [makeItem('o1', 'ordered 1')],
      }
      const summaryItem = makeSummaryItem('sum-1', 'Summary')

      const result = applyCompactToBundle(bundle, ['p1'], summaryItem)

      expect(result.bundle.pinnedItems).toHaveLength(1)
      expect(result.bundle.pinnedItems![0].itemId).toBe('p2')
    })

    it('does not remove non-compacted items', () => {
      const bundle: ContextBundleData = {
        orderedItems: [makeItem('a', 'item a'), makeItem('b', 'item b')],
      }
      const summaryItem = makeSummaryItem('sum-1', 'Summary')

      const result = applyCompactToBundle(bundle, ['a'], summaryItem)

      expect(result.bundle.orderedItems!.map((i) => i.itemId)).toEqual(['b'])
    })

    it('preserves summaryBlocks that are not from this compaction', () => {
      const bundle: ContextBundleData = {
        orderedItems: [makeItem('a', 'item a')],
        summaryBlocks: [makeItem('prev-sum', 'Previous summary', { semanticType: 'summary' })],
      }
      const summaryItem = makeSummaryItem('sum-1', 'New summary')

      const result = applyCompactToBundle(bundle, ['a'], summaryItem)

      expect(result.bundle.summaryBlocks).toHaveLength(2)
      expect(result.bundle.summaryBlocks![0].itemId).toBe('prev-sum')
      expect(result.bundle.summaryBlocks![1].itemId).toBe('sum-1')
    })

    it('handles empty compactedItemIds gracefully', () => {
      const bundle: ContextBundleData = {
        orderedItems: [makeItem('a', 'item a')],
      }
      const summaryItem = makeSummaryItem('sum-1', 'Summary')

      const result = applyCompactToBundle(bundle, [], summaryItem)

      expect(result.bundle.orderedItems).toHaveLength(1)
      expect(result.bundle.summaryBlocks).toHaveLength(1)
    })
  })

  describe('bundle immutability', () => {
    it('does not mutate the original bundle', () => {
      const originalItems = [makeItem('a', 'item a'), makeItem('b', 'item b')]
      const bundle: ContextBundleData = {
        orderedItems: originalItems,
      }
      const summaryItem = makeSummaryItem('sum-1', 'Summary')

      applyCompactToBundle(bundle, ['a'], summaryItem)

      expect(bundle.orderedItems).toHaveLength(2)
      expect(bundle.orderedItems![0].itemId).toBe('a')
    })
  })
})

// ─── Integration: compact summary appears in projected model input ──────────

describe('compact summary in model input projection', () => {
  it('compact summary appears as assistant message in projected output', () => {
    // Given: a bundle with a compact summary in summaryBlocks
    const bundle: ContextBundleData = {
      orderedItems: [makeItem('c', 'remaining item')],
      summaryBlocks: [
        {
          itemId: 'sum-1',
          content: 'Compacted summary text',
          semanticType: 'summary',
          sourceType: 'memory',
        },
      ],
    }

    // When: we project the bundle to messages
    const result = projectContextBundle(bundle, {})

    // Then: the summary appears as an assistant message
    const summaryMessage = result.messages.find((m) => m.content === 'Compacted summary text')
    expect(summaryMessage).toBeDefined()
    expect(summaryMessage!.role).toBe('assistant')
  })

  it('compacted original items do not appear in projected output', () => {
    // Given: a bundle where compacted items were removed and summary added
    const bundle: ContextBundleData = {
      orderedItems: [makeItem('c', 'remaining item')],
      summaryBlocks: [
        {
          itemId: 'sum-1',
          content: 'Summary of a and b',
          semanticType: 'summary',
          sourceType: 'memory',
        },
      ],
    }

    // When: we project the bundle
    const result = projectContextBundle(bundle, {})

    // Then: compacted item contents are absent
    const allContent = result.messages.map((m) => m.content).join('\n')
    expect(allContent).not.toContain('item a')
    expect(allContent).not.toContain('item b')
    expect(allContent).toContain('remaining item')
    expect(allContent).toContain('Summary of a and b')
  })

  it('full flow: applyCompactToBundle then projectContextBundle', () => {
    // Given: original bundle with items a, b, c
    const originalBundle: ContextBundleData = {
      orderedItems: [
        makeItem('a', 'Original content A'),
        makeItem('b', 'Original content B'),
        makeItem('c', 'Remaining content C'),
      ],
    }
    const summaryItem = makeSummaryItem('sum-1', '## Summary\nA and B were compacted.')

    // When: we apply compaction then project
    const { bundle } = applyCompactToBundle(originalBundle, ['a', 'b'], summaryItem)
    const result = projectContextBundle(bundle, {})

    // Then: summary appears, originals absent, remaining present
    const allContent = result.messages.map((m) => m.content).join('\n')
    expect(allContent).toContain('A and B were compacted.')
    expect(allContent).toContain('Remaining content C')
    expect(allContent).not.toContain('Original content A')
    expect(allContent).not.toContain('Original content B')
  })
})

// ─── Transcript compact-aware skip ──────────────────────────────────────────

describe('transcript compact-aware skip', () => {
  it('filters transcript tool results whose toolCallIds match compacted items', () => {
    // Given: a transcript with tool results for compacted items
    const transcript = [
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'tc-a', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool' as const, content: 'Result from tool a', toolCallId: 'tc-a' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'tc-c', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } }] },
      { role: 'tool' as const, content: 'Result from tool c', toolCallId: 'tc-c' },
    ]
    const compactedToolCallIds = new Set(['tc-a'])

    // When: we filter compacted entries
    const filtered = filterCompactedTranscript(transcript, compactedToolCallIds)

    // Then: compacted tool results and their assistant calls are removed
    expect(filtered).toHaveLength(2)
    expect(filtered[0].content).toBe('')
    expect(filtered[0].toolCalls![0].id).toBe('tc-c')
    expect(filtered[1].content).toBe('Result from tool c')
  })

  it('preserves non-tool transcript entries', () => {
    const transcript = [
      { role: 'assistant' as const, content: 'Hello' },
      { role: 'user' as const, content: 'Hi there' },
    ]
    const compactedToolCallIds = new Set<string>()

    const filtered = filterCompactedTranscript(transcript, compactedToolCallIds)

    expect(filtered).toHaveLength(2)
    expect(filtered[0].content).toBe('Hello')
    expect(filtered[1].content).toBe('Hi there')
  })

  it('returns empty when all entries are compacted', () => {
    const transcript = [
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'tc-1', type: 'function' as const, function: { name: 'tool', arguments: '{}' } }] },
      { role: 'tool' as const, content: 'result', toolCallId: 'tc-1' },
    ]
    const compactedToolCallIds = new Set(['tc-1'])

    const filtered = filterCompactedTranscript(transcript, compactedToolCallIds)

    expect(filtered).toHaveLength(0)
  })
})

// ─── Import the helper under test for transcript filtering ──────────────────
import { filterCompactedTranscript } from '../../../../src/kernel/model-input/compact-summary-rendering.js'

