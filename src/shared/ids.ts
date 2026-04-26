export const SESSION_ID_PREFIX = 'sess_';
export const TURN_ID_PREFIX = 'turn_';
export const PLANNER_RUN_ID_PREFIX = 'pl_run_';
export const PLAN_ID_PREFIX = 'plan_';
export const ACTION_ID_PREFIX = 'act_';
export const KERNEL_RUN_ID_PREFIX = 'krun_';
export const BACKGROUND_RUN_ID_PREFIX = 'bg_run_';
export const WORKFLOW_RUN_ID_PREFIX = 'wf_run_';
export const TOOL_CALL_ID_PREFIX = 'tool_call_';
export const APPROVAL_ID_PREFIX = 'appr_';
export const WAIT_CONDITION_ID_PREFIX = 'wait_';
export const ARTIFACT_ID_PREFIX = 'art_';
export const SUMMARY_ID_PREFIX = 'sum_';
export const MEMORY_ID_PREFIX = 'mem_';
export const AUDIT_ID_PREFIX = 'audit_';
export const SPAN_ID_PREFIX = 'span_';

export function isValidSessionId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(SESSION_ID_PREFIX) && id.length > SESSION_ID_PREFIX.length;
}

export function isValidTurnId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(TURN_ID_PREFIX) && id.length > TURN_ID_PREFIX.length;
}

export function isValidPlannerRunId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(PLANNER_RUN_ID_PREFIX) && id.length > PLANNER_RUN_ID_PREFIX.length;
}

export function isValidPlanId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(PLAN_ID_PREFIX) && id.length > PLAN_ID_PREFIX.length;
}

export function isValidActionId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(ACTION_ID_PREFIX) && id.length > ACTION_ID_PREFIX.length;
}

export function isValidKernelRunId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(KERNEL_RUN_ID_PREFIX) && id.length > KERNEL_RUN_ID_PREFIX.length;
}

export function isValidBackgroundRunId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(BACKGROUND_RUN_ID_PREFIX) && id.length > BACKGROUND_RUN_ID_PREFIX.length;
}

export function isValidWorkflowRunId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(WORKFLOW_RUN_ID_PREFIX) && id.length > WORKFLOW_RUN_ID_PREFIX.length;
}

export function isValidToolCallId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(TOOL_CALL_ID_PREFIX) && id.length > TOOL_CALL_ID_PREFIX.length;
}

export function isValidApprovalId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(APPROVAL_ID_PREFIX) && id.length > APPROVAL_ID_PREFIX.length;
}

export function isValidWaitConditionId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(WAIT_CONDITION_ID_PREFIX) && id.length > WAIT_CONDITION_ID_PREFIX.length;
}

export function isValidArtifactId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(ARTIFACT_ID_PREFIX) && id.length > ARTIFACT_ID_PREFIX.length;
}

export function isValidSummaryId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(SUMMARY_ID_PREFIX) && id.length > SUMMARY_ID_PREFIX.length;
}

export function isValidMemoryId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(MEMORY_ID_PREFIX) && id.length > MEMORY_ID_PREFIX.length;
}

export function isValidAuditId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(AUDIT_ID_PREFIX) && id.length > AUDIT_ID_PREFIX.length;
}

export function isValidSpanId(id: string): boolean {
  return typeof id === 'string' && id.startsWith(SPAN_ID_PREFIX) && id.length > SPAN_ID_PREFIX.length;
}
