import type { AgentType } from '../context/types.js'

/**
 * Launch source records how an agent was launched.
 *
 * Derived from InvocationSource but kept as a separate type so the
 * policy module can evolve independently of the context layer.
 *
 * launchSource is audit-only — it records the entry path but does not
 * expand permissions.  Permission is computed from AgentType, profile,
 * user/workspace policy, and approval grants.
 */
export type LaunchSource =
  | 'gateway_intent'
  | 'planner_execution'
  | 'workflow_step'
  | 'subagent_runtime'
  | 'background_subagent'
  | 'event_trigger_resume'
  | 'system'

// ── Policy mapping ──────────────────────────────────────────────────

const LAUNCH_POLICY: ReadonlyMap<AgentType, readonly LaunchSource[]> = new Map<AgentType, readonly LaunchSource[]>([
  ['main', ['gateway_intent']],
  ['subagent', ['subagent_runtime', 'planner_execution']],
  ['background', ['background_subagent', 'event_trigger_resume', 'system']],
  ['workflow_step', ['workflow_step']],
  ['remote', []],
])

const ALL_LAUNCH_SOURCES: readonly LaunchSource[] = [
  'gateway_intent',
  'planner_execution',
  'workflow_step',
  'subagent_runtime',
  'background_subagent',
  'event_trigger_resume',
  'system',
]

// ── Error codes ─────────────────────────────────────────────────────

export type LaunchPolicyErrorCode =
  | 'LAUNCH_SOURCE_NOT_ALLOWED'
  | 'UNKNOWN_LAUNCH_SOURCE'

export class LaunchPolicyError extends Error {
  readonly code: LaunchPolicyErrorCode
  readonly agentType: AgentType
  readonly launchSource: string

  constructor(code: LaunchPolicyErrorCode, agentType: AgentType, launchSource: string, message: string) {
    super(message)
    this.name = 'LaunchPolicyError'
    this.code = code
    this.agentType = agentType
    this.launchSource = launchSource
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Assert that the given launch source is allowed for the given agent type.
 *
 * @throws {LaunchPolicyError} with code `UNKNOWN_LAUNCH_SOURCE` if the
 *   launch source string is not a recognized LaunchSource value.
 * @throws {LaunchPolicyError} with code `LAUNCH_SOURCE_NOT_ALLOWED` if
 *   the launch source is recognized but not permitted for this agent type.
 */
export function assertLaunchAllowed(agentType: AgentType, launchSource: string): void {
  if (!isLaunchSource(launchSource)) {
    throw new LaunchPolicyError(
      'UNKNOWN_LAUNCH_SOURCE',
      agentType,
      launchSource,
      `Unknown launch source '${launchSource}' for agent type '${agentType}'.`,
    )
  }

  const allowed = LAUNCH_POLICY.get(agentType)
  if (!allowed || allowed.length === 0) {
    throw new LaunchPolicyError(
      'LAUNCH_SOURCE_NOT_ALLOWED',
      agentType,
      launchSource,
      `Agent type '${agentType}' has no allowed launch sources. Got '${launchSource}'.`,
    )
  }

  if (!(allowed as readonly string[]).includes(launchSource)) {
    throw new LaunchPolicyError(
      'LAUNCH_SOURCE_NOT_ALLOWED',
      agentType,
      launchSource,
      `Launch source '${launchSource}' is not allowed for agent type '${agentType}'. Allowed: [${allowed.join(', ')}].`,
    )
  }
}

/**
 * Check whether the given launch source is allowed for the given agent type
 * without throwing.
 */
export function isLaunchAllowed(agentType: AgentType, launchSource: string): boolean {
  if (!isLaunchSource(launchSource)) return false
  const allowed = LAUNCH_POLICY.get(agentType)
  if (!allowed) return false
  return (allowed as readonly string[]).includes(launchSource)
}

/**
 * Get the list of allowed launch sources for an agent type.
 */
export function getAllowedLaunchSources(agentType: AgentType): readonly LaunchSource[] {
  return LAUNCH_POLICY.get(agentType) ?? []
}

/**
 * Runtime check: is the string a recognized LaunchSource value?
 */
export function isLaunchSource(value: string): value is LaunchSource {
  return (ALL_LAUNCH_SOURCES as readonly string[]).includes(value)
}
