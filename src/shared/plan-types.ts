/**
 * Shared plan step type unions. These live in `src/shared/` (not `src/planner/`)
 * because `src/storage/` — the bottom of the dependency graph — needs them and
 * must never import from `src/planner/`. `src/planner/plan-schema.ts` re-exports
 * them so planner-domain code keeps a single import surface.
 */

export type PlanStepKind =
  | 'agent_task'
  | 'tool_call'
  | 'subagent_task'
  | 'workflow_step'
  | 'user_approval'
  | 'final_response'

export type PlanExecutor = 'agent_kernel' | 'tool_plane' | 'subagent' | 'workflow_runtime' | 'foreground'
