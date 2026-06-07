import { describe, it, expect } from 'vitest'
import {
  buildPairMarkers,
  protectPairIntegrity,
  validatePairIntegrity,
  type PairMarker,
} from '../../../../src/kernel/model-input/context-pair-integrity.js'
import type { ContextItemData } from '../../../../src/kernel/model-input/model-input-types.js'

describe('buildPairMarkers', () => {
  it('returns empty array when no items require pair integrity', () => {
    const items: ContextItemData[] = [
      { itemId: 'a', content: 'A', semanticType: 'fact' },
      { itemId: 'b', content: 'B', semanticType: 'fact' },
    ]
    expect(buildPairMarkers(items)).toEqual([])
  })

  it('groups items by pairId when requiresPairIntegrity is true', () => {
    const items: ContextItemData[] = [
      { itemId: 'q1', content: 'Question', semanticType: 'fact', requiresPairIntegrity: true, pairId: 'pair-1' },
      { itemId: 'a1', content: 'Answer', semanticType: 'summary', requiresPairIntegrity: true, pairId: 'pair-1' },
      { itemId: 'x', content: 'Standalone', semanticType: 'fact' },
    ]
    const markers = buildPairMarkers(items)
    expect(markers).toHaveLength(1)
    expect(markers[0].pairId).toBe('pair-1')
    expect(markers[0].itemIds).toEqual(['q1', 'a1'])
  })

  it('creates separate groups for different pairIds', () => {
    const items: ContextItemData[] = [
      { itemId: 'q1', content: 'Q1', semanticType: 'fact', requiresPairIntegrity: true, pairId: 'pair-1' },
      { itemId: 'a1', content: 'A1', semanticType: 'summary', requiresPairIntegrity: true, pairId: 'pair-1' },
      { itemId: 'q2', content: 'Q2', semanticType: 'fact', requiresPairIntegrity: true, pairId: 'pair-2' },
      { itemId: 'a2', content: 'A2', semanticType: 'summary', requiresPairIntegrity: true, pairId: 'pair-2' },
    ]
    const markers = buildPairMarkers(items)
    expect(markers).toHaveLength(2)
    const pairIds = markers.map((m) => m.pairId).sort()
    expect(pairIds).toEqual(['pair-1', 'pair-2'])
  })
})

describe('protectPairIntegrity', () => {
  it('returns all items when all pair partners are present', () => {
    const items: ContextItemData[] = [
      { itemId: 'q1', content: 'Q', semanticType: 'fact', requiresPairIntegrity: true, pairId: 'p1' },
      { itemId: 'a1', content: 'A', semanticType: 'summary', requiresPairIntegrity: true, pairId: 'p1' },
    ]
    const markers: PairMarker[] = [{ pairId: 'p1', itemIds: ['q1', 'a1'], indexes: [] }]
    const result = protectPairIntegrity(items, markers)
    expect(result).toHaveLength(2)
  })

  it('removes both items when one partner is missing', () => {
    const items: ContextItemData[] = [{ itemId: 'q1', content: 'Q', semanticType: 'fact' }]
    const markers: PairMarker[] = [{ pairId: 'p1', itemIds: ['q1', 'a1'], indexes: [] }]
    const result = protectPairIntegrity(items, markers)
    expect(result).toHaveLength(0)
  })

  it('removes single-member pair groups (pair requires at least 2 members)', () => {
    const items: ContextItemData[] = [
      { itemId: 'q1', content: 'Q', semanticType: 'fact', requiresPairIntegrity: true, pairId: 'p1' },
      { itemId: 'standalone', content: 'S', semanticType: 'fact' },
    ]
    const markers = buildPairMarkers(items)
    const result = protectPairIntegrity(items, markers)
    expect(result).toHaveLength(1)
    expect(result[0].itemId).toBe('standalone')
  })

  it('keeps non-paired items intact', () => {
    const items: ContextItemData[] = [
      { itemId: 'standalone', content: 'S', semanticType: 'fact' },
      { itemId: 'q1', content: 'Q', semanticType: 'fact' },
    ]
    const markers: PairMarker[] = [{ pairId: 'p1', itemIds: ['q1', 'a1'], indexes: [] }]
    const result = protectPairIntegrity(items, markers)
    expect(result).toHaveLength(1)
    expect(result[0].itemId).toBe('standalone')
  })

  it('returns items unchanged when no pair markers', () => {
    const items: ContextItemData[] = [
      { itemId: 'a', content: 'A' },
      { itemId: 'b', content: 'B' },
    ]
    const result = protectPairIntegrity(items, [])
    expect(result).toEqual(items)
  })
})

describe('validatePairIntegrity', () => {
  it('returns true for any message array', () => {
    expect(validatePairIntegrity([])).toBe(true)
    expect(validatePairIntegrity([{ role: 'user', content: 'hi' }])).toBe(true)
  })
})
