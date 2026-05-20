// =============================================================================
// Cursor Pagination Types
// =============================================================================

/**
 * Parameters for cursor-based pagination.
 * Cursor pagination is more efficient than offset pagination for large datasets
 * as it avoids the performance issues of OFFSET queries.
 */
export interface CursorPaginationParams {
  /** Opaque cursor string from previous response to continue pagination */
  cursor?: string;
  /** Maximum number of items to return (default varies by endpoint) */
  limit?: number;
}

/**
 * Response wrapper for cursor-paginated results.
 * Replaces offset/limit with a cursor for efficient pagination.
 */
export interface CursorPaginatedResponse<T> {
  /** Array of items for the current page */
  items: T[];
  /** Opaque cursor to fetch the next page, null if no more results */
  nextCursor: string | null;
  /** Whether more results exist beyond this page */
  hasMore: boolean;
  /** Total count of items (may be approximate for large datasets) */
  total: number;
}

/**
 * Internal type for pagination computation.
 * Used by pagination utilities to compute the next cursor.
 */
export interface CursorPage<T> {
  /** Array of items for the current page */
  items: T[];
  /** Opaque cursor to fetch the next page, null if no more results */
  nextCursor: string | null;
  /** Whether more results exist beyond this page */
  hasMore: boolean;
}
