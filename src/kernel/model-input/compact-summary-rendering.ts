/**
 * Compact Summary Rendering - Helpers for representing compact summaries
 * in subsequent model input after an applied compaction.
 *
 * Responsibilities:
 * - Filter compacted items from a ContextBundleData (immutably)
 * - Append the summary item to summaryBlocks with proper metadata
 * - Filter transcript messages to skip tool results for compacted items
 *
 * @module kernel/model-input/compact-summary-rendering
 */

import type { ContextItem } from '../../context/types.js'
import type { ContextBundleData, ContextItemData } from './model-input-types.js'
import type { LLMMessage } from '../../llm/types.js'

export interface CompactBundleResult {
  readonly bundle: ContextBundleData
  readonly summaryBlock: ContextItemData
}

/**
 * Produces a new ContextBundleData with compacted items removed and the
 * summary item appended to summaryBlocks.
 *
 * Immutable: the original bundle is never mutated.
 */
export function applyCompactToBundle(
  bundle: ContextBundleData,
  compactedItemIds: readonly string[],
  summaryItem: ContextItem,
): CompactBundleResult {
  const compactedSet = new Set(compactedItemIds)

  const summaryBlock: ContextItemData = {
    itemId: summaryItem.itemId,
    content: summaryItem.content,
    semanticType: summaryItem.semanticType,
    sourceType: summaryItem.sourceType,
    isPinned: summaryItem.isPinned,
  }

  return {
    bundle: {
      pinnedItems: bundle.pinnedItems?.filter((i) => !compactedSet.has(i.itemId)),
      orderedItems: bundle.orderedItems?.filter((i) => !compactedSet.has(i.itemId)),
      summaryBlocks: [...(bundle.summaryBlocks ?? []), summaryBlock],
      planView: bundle.planView,
      workflowStepView: bundle.workflowStepView,
      backgroundRunView: bundle.backgroundRunView,
      triggerView: bundle.triggerView,
      transcript: bundle.transcript,
      invocationSource: bundle.invocationSource,
    },
    summaryBlock,
  }
}

/**
 * Filters transcript LLM messages to exclude tool results (and their
 * triggering assistant tool-call messages) whose toolCallIds match
 * compacted items.
 *
 * This prevents re-inflation of compacted original content in
 * transcript-derived messages after compaction.
 */
export function filterCompactedTranscript(
  transcript: readonly LLMMessage[],
  compactedToolCallIds: ReadonlySet<string>,
): LLMMessage[] {
  if (compactedToolCallIds.size === 0) {
    return [...transcript]
  }

  const filtered: LLMMessage[] = []

  for (const msg of transcript) {
    if (msg.role === 'tool' && msg.toolCallId && compactedToolCallIds.has(msg.toolCallId)) {
      continue
    }
    if (msg.role === 'assistant' && msg.toolCalls) {
      const hasCompacted = msg.toolCalls.some((tc) => compactedToolCallIds.has(tc.id))
      if (hasCompacted) {
        const remaining = msg.toolCalls.filter((tc) => !compactedToolCallIds.has(tc.id))
        if (remaining.length === 0) continue
        filtered.push({ ...msg, toolCalls: remaining })
        continue
      }
    }
    filtered.push(msg)
  }

  return filtered
}
