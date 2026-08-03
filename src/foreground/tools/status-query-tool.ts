/**
 * Status Query Tool
 * Foreground tool for querying active work status
 */

import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import type { SubagentRunStore, SubagentRunRecord } from '../../storage/subagent-run-store.js'
import type { ApprovalStore } from '../../storage/approval-store.js'
import { PLANNER_STATES, BACKGROUND_SUBAGENT_STATES, APPROVAL_STATES } from '../../shared/states.js'
import { createSuccessResult, createErrorResult } from './foreground-tool-result.js'
import type { ForegroundToolResult } from './foreground-tool-result.js'

export const STATUS_QUERY_TOOL_ID = 'foreground_status_query'

/**
 * Status query response data
 */
export interface StatusQueryData {
  activePlannerRuns: number
  activeSubagentRuns: number
  pendingApprovals: number
  statusText: string
  /**
   * Targeted task lookup (only when the input carries a taskId/childSessionId/
   * runtimeActionId/subagentRunId): the resolved subagent run attempt, or
   * `null` when no run resolves for the supplied id.
   */
  taskStatus?: TaskStatusDetail | null
}

/**
 * Detail of a single subagent run attempt resolved by a targeted status query.
 */
export interface TaskStatusDetail {
  subagentRunId: string
  taskId?: string
  childSessionId?: string
  backgroundRunId?: string
  status: string
  agentType: string
  agentProfile?: string
  isChildTask: boolean
  createdAt: string
  completedAt?: string
  error?: { code: string; message: string }
}

/**
 * Optional targeted-status input. At most one target id is honoured per call:
 * `taskId` or `childSessionId` (both resolve to the newest attempt for that
 * child session) take precedence over the legacy `runtimeActionId` /
 * `subagentRunId` (which resolve by exact run id).
 */
export interface StatusQueryInput {
  taskId?: string
  childSessionId?: string
  runtimeActionId?: string
  subagentRunId?: string
  userMessage?: string
}

/**
 * Dependencies for status query tool
 */
export interface StatusQueryDeps {
  plannerRunStore: PlannerRunStore
  subagentRunStore: SubagentRunStore
  approvalStore: ApprovalStore
  userId: string
  sessionId: string
  turnId: string
}

const ACTIVE_PLANNER_STATES: ReadonlySet<string> = new Set([
  PLANNER_STATES.PLANNING,
  PLANNER_STATES.REPLANNING,
  PLANNER_STATES.PAUSED,
  PLANNER_STATES.WAITING_FOR_APPROVAL,
  PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT,
])
const ACTIVE_SUBAGENT_STATES: ReadonlySet<string> = new Set([
  BACKGROUND_SUBAGENT_STATES.QUEUED,
  BACKGROUND_SUBAGENT_STATES.RUNNING,
  BACKGROUND_SUBAGENT_STATES.WAITING_FOR_USER,
  BACKGROUND_SUBAGENT_STATES.WAITING_FOR_APPROVAL,
  BACKGROUND_SUBAGENT_STATES.RECOVERING,
])
const PENDING_APPROVAL_STATES: ReadonlySet<string> = new Set([APPROVAL_STATES.PENDING])

/**
 * Handle status query - queries active work status directly from stores.
 *
 * Previously dispatched a RuntimeAction to the 'gateway' runtime, but no
 * adapter was registered for that target.  The status query is a simple
 * read-only aggregation that can be satisfied directly from the three
 * stores already available in ForegroundToolRuntimeDeps.
 *
 * A targeted lookup (`taskId`/`childSessionId`/`runtimeActionId`/
 * `subagentRunId`) additionally resolves the matching subagent run attempt —
 * both the new child-task ids and the legacy ids stay supported. A string
 * input is treated as a legacy user message.
 */
export async function handleStatusQuery(
  deps: StatusQueryDeps,
  input?: StatusQueryInput | string,
): Promise<ForegroundToolResult<StatusQueryData>> {
  try {
    const { plannerRunStore, subagentRunStore, approvalStore, userId } = deps
    const query: StatusQueryInput = typeof input === 'string' ? { userMessage: input } : (input ?? {})

    const plannerRuns = plannerRunStore.findByUser(userId)
    const activePlannerRuns = plannerRuns.filter((r) => ACTIVE_PLANNER_STATES.has(r.status)).length

    const subagentRuns = subagentRunStore.query({ userId })
    const activeSubagentRuns = subagentRuns.filter((r) => ACTIVE_SUBAGENT_STATES.has(r.status)).length

    const approvals = approvalStore.findByUser(userId)
    const pendingApprovals = approvals.filter((a) => PENDING_APPROVAL_STATES.has(a.status)).length

    const parts: string[] = []
    if (activePlannerRuns > 0) parts.push(`${activePlannerRuns} active planner run(s)`)
    if (activeSubagentRuns > 0) parts.push(`${activeSubagentRuns} active subagent run(s)`)
    if (pendingApprovals > 0) parts.push(`${pendingApprovals} pending approval(s)`)

    let statusText = parts.length > 0 ? `Active work: ${parts.join(', ')}.` : 'No active work. All clear.'
    const taskStatus = resolveTaskStatus(subagentRunStore, userId, query)
    if (query.taskId || query.childSessionId || query.runtimeActionId || query.subagentRunId) {
      const targetId = query.taskId ?? query.childSessionId ?? query.runtimeActionId ?? query.subagentRunId!
      statusText = taskStatus
        ? `Task ${targetId} (${taskStatus.status}) — ${taskStatus.agentType}`
        : `No task found for ${targetId}`
    }

    const data: StatusQueryData = {
      activePlannerRuns,
      activeSubagentRuns,
      pendingApprovals,
      statusText,
      ...(query.taskId || query.childSessionId || query.runtimeActionId || query.subagentRunId ? { taskStatus } : {}),
    }

    return createSuccessResult<StatusQueryData>(data, query.userMessage || statusText)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return createErrorResult<StatusQueryData>(
      'STATUS_QUERY_FAILED',
      errorMessage,
      true,
      'Status check failed due to an error.',
    )
  }
}

function resolveTaskStatus(
  subagentRunStore: SubagentRunStore,
  userId: string,
  query: StatusQueryInput,
): TaskStatusDetail | null | undefined {
  if (!query.taskId && !query.childSessionId && !query.runtimeActionId && !query.subagentRunId) {
    return undefined
  }

  let run: SubagentRunRecord | undefined
  if (query.taskId) {
    run = subagentRunStore.query({ taskId: query.taskId, userId })[0]
  } else if (query.childSessionId) {
    run = subagentRunStore.query({ childSessionId: query.childSessionId, userId })[0]
  } else {
    const targetId = query.runtimeActionId ?? query.subagentRunId!
    run = subagentRunStore.getById(targetId) ?? undefined
  }

  if (!run) return null

  const detail: TaskStatusDetail = {
    subagentRunId: run.subagentRunId,
    taskId: run.taskId,
    childSessionId: run.childSessionId,
    backgroundRunId: run.backgroundRunId,
    status: run.status,
    agentType: run.agentType,
    agentProfile: run.agentProfile,
    isChildTask: !!(run.childSessionId || run.taskId),
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  }
  if (run.errorCode) {
    detail.error = { code: run.errorCode, message: run.errorMessage ?? '' }
  }
  return detail
}
