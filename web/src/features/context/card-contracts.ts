/**
 * Context Desk Card Prop Contracts
 *
 * READ-ONLY POLICY:
 * All card props are designed for read-only display. Cards should NOT contain
 * approve/reject/edit/run-control actions. Any action buttons must be disabled
 * or navigate to other pages (e.g., full approvals page).
 *
 * These contracts define the shape of data each card receives.
 */

import type { ApprovalInfo, MemoryItem, RunInfo, ConsoleTimelineEvent } from '../../api/types'
import type { CardState } from './card-state'

// =============================================================================
// Approval Card Contract
// =============================================================================

/**
 * Approval card displays pending approvals for a session.
 *
 * Data Source: getApprovals() filtered by sessionId
 * Classification: real-data
 *
 * READ-ONLY: No approve/reject actions on this card.
 * Users must navigate to full ApprovalsTab for actions.
 */
export interface ApprovalCardData {
  /** List of approvals to display (filtered by session if applicable) */
  approvals: ApprovalInfo[]
  /** Total count for pagination indicator */
  total: number
  /** Session ID this card is scoped to (null if global view) */
  sessionId: string | null
}

export interface ApprovalCardProps {
  /** Card state with approval data */
  state: CardState<ApprovalCardData>
  /** Optional session ID to filter approvals (null = show all) */
  sessionId?: string | null
  /** Optional max items to display */
  maxItems?: number
}

// =============================================================================
// Memory Card Contract
// =============================================================================

/**
 * Memory card displays memory entries for context.
 *
 * Data Source: getMemories() (global, no session filter)
 * Classification: real-data
 *
 * READ-ONLY: No delete/edit actions on this card.
 * Memory API is global and has no sessionId filter.
 */
export interface MemoryCardData {
  /** List of memory entries to display */
  memories: MemoryItem[]
  /** Total count for pagination indicator */
  total: number
}

export interface MemoryCardProps {
  /** Card state with memory data */
  state: CardState<MemoryCardData>
  /** Optional max items to display */
  maxItems?: number
  /** Optional search query */
  query?: string
}

// =============================================================================
// Runs Card Contract
// =============================================================================

/**
 * Runs card displays background runs for a session.
 *
 * Data Source: getRuns() filtered by sessionId via metadata
 * Classification: real-data
 * SSE Support: subscribeRuns() for real-time updates
 *
 * READ-ONLY: No run-control actions (pause/resume/cancel) on this card.
 * Users must navigate to ObservabilityTab for control actions.
 */
export interface RunsCardData {
  /** List of runs to display */
  runs: RunInfo[]
  /** Total count for pagination indicator */
  total: number
  /** Session ID this card is scoped to (null if global view) */
  sessionId: string | null
  /** Whether SSE subscription is active */
  streaming: boolean
}

export interface RunsCardProps {
  /** Card state with runs data */
  state: CardState<RunsCardData>
  /** Optional session ID to filter runs (null = show all) */
  sessionId?: string | null
  /** Optional max items to display */
  maxItems?: number
}

// =============================================================================
// Tool Activity Card Contract
// =============================================================================

/**
 * Tool activity card displays tool calls and results for a session.
 *
 * Data Source: getSessionTimeline() filtered by eventType (tool_call, tool_result)
 * Classification: derived (filtered from timeline)
 * SSE Support: subscribeSessionTimeline() for real-time updates
 *
 * READ-ONLY: This is a log view only. No actions available.
 */
export interface ToolActivityCardData {
  /** Tool events (tool_call and tool_result) for the session */
  events: ConsoleTimelineEvent[]
  /** Total count for pagination indicator */
  total: number
  /** Session ID this card is scoped to */
  sessionId: string
  /** Whether SSE subscription is active */
  streaming: boolean
}

export interface ToolActivityCardProps {
  /** Card state with tool activity data */
  state: CardState<ToolActivityCardData>
  /** Session ID is required for tool activity */
  sessionId: string
  /** Optional max items to display */
  maxItems?: number
}

// =============================================================================
// Empty State Metadata
// =============================================================================

/**
 * Metadata returned when data source is unavailable.
 * Used for graceful degradation when APIs are unreachable.
 */
export interface EmptyStateMetadata {
  /** Reason for empty state */
  reason: 'no_data' | 'api_unavailable' | 'no_session' | 'filter_empty'
  /** Human-readable message */
  message: string
  /** Optional hint for user action */
  hint?: string
}

// =============================================================================
// Card Configuration
// =============================================================================

/**
 * Configuration for card refresh behavior
 */
export interface CardRefreshConfig {
  /** Auto-refresh interval in milliseconds (0 = disabled) */
  interval?: number
  /** Enable SSE streaming if available */
  streaming?: boolean
  /** Retry on error */
  retryOnError?: boolean
  /** Max retry attempts */
  maxRetries?: number
}

/**
 * Common props shared by all context cards
 */
export interface BaseCardProps {
  /** Optional CSS class */
  className?: string
  /** Optional test ID */
  'data-testid'?: string
  /** Refresh configuration */
  refresh?: CardRefreshConfig
}
