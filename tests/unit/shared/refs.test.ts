import { describe, it, expect } from 'vitest';
import type { RelatedRefs } from '../../../src/shared/refs.js';

describe('RelatedRefs Type', () => {
  it('should accept empty object', () => {
    const refs: RelatedRefs = {};
    expect(refs).toBeDefined();
  });

  it('should accept all optional fields', () => {
    const refs: RelatedRefs = {
      sessionId: 'sess_001',
      turnId: 'turn_001',
      foregroundRunId: 'fg_run_001',
      plannerRunId: 'pl_run_001',
      planId: 'plan_001',
      planStepId: 'step_001',
      workflowId: 'wf_001',
      workflowRunId: 'wf_run_001',
      workflowStepId: 'step_001',
      workflowStepRunId: 'step_run_001',
      kernelRunId: 'krun_001',
      backgroundRunId: 'bg_run_001',
      subagentRunId: 'sa_run_001',
      toolCallId: 'tool_call_001',
      approvalId: 'appr_001',
      triggerId: 'rte_001',
      waitConditionId: 'wait_001',
      artifactId: 'art_001',
      memoryId: 'mem_001',
      summaryId: 'sum_001',
      auditId: 'audit_001',
    };
    expect(refs.sessionId).toBe('sess_001');
    expect(refs.turnId).toBe('turn_001');
    expect(refs.plannerRunId).toBe('pl_run_001');
  });

  it('should accept partial fields', () => {
    const refs: RelatedRefs = {
      sessionId: 'sess_001',
      planId: 'plan_001',
    };
    expect(refs.sessionId).toBe('sess_001');
    expect(refs.planId).toBe('plan_001');
    expect(refs.turnId).toBeUndefined();
  });

  it('should accept null for optional fields', () => {
    const refs: RelatedRefs = {
      sessionId: null,
      turnId: undefined,
    };
    expect(refs.sessionId).toBeNull();
    expect(refs.turnId).toBeUndefined();
  });
});
