/**
 * Subagent-run observability metrics — Todo 17 additive child-session wiring.
 *
 * ADDITIVE ONLY: the metric name references the existing `subagent_runs`
 * table (never renamed) and every new label is a child-session correlation
 * dimension (parent session, task, profile, launch mode). No existing metric
 * name or label is touched.
 */

import type { MetricRecord } from './types.js'
import { generateId } from '../shared/ids.js'

/** Counter of subagent run attempts. Fresh launches and resumes both count (one row per attempt). */
export const SUBAGENT_RUNS_METRIC = 'subagent_runs_total'

/**
 * Label contract for the subagent-runs metric. `agent_type`/`status` are the
 * legacy correlation dimensions; the rest are additive child-session
 * dimensions: `agent_profile`, `launch_mode`, `parent_session_id`, `task_id`
 * and `child_session_id` (taskId === childSessionId per the identity rule).
 */
export const SUBAGENT_RUN_METRIC_LABELS = [
  'agent_type',
  'status',
  'agent_profile',
  'launch_mode',
  'parent_session_id',
  'task_id',
  'child_session_id',
] as const

export type SubagentRunMetricLabel = (typeof SUBAGENT_RUN_METRIC_LABELS)[number]

export interface SubagentRunMetricInput {
  agentType: string
  status: string
  agentProfile?: string
  launchMode?: 'foreground' | 'background'
  parentSessionId?: string
  taskId?: string
  childSessionId?: string
}

export function buildSubagentRunMetric(input: SubagentRunMetricInput): MetricRecord {
  const labels: Record<string, string> = {
    agent_type: input.agentType,
    status: input.status,
  }
  if (input.agentProfile) labels.agent_profile = input.agentProfile
  if (input.launchMode) labels.launch_mode = input.launchMode
  if (input.parentSessionId) labels.parent_session_id = input.parentSessionId
  if (input.taskId) labels.task_id = input.taskId
  if (input.childSessionId) labels.child_session_id = input.childSessionId

  return {
    metricId: generateId('metric'),
    module: 'subagent',
    metricType: 'counter',
    name: SUBAGENT_RUNS_METRIC,
    value: 1,
    unit: 'runs',
    timestamp: new Date().toISOString(),
    labels,
  }
}

/** Contract accessor: the metric name + full additive label set. */
export function getSubagentRunMetrics(): { name: string; labelNames: string[] } {
  return { name: SUBAGENT_RUNS_METRIC, labelNames: [...SUBAGENT_RUN_METRIC_LABELS] }
}
