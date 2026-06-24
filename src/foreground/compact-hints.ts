/**
 * Foreground Compact Hints Helper
 *
 * Lightweight helper for generating compact hints in the foreground bundle
 * builder. Operates on a flat `ContextItem[]` array rather than the full
 * `PipelineContext` used by `ContextManager.assemble()`.
 *
 * Same threshold semantics as `ContextManager.generateCompactHints()`:
 * utilization = tokenEstimate / tokenBudget; triggers when > 0.8.
 *
 * @module foreground/compact-hints
 */

import type { ContextItem, CompactHints } from '../context/types.js'

/** Default utilization threshold matching ContextManager. */
const DEFAULT_THRESHOLD = 0.8

/** Maximum candidate items returned per hint. */
const MAX_CANDIDATES = 10

/**
 * Generates compact hints for foreground context bundles.
 *
 * Evaluates token utilization across all items and, when utilization exceeds
 * the threshold, identifies compressible non-pinned items as compaction
 * candidates while preserving pinned items as must-keep.
 *
 * @param items - All context items (pinned + ordered) in the bundle
 * @param tokenBudget - Total token budget for the bundle
 * @param threshold - Utilization threshold (default 0.8, same as ContextManager)
 * @returns CompactHints with shouldCompactSoon flag and optional candidate/mustKeep ids
 */
export function generateForegroundCompactHints(
  items: readonly ContextItem[],
  tokenBudget: number,
  threshold: number = DEFAULT_THRESHOLD,
): CompactHints {
  const tokenEstimate = items.reduce(
    (sum, item) => sum + (item.estimatedTokens ?? 0),
    0,
  )

  const utilizationRatio = tokenBudget > 0 ? tokenEstimate / tokenBudget : 0

  if (utilizationRatio <= threshold) {
    return { shouldCompactSoon: false }
  }

  const candidateItemIds = items
    .filter((item) => !item.isPinned && item.isCompressible !== false)
    .slice(0, MAX_CANDIDATES)
    .map((item) => item.itemId)

  const mustKeepItemIds = items
    .filter((item) => item.isPinned)
    .map((item) => item.itemId)

  return {
    shouldCompactSoon: true,
    candidateItemIds,
    mustKeepItemIds,
  }
}
