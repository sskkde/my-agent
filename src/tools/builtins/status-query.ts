import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolExecutionContext } from '../types.js'
import type { PlannerRunStore } from '../../storage/planner-run-store.js'
import type { PlanStore } from '../../storage/plan-store.js'
import { PLANNER_STATES } from '../../shared/states.js'

export interface StatusQueryParams {
  targetId?: string
}

export interface StatusQueryResult {
  activeWork: {
    plannerRuns: Array<{
      plannerRunId: string
      status: string
      objective?: string
      progress?: string
    }>
    backgroundRuns: Array<{
      backgroundRunId: string
      status: string
      taskSummary?: string
      progress?: string
    }>
    pendingApprovals: Array<{
      approvalId: string
      status: string
      summary?: string
    }>
  }
  timestamp: string
  [key: string]: unknown
}

/**
 * Optional stores injected by the composition root (see T5 in
 * `src/api/context.ts`). When absent, the tool keeps its legacy placeholder
 * behavior so existing registrations and tests keep working.
 */
export interface StatusQueryToolDeps {
  plannerRunStore?: PlannerRunStore
  planStore?: PlanStore
}

const TERMINAL_PLANNER_STATES: ReadonlySet<string> = new Set([
  PLANNER_STATES.COMPLETED,
  PLANNER_STATES.FAILED,
  PLANNER_STATES.CANCELLED,
])

export function createStatusQueryTool(deps: StatusQueryToolDeps = {}): ToolDefinition {
  const handler: ToolHandler = async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
    const typedParams = params as StatusQueryParams
    const result: StatusQueryResult = {
      activeWork: {
        plannerRuns: resolvePlannerRuns(deps, typedParams, context?.userId),
        backgroundRuns: [],
        pendingApprovals: [],
      },
      timestamp: new Date().toISOString(),
    }

    return {
      success: true,
      data: result,
      resultPreview: `Active work status: ${result.activeWork.plannerRuns.length} planner run(s), ${result.activeWork.backgroundRuns.length} background run(s), ${result.activeWork.pendingApprovals.length} pending approval(s)`,
      structuredContent: result,
    }
  }

  return {
    name: 'status_query',
    description: 'Query active work status for the current user or a specific run',
    category: 'read',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        targetId: { type: 'string', description: 'Optional specific run ID to query' },
      },
      required: [],
    },
    handler,
  }
}

function resolvePlannerRuns(
  deps: StatusQueryToolDeps,
  params: StatusQueryParams,
  userId: string | undefined,
): StatusQueryResult['activeWork']['plannerRuns'] {
  if (!deps.plannerRunStore) {
    return params.targetId
      ? [
          {
            plannerRunId: params.targetId,
            status: 'active',
            objective: 'Task in progress',
            progress: '50%',
          },
        ]
      : []
  }

  if (params.targetId) {
    const run = deps.plannerRunStore.getById(params.targetId)
    if (!run) {
      return []
    }

    const plan = deps.planStore?.getPlan(run.planId)
    const completedSteps = plan?.steps.filter((step) => step.status === 'completed').length ?? 0
    const totalSteps = plan?.steps.length ?? 0

    return [
      {
        plannerRunId: run.plannerRunId,
        status: run.status,
        ...(plan?.objective ? { objective: plan.objective } : {}),
        progress: formatProgress(completedSteps, totalSteps),
      },
    ]
  }

  if (!userId) {
    return []
  }

  return deps.plannerRunStore
    .findActive(userId)
    .filter((run) => !TERMINAL_PLANNER_STATES.has(run.status))
    .map((run) => ({ plannerRunId: run.plannerRunId, status: run.status }))
}

function formatProgress(completedSteps: number, totalSteps: number): string {
  if (totalSteps === 0) {
    return '0%'
  }
  return `${Math.round((completedSteps / totalSteps) * 100)}%`
}
