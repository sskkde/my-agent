/**
 * Child Task Policy — single source of truth for child task lifecycle rules.
 *
 * Pure, framework-free module (no DB, no HTTP, no side effects). Every rule a
 * child task must obey lives here so the runtime (Todo 7) and tool
 * integration (Todo 10) can share one tested decision point:
 *
 *  - session kind / visibility: parent (depth 0) is `foreground`, every child
 *    (depth >= 1) is `internal` and hidden from the normal session list
 *  - identity: `taskId === childSessionId` (fixed rule)
 *  - launch source: `main_agent_delegation` (audit-only, per taxonomy docs)
 *  - depth: maximum 3 (`SUBAGENT_DEPTH_EXCEEDED` at depth 4)
 *  - launches per parent turn: maximum 8 (`SUBAGENT_LAUNCH_LIMIT_EXCEEDED` on
 *    the 9th)
 *  - profile: only known registered subagent profiles are allowed
 *  - tools: AgentType `subagent` envelope intersection (same pattern as
 *    `buildToolProjection` in `kernel-adapter.ts`); children get NO
 *    orchestration launch tools by default; profile name alone never expands
 *    permissions (project anti-pattern #8)
 *  - search children: `web_search` ONLY
 *
 * Rejection is decision-level: `evaluateChildLaunch` throws BEFORE any
 * session/run row could be created, so a rejected launch has no side effects.
 *
 * @module subagents/child-task-policy
 */

import type { SubagentDefinition, SubagentRegistry } from './registry.js'
import type { SubagentTaskSpec } from './types.js'
import type { ToolPlaneProjection } from '../kernel/model-input/model-input-types.js'
import type { ToolRegistry } from '../tools/types.js'
import { toLLMToolDefinition } from '../tools/tool-plane-prompt-projection.js'
import type { AgentTypeToolEnvelopeRegistry } from '../permissions/agent-type-tool-envelope.js'

// ---------------------------------------------------------------------------
// Limits (plan defaults — Todo 6 of opencode-like-subagent-sessions)
// ---------------------------------------------------------------------------

/** Maximum nesting depth for child tasks. Depth 4 is rejected. */
export const MAX_SUBAGENT_DEPTH = 3

/** Maximum number of child launches in a single parent turn. The 9th is rejected. */
export const MAX_CHILD_LAUNCHES_PER_PARENT_TURN = 8

/** Launch source for every child task (audit-only, does not expand permissions). */
export const CHILD_TASK_LAUNCH_SOURCE = 'main_agent_delegation'

// ---------------------------------------------------------------------------
// Tool policy constants
// ---------------------------------------------------------------------------

/**
 * Orchestration launch tools. Children get NONE of these by default —
 * they are stripped from the projection unless explicitly permitted at a
 * depth strictly below the maximum.
 */
export const ORCHESTRATION_LAUNCH_TOOL_IDS: ReadonlySet<string> = new Set([
  'foreground_launch_subagent',
  'search_subagent',
  'launch_background_subagent',
  'foreground_spawn_planner',
  'foreground_resume_planner',
  'foreground_cancel_or_modify_task',
])

/**
 * Search children may use `web_search` ONLY. The projection for a search
 * child is exactly this list, regardless of what the caller requests.
 */
export const SEARCH_CHILD_TOOL_IDS: readonly string[] = ['web_search']

/**
 * Subagent profile id that routes a child run to the specialized search
 * runner (Todo 16) instead of the generic kernel loop. Matches the built-in
 * `search_processor` agentType in `builtin-definitions.ts`.
 */
export const SEARCH_CHILD_PROFILE_ID = 'search_processor'

// ---------------------------------------------------------------------------
// Error codes (exported as constants for runtime callers)
// ---------------------------------------------------------------------------

export const SUBAGENT_DEPTH_EXCEEDED = 'SUBAGENT_DEPTH_EXCEEDED' as const
export const SUBAGENT_LAUNCH_LIMIT_EXCEEDED = 'SUBAGENT_LAUNCH_LIMIT_EXCEEDED' as const
export const SUBAGENT_PROFILE_UNKNOWN = 'SUBAGENT_PROFILE_UNKNOWN' as const
export const SUBAGENT_TOOL_DENIED = 'SUBAGENT_TOOL_DENIED' as const
export const CHILD_TASK_ID_MISMATCH = 'CHILD_TASK_ID_MISMATCH' as const
export const CHILD_LAUNCH_SOURCE_INVALID = 'CHILD_LAUNCH_SOURCE_INVALID' as const

export type ChildTaskPolicyErrorCode =
  | typeof SUBAGENT_DEPTH_EXCEEDED
  | typeof SUBAGENT_LAUNCH_LIMIT_EXCEEDED
  | typeof SUBAGENT_PROFILE_UNKNOWN
  | typeof SUBAGENT_TOOL_DENIED
  | typeof CHILD_TASK_ID_MISMATCH
  | typeof CHILD_LAUNCH_SOURCE_INVALID

/**
 * Typed error raised by the policy. Callers distinguish rejection causes by
 * `code` instead of parsing messages.
 */
export class ChildTaskPolicyError extends Error {
  readonly code: ChildTaskPolicyErrorCode

  constructor(code: ChildTaskPolicyErrorCode, message: string) {
    super(message)
    this.name = 'ChildTaskPolicyError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Session kind / visibility
// ---------------------------------------------------------------------------

/**
 * Session visibility. `foreground` sessions are user-facing; `internal`
 * child sessions are hidden from the normal session list and only reachable
 * through their parent.
 */
export type SessionVisibility = 'foreground' | 'internal'

/**
 * Resolve the visibility for a session at the given depth. The parent
 * (depth 0) is a foreground session; every child (depth >= 1) is internal.
 */
export function resolveSessionVisibility(depth: number): SessionVisibility {
  return depth >= 1 ? 'internal' : 'foreground'
}

/** Whether a session visibility denotes an internal child session. */
export function isInternalChildSession(visibility: SessionVisibility): boolean {
  return visibility === 'internal'
}

// ---------------------------------------------------------------------------
// Identity: taskId === childSessionId
// ---------------------------------------------------------------------------

/**
 * Derive the task ID for a child task. Fixed rule: the task ID IS the child
 * session ID, so a resume reuses the same conversation shell and creates a
 * new run attempt inside it.
 */
export function resolveChildTaskId(childSessionId: string): string {
  return childSessionId
}

/**
 * Assert that a caller-supplied taskId matches the child session ID.
 * Throws `CHILD_TASK_ID_MISMATCH` when they differ.
 */
export function assertChildTaskIdMatchesSession(taskId: string, childSessionId: string): void {
  if (taskId !== childSessionId) {
    throw new ChildTaskPolicyError(
      CHILD_TASK_ID_MISMATCH,
      `taskId "${taskId}" does not match childSessionId "${childSessionId}"; the fixed identity rule requires taskId === childSessionId`,
    )
  }
}

// ---------------------------------------------------------------------------
// Launch source
// ---------------------------------------------------------------------------

/**
 * Assert that a launch source is the fixed child launch source. Throws
 * `CHILD_LAUNCH_SOURCE_INVALID` otherwise. Audit-only provenance — it never
 * expands permissions.
 */
export function assertChildLaunchSource(launchSource: string): void {
  if (launchSource !== CHILD_TASK_LAUNCH_SOURCE) {
    throw new ChildTaskPolicyError(
      CHILD_LAUNCH_SOURCE_INVALID,
      `Child tasks must be launched with source "${CHILD_TASK_LAUNCH_SOURCE}", got "${launchSource}"`,
    )
  }
}

// ---------------------------------------------------------------------------
// Depth limit
// ---------------------------------------------------------------------------

/** Non-negative integer check shared by the depth and launch-count rules. */
function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

/** Whether the child depth is within the maximum (0..3). */
export function isDepthWithinLimit(depth: number): boolean {
  return isNonNegativeInteger(depth) && depth <= MAX_SUBAGENT_DEPTH
}

/**
 * Assert the child depth is allowed. Throws `SUBAGENT_DEPTH_EXCEEDED` for
 * depths above the maximum or malformed (negative/non-integer) depths.
 */
export function assertDepthAllowed(depth: number): void {
  if (!isDepthWithinLimit(depth)) {
    throw new ChildTaskPolicyError(
      SUBAGENT_DEPTH_EXCEEDED,
      `Subagent depth ${depth} exceeds the maximum of ${MAX_SUBAGENT_DEPTH}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Launch limit per parent turn
// ---------------------------------------------------------------------------

/**
 * Whether the number of child launches already made in the parent turn still
 * allows one more (0..7; 8 launches already made means the next would be the
 * 9th and is rejected).
 */
export function isLaunchCountWithinLimit(launchesInParentTurn: number): boolean {
  return isNonNegativeInteger(launchesInParentTurn) && launchesInParentTurn < MAX_CHILD_LAUNCHES_PER_PARENT_TURN
}

/**
 * Assert the per-parent-turn launch count is allowed. Throws
 * `SUBAGENT_LAUNCH_LIMIT_EXCEEDED` for the 9th launch (count >= 8) or a
 * malformed count.
 */
export function assertLaunchAllowed(launchesInParentTurn: number): void {
  if (!isLaunchCountWithinLimit(launchesInParentTurn)) {
    throw new ChildTaskPolicyError(
      SUBAGENT_LAUNCH_LIMIT_EXCEEDED,
      `Child launch limit of ${MAX_CHILD_LAUNCHES_PER_PARENT_TURN} per parent turn exceeded (${launchesInParentTurn} already launched)`,
    )
  }
}

// ---------------------------------------------------------------------------
// Profile validation
// ---------------------------------------------------------------------------

/**
 * Resolve a profile label/agentType to a registered subagent definition.
 * Throws `SUBAGENT_PROFILE_UNKNOWN` when the profile does not exist. Only
 * the registered definition's allowlists are used — the profile name alone
 * never grants tools (project anti-pattern #8).
 */
export function resolveChildProfile(profileId: string, registry: SubagentRegistry): SubagentDefinition {
  const resolved = registry.resolveByProfileId(profileId)
  if (resolved) return resolved.definition
  const direct = registry.get(profileId)
  if (direct) return direct
  throw new ChildTaskPolicyError(SUBAGENT_PROFILE_UNKNOWN, `Unknown subagent profile: "${profileId}"`)
}

// ---------------------------------------------------------------------------
// Tool projection — AgentType `subagent` envelope intersection
// ---------------------------------------------------------------------------

/**
 * Build the tool projection for a generic child task.
 *
 * Follows the same pattern as `buildToolProjection` in `kernel-adapter.ts`:
 * profile allowlist ∩ requested tools, then the AgentType `subagent`
 * envelope intersection. Children additionally get NO orchestration launch
 * tools by default (`allowNestedLaunch` re-adds them only at a depth strictly
 * below the maximum). Tools that are not in the registry are dropped — a
 * phantom ID is never surfaced to the model.
 */
export function buildChildToolProjection(input: {
  definition: SubagentDefinition
  taskSpec: SubagentTaskSpec
  toolRegistry: ToolRegistry
  envelopeRegistry: AgentTypeToolEnvelopeRegistry
  depth: number
  allowNestedLaunch?: boolean
}): ToolPlaneProjection {
  const { definition, taskSpec, toolRegistry, envelopeRegistry, depth } = input
  const allowNestedLaunch = input.allowNestedLaunch ?? false

  const requestedIds = taskSpec.tools ?? []
  let effectiveIds =
    requestedIds.length > 0
      ? definition.allowedToolIds.filter((id) => requestedIds.includes(id))
      : definition.allowedToolIds

  // Hard intersection with the AgentType `subagent` envelope. The envelope is
  // the outer boundary — no profile, requested tool list or label can expand
  // beyond it.
  const catalog = effectiveIds.map((id) => {
    const tool = toolRegistry.getTool(id)
    return { id, category: tool?.category ?? 'internal' }
  })
  effectiveIds = envelopeRegistry.getAllowedToolIds('subagent', catalog)

  // Children default to NO orchestration launch tools; explicit permission
  // only counts below the maximum depth (a depth-3 child cannot spawn).
  const nestedLaunchAllowed = allowNestedLaunch && depth < MAX_SUBAGENT_DEPTH
  effectiveIds = effectiveIds.filter((id) => nestedLaunchAllowed || !ORCHESTRATION_LAUNCH_TOOL_IDS.has(id))

  // Only real, registered tools are surfaced (executable surface only).
  const toolIds: string[] = []
  const tools: NonNullable<ToolPlaneProjection['tools']> = []
  for (const toolId of effectiveIds) {
    const toolDef = toolRegistry.getTool(toolId)
    if (toolDef) {
      toolIds.push(toolId)
      tools.push(toLLMToolDefinition(toolDef))
    }
  }

  return { toolIds, tools }
}

/**
 * Assert that a requested tool list is fully permitted for a child task.
 * Throws `SUBAGENT_TOOL_DENIED` listing the denied tools. Call this BEFORE
 * creating any session/run row so a denied request has zero side effects.
 */
export function assertToolRequestAllowed(input: {
  definition: SubagentDefinition
  requestedTools: string[]
  toolRegistry: ToolRegistry
  envelopeRegistry: AgentTypeToolEnvelopeRegistry
}): void {
  const projection = buildChildToolProjection({
    definition: input.definition,
    taskSpec: { objective: '', tools: input.requestedTools },
    toolRegistry: input.toolRegistry,
    envelopeRegistry: input.envelopeRegistry,
    depth: 0,
  })
  const allowed = new Set(projection.toolIds)
  const denied = input.requestedTools.filter((id) => !allowed.has(id))
  if (denied.length > 0) {
    throw new ChildTaskPolicyError(
      SUBAGENT_TOOL_DENIED,
      `Tool(s) denied for child task by profile/envelope intersection: ${denied.join(', ')}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Search child — web_search ONLY
// ---------------------------------------------------------------------------

/**
 * Build the tool projection for a search child: exactly `web_search`, never
 * widened by any request. Still verified against the AgentType `subagent`
 * envelope so the fixed list cannot drift outside the security boundary.
 */
export function buildSearchChildProjection(input: {
  toolRegistry: ToolRegistry
  envelopeRegistry: AgentTypeToolEnvelopeRegistry
}): ToolPlaneProjection {
  const { toolRegistry, envelopeRegistry } = input

  const catalog = SEARCH_CHILD_TOOL_IDS.map((id) => {
    const tool = toolRegistry.getTool(id)
    return { id, category: tool?.category ?? 'internal' }
  })
  const toolIds = envelopeRegistry.getAllowedToolIds('subagent', catalog)

  const tools: NonNullable<ToolPlaneProjection['tools']> = []
  for (const toolId of toolIds) {
    const toolDef = toolRegistry.getTool(toolId)
    if (toolDef) tools.push(toLLMToolDefinition(toolDef))
  }

  return { toolIds, tools }
}

// ---------------------------------------------------------------------------
// Single decision point (runtime / tool integration entry)
// ---------------------------------------------------------------------------

export interface ChildLaunchEvaluationInput {
  /** Session ID of the child session being created/resumed. */
  childSessionId: string
  /** Depth of the CHILD being launched (parent depth + 1). */
  depth: number
  /** Number of child launches already made in this parent turn. */
  launchesInParentTurn: number
  /** Profile label or agentType to resolve. */
  profileId: string
  /** Tools requested for the child (may be empty → profile defaults). */
  requestedTools: string[]
  registry: SubagentRegistry
  toolRegistry: ToolRegistry
  envelopeRegistry: AgentTypeToolEnvelopeRegistry
  /** Explicitly permit orchestration launch tools (only below max depth). */
  allowNestedLaunch?: boolean
}

export interface ChildLaunchDecision {
  /** Always `internal` for a child. */
  sessionKind: SessionVisibility
  /** Fixed identity: equals childSessionId. */
  taskId: string
  /** Fixed launch source: `main_agent_delegation`. */
  launchSource: string
  /** Resolved, validated profile definition. */
  profile: SubagentDefinition
  /** Envelope-intersected tool projection for the child kernel. */
  toolProjection: ToolPlaneProjection
}

/**
 * Evaluate a child launch. Throws {@link ChildTaskPolicyError} on ANY policy
 * violation (depth, launch count, profile, tools) BEFORE any session/run row
 * could be created; returns the full decision when approved.
 *
 * This is the single source of truth the runtime and tool integration call.
 */
export function evaluateChildLaunch(input: ChildLaunchEvaluationInput): ChildLaunchDecision {
  assertDepthAllowed(input.depth)
  assertLaunchAllowed(input.launchesInParentTurn)
  const profile = resolveChildProfile(input.profileId, input.registry)
  assertToolRequestAllowed({
    definition: profile,
    requestedTools: input.requestedTools,
    toolRegistry: input.toolRegistry,
    envelopeRegistry: input.envelopeRegistry,
  })
  const toolProjection = buildChildToolProjection({
    definition: profile,
    taskSpec: { objective: '', tools: input.requestedTools },
    toolRegistry: input.toolRegistry,
    envelopeRegistry: input.envelopeRegistry,
    depth: input.depth,
    allowNestedLaunch: input.allowNestedLaunch,
  })
  return {
    sessionKind: resolveSessionVisibility(input.depth),
    taskId: resolveChildTaskId(input.childSessionId),
    launchSource: CHILD_TASK_LAUNCH_SOURCE,
    profile,
    toolProjection,
  }
}
