// =============================================================================
// Cursor Pagination Utilities
// =============================================================================

import type { CursorPaginationParams, CursorPage } from './cursor-types.js'

/**
 * Encode cursor values into an opaque Base64 string.
 * Clients should treat the cursor as opaque and never parse or decode it.
 */
export function encodeCursor(values: Record<string, unknown>): string {
  const json = JSON.stringify(values)
  return Buffer.from(json, 'utf-8').toString('base64')
}

/**
 * Decode an opaque cursor string back into its values.
 * Throws an error with a descriptive message if the cursor is invalid.
 */
export function decodeCursor(cursor: string): Record<string, unknown> {
  try {
    const json = Buffer.from(cursor, 'base64').toString('utf-8')
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Cursor must decode to a JSON object')
    }
    return parsed as Record<string, unknown>
  } catch (err) {
    if (err instanceof Error && err.message === 'Cursor must decode to a JSON object') {
      throw err
    }
    throw new Error('Invalid cursor: unable to decode')
  }
}

/**
 * Apply cursor-based pagination to a pre-fetched list of items.
 *
 * Strategy: fetch `limit + 1` items from the store, then:
 * - If cursor is provided, skip items until the cursor value is found (exclusive)
 * - Trim results to `limit` items
 * - Set `hasMore = true` if more than `limit` items were available
 * - Set `nextCursor` from the last item's cursor value (or null if no more)
 *
 * @param items - Full list of items (already sorted and filtered)
 * @param params - Cursor pagination parameters (cursor, limit)
 * @param getCursorValue - Function to extract cursor value from an item
 * @returns CursorPage with items, nextCursor, and hasMore
 */
export function applyCursorPagination<T>(
  items: T[],
  params: CursorPaginationParams,
  getCursorValue: (item: T) => Record<string, unknown>,
): CursorPage<T> {
  const limit = params.limit ?? 50
  let startIndex = 0

  if (params.cursor) {
    const cursorValues = decodeCursor(params.cursor)
    const cursorIndex = items.findIndex((item) => {
      const itemValues = getCursorValue(item)
      return isCursorMatch(itemValues, cursorValues)
    })

    startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1
  }

  const remaining = items.slice(startIndex)
  const hasMore = remaining.length > limit
  const pageItems = remaining.slice(0, limit)

  const nextCursor =
    hasMore && pageItems.length > 0 ? encodeCursor(getCursorValue(pageItems[pageItems.length - 1])) : null

  return {
    items: pageItems,
    nextCursor,
    hasMore,
  }
}

function isCursorMatch(itemValues: Record<string, unknown>, cursorValues: Record<string, unknown>): boolean {
  const itemKeys = Object.keys(itemValues)
  const cursorKeys = Object.keys(cursorValues)

  if (itemKeys.length !== cursorKeys.length) {
    return false
  }

  return itemKeys.every((key) => key in cursorValues && itemValues[key] === cursorValues[key])
}
