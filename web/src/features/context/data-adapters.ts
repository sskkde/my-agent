/**
 * Context Desk Data Adapters
 *
 * READ-ONLY POLICY:
 * These adapters fetch data for display only. They do not perform any
 * mutation operations (approve, reject, edit, run-control).
 *
 * Adapters use existing API client methods and return empty-state metadata
 * when data is unavailable or APIs are unreachable.
 */

import {
  getApprovals,
  getMemories,
  getRuns,
  getSessionTimeline,
} from '../../api/client'
import type {
  ApprovalInfo,
  RunInfo,
  ConsoleTimelineEvent,
} from '../../api/types'
import type { CardState } from './card-state'
import type { EmptyStateMetadata } from './card-contracts'
import { ready, empty, error } from './card-state'
import type {
  ApprovalCardData,
  MemoryCardData,
  RunsCardData,
  ToolActivityCardData,
} from './card-contracts'

// =============================================================================
// Approval Card Adapter
// =============================================================================

/**
 * Adapter options for approval card
 */
export interface ApprovalAdapterOptions {
  /** Session ID to filter approvals (null = all sessions) */
  sessionId?: string | null
  /** Max items to return */
  maxItems?: number
  /** Filter by status */
  status?: ApprovalInfo['status']
}

/**
 * Fetch approval data for the approval card.
 *
 * Uses getApprovals() and filters by sessionId if provided.
 *
 * @param options - Adapter options
 * @returns Card state with approval data or error
 */
export async function fetchApprovalCardData(
  options: ApprovalAdapterOptions = {},
): Promise<CardState<ApprovalCardData>> {
  const { sessionId = null, maxItems, status } = options

  try {
    const response = await getApprovals()
    let approvals = response.approvals || []

    // Filter by session if provided
    if (sessionId) {
      approvals = approvals.filter((a) => a.sessionId === sessionId)
    }

    // Filter by status if provided
    if (status) {
      approvals = approvals.filter((a) => a.status === status)
    }

    // Apply maxItems limit
    const total = approvals.length
    if (maxItems !== undefined && maxItems > 0) {
      approvals = approvals.slice(0, maxItems)
    }

    // Return empty state if no approvals
    if (approvals.length === 0) {
      const metadata: EmptyStateMetadata = {
        reason: sessionId ? 'filter_empty' : 'no_data',
        message: '暂无审批请求',
        hint: sessionId
          ? '当前会话没有待处理的审批'
          : '系统中没有审批记录',
      }
      return empty(metadata.message, metadata.hint)
    }

    return ready<ApprovalCardData>(
      {
        approvals,
        total,
        sessionId,
      },
      new Date().toISOString(),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch approvals'
    return error(message, 'APPROVALS_FETCH_ERROR', true)
  }
}

// =============================================================================
// Memory Card Adapter
// =============================================================================

/**
 * Adapter options for memory card
 */
export interface MemoryAdapterOptions {
  /** Search query */
  query?: string
  /** Filter by type */
  type?: string
  /** Max items to return */
  maxItems?: number
}

/**
 * Fetch memory data for the memory card.
 *
 * Uses getMemories() - note that memory API is global (no sessionId filter).
 *
 * @param options - Adapter options
 * @returns Card state with memory data or error
 */
export async function fetchMemoryCardData(
  options: MemoryAdapterOptions = {},
): Promise<CardState<MemoryCardData>> {
  const { query, type, maxItems } = options

  try {
    const response = await getMemories({
      query,
      type,
      limit: maxItems,
    })
    const memories = response.memories || []
    const total = response.total || memories.length

    // Return empty state if no memories
    if (memories.length === 0) {
      const metadata: EmptyStateMetadata = {
        reason: query || type ? 'filter_empty' : 'no_data',
        message: '暂无记忆条目',
        hint: '系统尚未存储任何记忆',
      }
      return empty(metadata.message, metadata.hint)
    }

    return ready<MemoryCardData>(
      {
        memories,
        total,
      },
      new Date().toISOString(),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch memories'
    return error(message, 'MEMORY_FETCH_ERROR', true)
  }
}

// =============================================================================
// Runs Card Adapter
// =============================================================================

/**
 * Adapter options for runs card
 */
export interface RunsAdapterOptions {
  /** Session ID to filter runs (null = all sessions) */
  sessionId?: string | null
  /** Max items to return */
  maxItems?: number
  /** Filter by status */
  status?: RunInfo['status']
}

/**
 * Fetch runs data for the runs card.
 *
 * Uses getRuns() and filters by sessionId if provided.
 * Note: Runs don't have direct sessionId field, filtering may be via metadata.
 *
 * @param options - Adapter options
 * @returns Card state with runs data or error
 */
export async function fetchRunsCardData(
  options: RunsAdapterOptions = {},
): Promise<CardState<RunsCardData>> {
  const { sessionId = null, maxItems, status } = options

  try {
    const response = await getRuns()
    let runs = response.runs || []

    // Filter by status if provided
    if (status) {
      runs = runs.filter((r) => r.status === status)
    }

    // Note: RunInfo doesn't have sessionId field directly
    // Filtering would need to be done via metadata or backend support
    // For now, we return all runs and note this in the contract
    // This may need backend changes to support session-scoped runs

    // Apply maxItems limit
    const total = runs.length
    if (maxItems !== undefined && maxItems > 0) {
      runs = runs.slice(0, maxItems)
    }

    // Return empty state if no runs
    if (runs.length === 0) {
      const metadata: EmptyStateMetadata = {
        reason: 'no_data',
        message: '暂无运行记录',
        hint: '没有后台任务正在运行',
      }
      return empty(metadata.message, metadata.hint)
    }

    return ready<RunsCardData>(
      {
        runs,
        total,
        sessionId,
        streaming: false, // Set by component when SSE subscription active
      },
      new Date().toISOString(),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch runs'
    return error(message, 'RUNS_FETCH_ERROR', true)
  }
}

// =============================================================================
// Tool Activity Card Adapter
// =============================================================================

/**
 * Event types that represent tool activity
 */
const TOOL_ACTIVITY_EVENT_TYPES: Set<string> = new Set([
  'tool_call',
  'tool_result',
])

/**
 * Adapter options for tool activity card
 */
export interface ToolActivityAdapterOptions {
  /** Session ID (required for tool activity) */
  sessionId: string
  /** Max items to return */
  maxItems?: number
}

/**
 * Fetch tool activity data for the tool activity card.
 *
 * Uses getSessionTimeline() and filters by eventType (tool_call, tool_result).
 *
 * @param options - Adapter options
 * @returns Card state with tool activity data or error
 */
export async function fetchToolActivityCardData(
  options: ToolActivityAdapterOptions,
): Promise<CardState<ToolActivityCardData>> {
  const { sessionId, maxItems } = options

  if (!sessionId) {
    const metadata: EmptyStateMetadata = {
      reason: 'no_session',
      message: '无会话信息',
      hint: '请选择一个会话以查看工具活动',
    }
    return empty(metadata.message, metadata.hint)
  }

  try {
    const response = await getSessionTimeline(sessionId)
    const allEvents = response.events || []

    // Filter for tool activity events
    let toolEvents = allEvents.filter((e) =>
      TOOL_ACTIVITY_EVENT_TYPES.has(e.eventType),
    ) as ConsoleTimelineEvent[]

    // Apply maxItems limit
    const total = toolEvents.length
    if (maxItems !== undefined && maxItems > 0) {
      toolEvents = toolEvents.slice(0, maxItems)
    }

    // Return empty state if no tool events
    if (toolEvents.length === 0) {
      const metadata: EmptyStateMetadata = {
        reason: 'no_data',
        message: '暂无工具活动',
        hint: '当前会话没有工具调用记录',
      }
      return empty(metadata.message, metadata.hint)
    }

    return ready<ToolActivityCardData>(
      {
        events: toolEvents,
        total,
        sessionId,
        streaming: false, // Set by component when SSE subscription active
      },
      new Date().toISOString(),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch tool activity'
    return error(message, 'TOOL_ACTIVITY_FETCH_ERROR', true)
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create empty state metadata for a specific card type
 */
export function createEmptyMetadata(
  cardType: 'approvals' | 'memory' | 'runs' | 'tool-activity',
  reason: EmptyStateMetadata['reason'],
): EmptyStateMetadata {
  const messages: Record<string, { message: string; hint?: string }> = {
    approvals: {
      message: '暂无审批请求',
      hint: '当前会话没有待处理的审批',
    },
    memory: {
      message: '暂无记忆条目',
      hint: '系统尚未存储任何记忆',
    },
    runs: {
      message: '暂无运行记录',
      hint: '没有后台任务正在运行',
    },
    'tool-activity': {
      message: '暂无工具活动',
      hint: '当前会话没有工具调用记录',
    },
  }

  const config = messages[cardType]
  return {
    reason,
    message: config.message,
    hint: config.hint,
  }
}
