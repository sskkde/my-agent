import type { ContextItemData } from './model-input-types.js'

export interface PairMarker {
  pairId: string
  itemIds: string[]
  indexes: number[]
}

export function protectPairIntegrity(items: ContextItemData[], pairMarkers: PairMarker[]): ContextItemData[] {
  if (pairMarkers.length === 0) return items

  const removedIds = new Set<string>()

  for (const marker of pairMarkers) {
    if (marker.itemIds.length < 2) {
      for (const id of marker.itemIds) {
        removedIds.add(id)
      }
      continue
    }

    const presentIds = new Set(items.map((it) => it.itemId))
    const allPresent = marker.itemIds.every((id) => presentIds.has(id))
    if (!allPresent) {
      for (const id of marker.itemIds) {
        removedIds.add(id)
      }
    }
  }

  if (removedIds.size === 0) return items
  return items.filter((it) => !removedIds.has(it.itemId))
}

export function buildPairMarkers(items: ContextItemData[]): PairMarker[] {
  const groups = new Map<string, ContextItemData[]>()

  for (const item of items) {
    if (!item.requiresPairIntegrity || !item.pairId) continue
    const group = groups.get(item.pairId)
    if (group) {
      group.push(item)
    } else {
      groups.set(item.pairId, [item])
    }
  }

  const markers: PairMarker[] = []

  for (const [pairId, group] of groups) {
    markers.push({
      pairId,
      itemIds: group.map((it) => it.itemId),
      indexes: [],
    })
  }

  return markers
}

import type { LLMMessage } from '../../llm/types.js'

export function validatePairIntegrity(_messages: LLMMessage[]): boolean {
  return true
}
