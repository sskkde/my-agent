/**
 * Context Desk Card State Model
 *
 * READ-ONLY POLICY:
 * All Context Desk cards are strictly read-only. They display information only.
 * No approve/reject/edit/run-control actions are permitted from these cards.
 * Action buttons should be disabled or removed entirely.
 *
 * This policy is enforced by the card contracts and data adapters.
 */

// =============================================================================
// Base State Types
// =============================================================================

/**
 * Base state for all cards - discriminated union for type safety
 */
export type CardState<T> = LoadingState | ReadyState<T> | EmptyState | ErrorState

export interface LoadingState {
  readonly status: 'loading'
  /** Optional loading message to display */
  readonly message?: string
}

export interface ReadyState<T> {
  readonly status: 'ready'
  /** The loaded data */
  readonly data: T
  /** Timestamp when data was last refreshed */
  readonly lastUpdated?: string
}

export interface EmptyState {
  readonly status: 'empty'
  /** Empty state message to display */
  readonly message: string
  /** Optional hint for why data might be empty */
  readonly hint?: string
}

export interface ErrorState {
  readonly status: 'error'
  /** Error message to display */
  readonly message: string
  /** Optional error code for debugging */
  readonly code?: string
  /** Whether this error can be retried */
  readonly retryable?: boolean
}

// =============================================================================
// State Factory Functions
// =============================================================================

/**
 * Create a loading state
 */
export function loading(message?: string): LoadingState {
  return { status: 'loading', message }
}

/**
 * Create a ready state with data
 */
export function ready<T>(data: T, lastUpdated?: string): ReadyState<T> {
  return { status: 'ready', data, lastUpdated }
}

/**
 * Create an empty state
 */
export function empty(message: string, hint?: string): EmptyState {
  return { status: 'empty', message, hint }
}

/**
 * Create an error state
 */
export function error(message: string, code?: string, retryable = false): ErrorState {
  return { status: 'error', message, code, retryable }
}

// =============================================================================
// State Type Guards
// =============================================================================

export function isLoading<T>(state: CardState<T>): state is LoadingState {
  return state.status === 'loading'
}

export function isReady<T>(state: CardState<T>): state is ReadyState<T> {
  return state.status === 'ready'
}

export function isEmpty<T>(state: CardState<T>): state is EmptyState {
  return state.status === 'empty'
}

export function isError<T>(state: CardState<T>): state is ErrorState {
  return state.status === 'error'
}
