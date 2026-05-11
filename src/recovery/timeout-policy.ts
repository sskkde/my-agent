/**
 * Unified timeout policy for all run types.
 *
 * Provides typed default timeouts, configurable overrides, max caps,
 * and overdue detection for orphan scanning.
 */

export interface TimeoutPolicy {
  defaultTimeoutMs: number;
  configurable: boolean;
  maxTimeoutMs?: number;
  description: string;
}

export type RunType =
  | 'PlannerRun'
  | 'RuntimeAction'
  | 'KernelRun'
  | 'ToolExecution'
  | 'BackgroundRun'
  | 'WorkflowRun'
  | 'ApprovalRequest';

export const TIMEOUT_POLICIES: Record<RunType, TimeoutPolicy> = {
  PlannerRun: {
    defaultTimeoutMs: 300_000,
    configurable: true,
    maxTimeoutMs: 600_000,
    description: 'Planner run timeout',
  },
  RuntimeAction: {
    defaultTimeoutMs: 120_000,
    configurable: true,
    maxTimeoutMs: 300_000,
    description: 'Runtime action timeout',
  },
  KernelRun: {
    defaultTimeoutMs: 180_000,
    configurable: true,
    maxTimeoutMs: 600_000,
    description: 'Kernel run timeout',
  },
  ToolExecution: {
    defaultTimeoutMs: 60_000,
    configurable: true,
    maxTimeoutMs: 120_000,
    description: 'Tool execution timeout',
  },
  BackgroundRun: {
    defaultTimeoutMs: 600_000,
    configurable: true,
    maxTimeoutMs: 1_800_000,
    description: 'Background run timeout',
  },
  WorkflowRun: {
    defaultTimeoutMs: 600_000,
    configurable: true,
    maxTimeoutMs: 1_800_000,
    description: 'Workflow run timeout',
  },
  ApprovalRequest: {
    defaultTimeoutMs: 300_000,
    configurable: true,
    maxTimeoutMs: 3_600_000,
    description: 'Approval request timeout',
  },
};

export interface TimeoutConfig {
  timeoutMs?: number;
}

/**
 * Resolve the effective timeout for a run type.
 *
 * Honours an optional config override clamped to the policy's
 * `maxTimeoutMs`.  Falls back to the policy default when no override
 * is given or the policy is not configurable.
 */
export function getTimeout(runType: RunType, config?: TimeoutConfig): number {
  const policy = TIMEOUT_POLICIES[runType];
  if (!policy) {
    return 120_000;
  }

  if (config?.timeoutMs !== undefined && policy.configurable) {
    return Math.min(config.timeoutMs, policy.maxTimeoutMs ?? config.timeoutMs);
  }

  return policy.defaultTimeoutMs;
}

/**
 * Check whether a run whose `startTime` is known has exceeded its
 * timeout window.
 */
export function isOverdue(
  runType: RunType,
  startTime: string | Date,
  config?: TimeoutConfig,
): boolean {
  const timeout = getTimeout(runType, config);
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  return Date.now() - start.getTime() > timeout;
}
