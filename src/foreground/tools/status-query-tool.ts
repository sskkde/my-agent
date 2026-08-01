/**
 * Status Query Tool
 * Foreground tool for querying active work status
 */

import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import type { SubagentRunStore } from '../../storage/subagent-run-store.js'
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
 */
export async function handleStatusQuery(
  deps: StatusQueryDeps,
  userMessage?: string,
): Promise<ForegroundToolResult<StatusQueryData>> {
  try {
    const { plannerRunStore, subagentRunStore, approvalStore, userId } = deps

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

    const statusText =
      parts.length > 0
        ? `Active work: ${parts.join(', ')}.`
        : 'No active work. All clear.'

    return createSuccessResult<StatusQueryData>(
      {
        activePlannerRuns,
        activeSubagentRuns,
        pendingApprovals,
        statusText,
      },
      userMessage || statusText,
    )
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
