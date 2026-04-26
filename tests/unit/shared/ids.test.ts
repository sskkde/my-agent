import { describe, it, expect } from 'vitest';
import {
  // ID Prefix Constants
  SESSION_ID_PREFIX,
  TURN_ID_PREFIX,
  PLANNER_RUN_ID_PREFIX,
  PLAN_ID_PREFIX,
  ACTION_ID_PREFIX,
  KERNEL_RUN_ID_PREFIX,
  BACKGROUND_RUN_ID_PREFIX,
  WORKFLOW_RUN_ID_PREFIX,
  TOOL_CALL_ID_PREFIX,
  APPROVAL_ID_PREFIX,
  WAIT_CONDITION_ID_PREFIX,
  ARTIFACT_ID_PREFIX,
  SUMMARY_ID_PREFIX,
  MEMORY_ID_PREFIX,
  AUDIT_ID_PREFIX,
  SPAN_ID_PREFIX,
  // Type Guards
  isValidSessionId,
  isValidTurnId,
  isValidPlannerRunId,
  isValidPlanId,
  isValidActionId,
  isValidKernelRunId,
  isValidBackgroundRunId,
  isValidWorkflowRunId,
  isValidToolCallId,
  isValidApprovalId,
  isValidWaitConditionId,
  isValidArtifactId,
  isValidSummaryId,
  isValidMemoryId,
  isValidAuditId,
  isValidSpanId,
} from '../../../src/shared/ids.js';

describe('ID Prefix Constants', () => {
  it('should have correct prefix for SESSION_ID_PREFIX', () => {
    expect(SESSION_ID_PREFIX).toBe('sess_');
  });

  it('should have correct prefix for TURN_ID_PREFIX', () => {
    expect(TURN_ID_PREFIX).toBe('turn_');
  });

  it('should have correct prefix for PLANNER_RUN_ID_PREFIX', () => {
    expect(PLANNER_RUN_ID_PREFIX).toBe('pl_run_');
  });

  it('should have correct prefix for PLAN_ID_PREFIX', () => {
    expect(PLAN_ID_PREFIX).toBe('plan_');
  });

  it('should have correct prefix for ACTION_ID_PREFIX', () => {
    expect(ACTION_ID_PREFIX).toBe('act_');
  });

  it('should have correct prefix for KERNEL_RUN_ID_PREFIX', () => {
    expect(KERNEL_RUN_ID_PREFIX).toBe('krun_');
  });

  it('should have correct prefix for BACKGROUND_RUN_ID_PREFIX', () => {
    expect(BACKGROUND_RUN_ID_PREFIX).toBe('bg_run_');
  });

  it('should have correct prefix for WORKFLOW_RUN_ID_PREFIX', () => {
    expect(WORKFLOW_RUN_ID_PREFIX).toBe('wf_run_');
  });

  it('should have correct prefix for TOOL_CALL_ID_PREFIX', () => {
    expect(TOOL_CALL_ID_PREFIX).toBe('tool_call_');
  });

  it('should have correct prefix for APPROVAL_ID_PREFIX', () => {
    expect(APPROVAL_ID_PREFIX).toBe('appr_');
  });

  it('should have correct prefix for WAIT_CONDITION_ID_PREFIX', () => {
    expect(WAIT_CONDITION_ID_PREFIX).toBe('wait_');
  });

  it('should have correct prefix for ARTIFACT_ID_PREFIX', () => {
    expect(ARTIFACT_ID_PREFIX).toBe('art_');
  });

  it('should have correct prefix for SUMMARY_ID_PREFIX', () => {
    expect(SUMMARY_ID_PREFIX).toBe('sum_');
  });

  it('should have correct prefix for MEMORY_ID_PREFIX', () => {
    expect(MEMORY_ID_PREFIX).toBe('mem_');
  });

  it('should have correct prefix for AUDIT_ID_PREFIX', () => {
    expect(AUDIT_ID_PREFIX).toBe('audit_');
  });

  it('should have correct prefix for SPAN_ID_PREFIX', () => {
    expect(SPAN_ID_PREFIX).toBe('span_');
  });
});

describe('ID Type Guards - Valid IDs', () => {
  it('isValidSessionId should return true for valid session IDs', () => {
    expect(isValidSessionId('sess_001')).toBe(true);
    expect(isValidSessionId('sess_abc123')).toBe(true);
    expect(isValidSessionId('sess_valid-id')).toBe(true);
  });

  it('isValidTurnId should return true for valid turn IDs', () => {
    expect(isValidTurnId('turn_001')).toBe(true);
    expect(isValidTurnId('turn_abc123')).toBe(true);
  });

  it('isValidPlannerRunId should return true for valid planner run IDs', () => {
    expect(isValidPlannerRunId('pl_run_001')).toBe(true);
    expect(isValidPlannerRunId('pl_run_abc123')).toBe(true);
  });

  it('isValidPlanId should return true for valid plan IDs', () => {
    expect(isValidPlanId('plan_001')).toBe(true);
    expect(isValidPlanId('plan_abc123')).toBe(true);
  });

  it('isValidActionId should return true for valid action IDs', () => {
    expect(isValidActionId('act_001')).toBe(true);
    expect(isValidActionId('act_abc123')).toBe(true);
  });

  it('isValidKernelRunId should return true for valid kernel run IDs', () => {
    expect(isValidKernelRunId('krun_001')).toBe(true);
    expect(isValidKernelRunId('krun_abc123')).toBe(true);
  });

  it('isValidBackgroundRunId should return true for valid background run IDs', () => {
    expect(isValidBackgroundRunId('bg_run_001')).toBe(true);
    expect(isValidBackgroundRunId('bg_run_abc123')).toBe(true);
  });

  it('isValidWorkflowRunId should return true for valid workflow run IDs', () => {
    expect(isValidWorkflowRunId('wf_run_001')).toBe(true);
    expect(isValidWorkflowRunId('wf_run_abc123')).toBe(true);
  });

  it('isValidToolCallId should return true for valid tool call IDs', () => {
    expect(isValidToolCallId('tool_call_001')).toBe(true);
    expect(isValidToolCallId('tool_call_abc123')).toBe(true);
  });

  it('isValidApprovalId should return true for valid approval IDs', () => {
    expect(isValidApprovalId('appr_001')).toBe(true);
    expect(isValidApprovalId('appr_abc123')).toBe(true);
  });

  it('isValidWaitConditionId should return true for valid wait condition IDs', () => {
    expect(isValidWaitConditionId('wait_001')).toBe(true);
    expect(isValidWaitConditionId('wait_abc123')).toBe(true);
  });

  it('isValidArtifactId should return true for valid artifact IDs', () => {
    expect(isValidArtifactId('art_001')).toBe(true);
    expect(isValidArtifactId('art_abc123')).toBe(true);
  });

  it('isValidSummaryId should return true for valid summary IDs', () => {
    expect(isValidSummaryId('sum_001')).toBe(true);
    expect(isValidSummaryId('sum_abc123')).toBe(true);
  });

  it('isValidMemoryId should return true for valid memory IDs', () => {
    expect(isValidMemoryId('mem_001')).toBe(true);
    expect(isValidMemoryId('mem_abc123')).toBe(true);
  });

  it('isValidAuditId should return true for valid audit IDs', () => {
    expect(isValidAuditId('audit_001')).toBe(true);
    expect(isValidAuditId('audit_abc123')).toBe(true);
  });

  it('isValidSpanId should return true for valid span IDs', () => {
    expect(isValidSpanId('span_001')).toBe(true);
    expect(isValidSpanId('span_abc123')).toBe(true);
  });
});

describe('ID Type Guards - Invalid IDs', () => {
  it('isValidSessionId should return false for invalid session IDs', () => {
    expect(isValidSessionId('invalid')).toBe(false);
    expect(isValidSessionId('sess_')).toBe(false);
    expect(isValidSessionId('turn_001')).toBe(false);
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId(null as unknown as string)).toBe(false);
    expect(isValidSessionId(undefined as unknown as string)).toBe(false);
  });

  it('isValidTurnId should return false for invalid turn IDs', () => {
    expect(isValidTurnId('invalid')).toBe(false);
    expect(isValidTurnId('turn_')).toBe(false);
    expect(isValidTurnId('sess_001')).toBe(false);
    expect(isValidTurnId('')).toBe(false);
    expect(isValidTurnId(null as unknown as string)).toBe(false);
    expect(isValidTurnId(undefined as unknown as string)).toBe(false);
  });

  it('isValidPlannerRunId should return false for invalid planner run IDs', () => {
    expect(isValidPlannerRunId('invalid')).toBe(false);
    expect(isValidPlannerRunId('pl_run_')).toBe(false);
    expect(isValidPlannerRunId('plan_001')).toBe(false);
    expect(isValidPlannerRunId('')).toBe(false);
    expect(isValidPlannerRunId(null as unknown as string)).toBe(false);
    expect(isValidPlannerRunId(undefined as unknown as string)).toBe(false);
  });

  it('isValidPlanId should return false for invalid plan IDs', () => {
    expect(isValidPlanId('invalid')).toBe(false);
    expect(isValidPlanId('plan_')).toBe(false);
    expect(isValidPlanId('pl_run_001')).toBe(false);
    expect(isValidPlanId('')).toBe(false);
    expect(isValidPlanId(null as unknown as string)).toBe(false);
    expect(isValidPlanId(undefined as unknown as string)).toBe(false);
  });

  it('isValidActionId should return false for invalid action IDs', () => {
    expect(isValidActionId('invalid')).toBe(false);
    expect(isValidActionId('act_')).toBe(false);
    expect(isValidActionId('sess_001')).toBe(false);
    expect(isValidActionId('')).toBe(false);
    expect(isValidActionId(null as unknown as string)).toBe(false);
    expect(isValidActionId(undefined as unknown as string)).toBe(false);
  });

  it('isValidKernelRunId should return false for invalid kernel run IDs', () => {
    expect(isValidKernelRunId('invalid')).toBe(false);
    expect(isValidKernelRunId('krun_')).toBe(false);
    expect(isValidKernelRunId('sess_001')).toBe(false);
    expect(isValidKernelRunId('')).toBe(false);
    expect(isValidKernelRunId(null as unknown as string)).toBe(false);
    expect(isValidKernelRunId(undefined as unknown as string)).toBe(false);
  });

  it('isValidBackgroundRunId should return false for invalid background run IDs', () => {
    expect(isValidBackgroundRunId('invalid')).toBe(false);
    expect(isValidBackgroundRunId('bg_run_')).toBe(false);
    expect(isValidBackgroundRunId('sess_001')).toBe(false);
    expect(isValidBackgroundRunId('')).toBe(false);
    expect(isValidBackgroundRunId(null as unknown as string)).toBe(false);
    expect(isValidBackgroundRunId(undefined as unknown as string)).toBe(false);
  });

  it('isValidWorkflowRunId should return false for invalid workflow run IDs', () => {
    expect(isValidWorkflowRunId('invalid')).toBe(false);
    expect(isValidWorkflowRunId('wf_run_')).toBe(false);
    expect(isValidWorkflowRunId('sess_001')).toBe(false);
    expect(isValidWorkflowRunId('')).toBe(false);
    expect(isValidWorkflowRunId(null as unknown as string)).toBe(false);
    expect(isValidWorkflowRunId(undefined as unknown as string)).toBe(false);
  });

  it('isValidToolCallId should return false for invalid tool call IDs', () => {
    expect(isValidToolCallId('invalid')).toBe(false);
    expect(isValidToolCallId('tool_call_')).toBe(false);
    expect(isValidToolCallId('sess_001')).toBe(false);
    expect(isValidToolCallId('')).toBe(false);
    expect(isValidToolCallId(null as unknown as string)).toBe(false);
    expect(isValidToolCallId(undefined as unknown as string)).toBe(false);
  });

  it('isValidApprovalId should return false for invalid approval IDs', () => {
    expect(isValidApprovalId('invalid')).toBe(false);
    expect(isValidApprovalId('appr_')).toBe(false);
    expect(isValidApprovalId('sess_001')).toBe(false);
    expect(isValidApprovalId('')).toBe(false);
    expect(isValidApprovalId(null as unknown as string)).toBe(false);
    expect(isValidApprovalId(undefined as unknown as string)).toBe(false);
  });

  it('isValidWaitConditionId should return false for invalid wait condition IDs', () => {
    expect(isValidWaitConditionId('invalid')).toBe(false);
    expect(isValidWaitConditionId('wait_')).toBe(false);
    expect(isValidWaitConditionId('sess_001')).toBe(false);
    expect(isValidWaitConditionId('')).toBe(false);
    expect(isValidWaitConditionId(null as unknown as string)).toBe(false);
    expect(isValidWaitConditionId(undefined as unknown as string)).toBe(false);
  });

  it('isValidArtifactId should return false for invalid artifact IDs', () => {
    expect(isValidArtifactId('invalid')).toBe(false);
    expect(isValidArtifactId('art_')).toBe(false);
    expect(isValidArtifactId('sess_001')).toBe(false);
    expect(isValidArtifactId('')).toBe(false);
    expect(isValidArtifactId(null as unknown as string)).toBe(false);
    expect(isValidArtifactId(undefined as unknown as string)).toBe(false);
  });

  it('isValidSummaryId should return false for invalid summary IDs', () => {
    expect(isValidSummaryId('invalid')).toBe(false);
    expect(isValidSummaryId('sum_')).toBe(false);
    expect(isValidSummaryId('sess_001')).toBe(false);
    expect(isValidSummaryId('')).toBe(false);
    expect(isValidSummaryId(null as unknown as string)).toBe(false);
    expect(isValidSummaryId(undefined as unknown as string)).toBe(false);
  });

  it('isValidMemoryId should return false for invalid memory IDs', () => {
    expect(isValidMemoryId('invalid')).toBe(false);
    expect(isValidMemoryId('mem_')).toBe(false);
    expect(isValidMemoryId('sess_001')).toBe(false);
    expect(isValidMemoryId('')).toBe(false);
    expect(isValidMemoryId(null as unknown as string)).toBe(false);
    expect(isValidMemoryId(undefined as unknown as string)).toBe(false);
  });

  it('isValidAuditId should return false for invalid audit IDs', () => {
    expect(isValidAuditId('invalid')).toBe(false);
    expect(isValidAuditId('audit_')).toBe(false);
    expect(isValidAuditId('sess_001')).toBe(false);
    expect(isValidAuditId('')).toBe(false);
    expect(isValidAuditId(null as unknown as string)).toBe(false);
    expect(isValidAuditId(undefined as unknown as string)).toBe(false);
  });

  it('isValidSpanId should return false for invalid span IDs', () => {
    expect(isValidSpanId('invalid')).toBe(false);
    expect(isValidSpanId('span_')).toBe(false);
    expect(isValidSpanId('sess_001')).toBe(false);
    expect(isValidSpanId('')).toBe(false);
    expect(isValidSpanId(null as unknown as string)).toBe(false);
    expect(isValidSpanId(undefined as unknown as string)).toBe(false);
  });
});
