/**
 * Unit tests for Plan-to-Workflow Compiler
 *
 * Tests cover:
 * - Happy path: valid linear plan compiles successfully
 * - Approval insertion: requiresApproval=true inserts approval step
 * - Rejection cases: missing name, empty steps, duplicate IDs, unsupported types,
 *   invalid nextStepId, branching, loops, missing required config fields
 */

import { describe, it, expect } from 'vitest';
import {
  compilePlanToWorkflowDraft,
  CompilerErrorCode,
  type PlanToWorkflowInput,
} from '../../../src/workflows/plan-to-workflow-compiler.js';

function createValidPlan(): PlanToWorkflowInput {
  return {
    planId: 'plan_001',
    name: 'Test Workflow',
    description: 'A test workflow',
    ownerUserId: 'user_001',
    steps: [
      {
        stepId: 'step_1',
        title: 'Fetch Data',
        description: 'Fetch data from source',
        stepType: 'tool_call',
        config: { toolName: 'fetch_data' },
        nextStepId: 'step_2',
      },
      {
        stepId: 'step_2',
        title: 'Process Data',
        description: 'Process the data',
        stepType: 'agent_run',
        config: { agentId: 'data_processor' },
      },
    ],
  };
}

describe('compilePlanToWorkflowDraft', () => {
  describe('happy path', () => {
    it('compiles a valid linear plan successfully', () => {
      const plan = createValidPlan();
      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(true);
      expect(result.payload).toBeDefined();
      expect(result.errors).toHaveLength(0);
      expect(result.payload?.name).toBe('Test Workflow');
      expect(result.payload?.description).toBe('A test workflow');
      expect(result.payload?.ownerUserId).toBe('user_001');
      expect(result.payload?.steps).toHaveLength(2);
    });

    it('converts plan steps to workflow steps correctly', () => {
      const plan = createValidPlan();
      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(true);
      expect(result.payload?.steps[0]?.stepId).toBe('step_1');
      expect(result.payload?.steps[0]?.stepType).toBe('tool_call');
      expect(result.payload?.steps[0]?.name).toBe('Fetch Data');
      expect(result.payload?.steps[0]?.config.toolName).toBe('fetch_data');
      expect(result.payload?.steps[0]?.nextStepId).toBe('step_2');

      expect(result.payload?.steps[1]?.stepId).toBe('step_2');
      expect(result.payload?.steps[1]?.stepType).toBe('agent_run');
      expect(result.payload?.steps[1]?.name).toBe('Process Data');
    });

    it('supports all valid step types', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_all_types',
        name: 'All Step Types',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Tool', stepType: 'tool_call', config: { toolName: 't1' }, nextStepId: 's2' },
          { stepId: 's2', title: 'Agent', stepType: 'agent_run', config: { agentId: 'a1' }, nextStepId: 's3' },
          { stepId: 's3', title: 'Subagent', stepType: 'subagent_run', config: { subagentType: 'explore' }, nextStepId: 's4' },
          { stepId: 's4', title: 'Approval', stepType: 'approval', config: { approvalScope: 'scope1' }, nextStepId: 's5' },
          { stepId: 's5', title: 'Wait', stepType: 'wait', config: { waitCondition: { type: 'delay', ms: 1000 } } },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(true);
      expect(result.payload?.steps).toHaveLength(5);
    });
  });

  describe('approval insertion', () => {
    it('inserts approval step before protected step when requiresApproval=true', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_approval',
        name: 'Protected Workflow',
        ownerUserId: 'user_001',
        steps: [
          {
            stepId: 'step_1',
            title: 'Fetch Data',
            stepType: 'tool_call',
            config: { toolName: 'fetch_data' },
            requiresApproval: true,
          },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(true);
      expect(result.payload?.steps).toHaveLength(2);

      const approvalStep = result.payload?.steps[0];
      expect(approvalStep?.stepId).toBe('approval-before-step_1');
      expect(approvalStep?.stepType).toBe('approval');
      expect(approvalStep?.name).toBe('Approval for: Fetch Data');
      expect(approvalStep?.config.approvalScope).toBe('workflow_step:step_1');
      expect(approvalStep?.nextStepId).toBe('step_1');

      const protectedStep = result.payload?.steps[1];
      expect(protectedStep?.stepId).toBe('step_1');
    });

    it('does not insert approval for approval step type', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_already_approval',
        name: 'Already Approval',
        ownerUserId: 'user_001',
        steps: [
          {
            stepId: 'step_1',
            title: 'Approve',
            stepType: 'approval',
            config: { approvalScope: 'scope1' },
            requiresApproval: true,
          },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(true);
      expect(result.payload?.steps).toHaveLength(1);
      expect(result.payload?.steps[0]?.stepId).toBe('step_1');
    });

    it('maintains linear chain when inserting multiple approvals', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_multi_approval',
        name: 'Multiple Approvals',
        ownerUserId: 'user_001',
        steps: [
          {
            stepId: 'step_1',
            title: 'Action 1',
            stepType: 'tool_call',
            config: { toolName: 'tool1' },
            requiresApproval: true,
            nextStepId: 'step_2',
          },
          {
            stepId: 'step_2',
            title: 'Action 2',
            stepType: 'tool_call',
            config: { toolName: 'tool2' },
            requiresApproval: true,
          },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(true);
      expect(result.payload?.steps).toHaveLength(4);

      expect(result.payload?.steps[0]?.stepId).toBe('approval-before-step_1');
      expect(result.payload?.steps[0]?.nextStepId).toBe('step_1');
      expect(result.payload?.steps[1]?.stepId).toBe('step_1');
      expect(result.payload?.steps[2]?.stepId).toBe('approval-before-step_2');
      expect(result.payload?.steps[2]?.nextStepId).toBe('step_2');
      expect(result.payload?.steps[3]?.stepId).toBe('step_2');
    });
  });

  describe('rejection: missing workflow name', () => {
    it('rejects when name is missing', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_no_name',
        name: '',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Step', stepType: 'tool_call', config: { toolName: 't1' } },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe(CompilerErrorCode.MISSING_WORKFLOW_NAME);
    });

    it('rejects when name is whitespace only', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_whitespace_name',
        name: '   ',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Step', stepType: 'tool_call', config: { toolName: 't1' } },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors[0]?.code).toBe(CompilerErrorCode.MISSING_WORKFLOW_NAME);
    });
  });

  describe('rejection: empty steps', () => {
    it('rejects when steps array is empty', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_empty',
        name: 'Empty Workflow',
        ownerUserId: 'user_001',
        steps: [],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe(CompilerErrorCode.EMPTY_STEPS);
    });

    it('rejects when steps is empty in an inferred plan shape', () => {
      const plan = {
        planId: 'plan_undefined',
        name: 'Undefined Steps',
        ownerUserId: 'user_001',
        steps: [],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors[0]?.code).toBe(CompilerErrorCode.EMPTY_STEPS);
    });
  });

  describe('rejection: duplicate step IDs', () => {
    it('rejects when step IDs are duplicated', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_dup',
        name: 'Duplicate IDs',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 'step_1', title: 'First', stepType: 'tool_call', config: { toolName: 't1' } },
          { stepId: 'step_1', title: 'Second', stepType: 'tool_call', config: { toolName: 't2' } },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.DUPLICATE_STEP_ID)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.DUPLICATE_STEP_ID)?.stepId).toBe('step_1');
    });
  });

  describe('rejection: unsupported condition', () => {
    it('rejects condition step type', () => {
      const plan = {
        planId: 'plan_condition',
        name: 'Condition Workflow',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Check', stepType: 'condition', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.UNSUPPORTED_CONDITION)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.UNSUPPORTED_CONDITION)?.stepId).toBe('s1');
    });
  });

  describe('rejection: unsupported step type', () => {
    it('rejects invalid step type', () => {
      const plan = {
        planId: 'plan_invalid_type',
        name: 'Invalid Type',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Invalid', stepType: 'invalid_type', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.UNSUPPORTED_STEP_TYPE)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.UNSUPPORTED_STEP_TYPE)?.stepId).toBe('s1');
    });
  });

  describe('rejection: invalid nextStepId', () => {
    it('rejects when nextStepId references non-existent step', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_invalid_next',
        name: 'Invalid Next',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Step 1', stepType: 'tool_call', config: { toolName: 't1' }, nextStepId: 'nonexistent' },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.INVALID_NEXT_STEP_ID)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.INVALID_NEXT_STEP_ID)?.stepId).toBe('s1');
    });
  });

  describe('rejection: branching (multiple incoming refs)', () => {
    it('rejects when multiple steps point to the same nextStepId', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_branch',
        name: 'Branching Workflow',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Step 1', stepType: 'tool_call', config: { toolName: 't1' }, nextStepId: 's3' },
          { stepId: 's2', title: 'Step 2', stepType: 'tool_call', config: { toolName: 't2' }, nextStepId: 's3' },
          { stepId: 's3', title: 'Step 3', stepType: 'tool_call', config: { toolName: 't3' } },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.BRANCHING_DETECTED)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.BRANCHING_DETECTED)?.stepId).toBe('s3');
    });
  });

  describe('rejection: loop', () => {
    it('rejects when workflow contains a loop', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_loop',
        name: 'Loop Workflow',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Step 1', stepType: 'tool_call', config: { toolName: 't1' }, nextStepId: 's2' },
          { stepId: 's2', title: 'Step 2', stepType: 'tool_call', config: { toolName: 't2' }, nextStepId: 's1' },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.LOOP_DETECTED)).toBe(true);
    });
  });

  describe('rejection: missing toolName', () => {
    it('rejects tool_call step without toolName', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_no_tool',
        name: 'No Tool Name',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Tool Step', stepType: 'tool_call', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.MISSING_TOOL_NAME)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.MISSING_TOOL_NAME)?.stepId).toBe('s1');
    });
  });

  describe('rejection: missing agentId', () => {
    it('rejects agent_run step without agentId', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_no_agent',
        name: 'No Agent ID',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Agent Step', stepType: 'agent_run', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.MISSING_AGENT_ID)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.MISSING_AGENT_ID)?.stepId).toBe('s1');
    });
  });

  describe('rejection: missing subagentType', () => {
    it('rejects subagent_run step without subagentType', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_no_subagent',
        name: 'No Subagent Type',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Subagent Step', stepType: 'subagent_run', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.MISSING_SUBAGENT_TYPE)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.MISSING_SUBAGENT_TYPE)?.stepId).toBe('s1');
    });
  });

  describe('rejection: missing approvalScope', () => {
    it('rejects approval step without approvalScope', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_no_scope',
        name: 'No Approval Scope',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Approval Step', stepType: 'approval', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.MISSING_APPROVAL_SCOPE)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.MISSING_APPROVAL_SCOPE)?.stepId).toBe('s1');
    });
  });

  describe('rejection: missing waitCondition', () => {
    it('rejects wait step without waitCondition', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_no_wait',
        name: 'No Wait Condition',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Wait Step', stepType: 'wait', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.some(e => e.code === CompilerErrorCode.MISSING_WAIT_CONDITION)).toBe(true);
      expect(result.errors.find(e => e.code === CompilerErrorCode.MISSING_WAIT_CONDITION)?.stepId).toBe('s1');
    });
  });

  describe('multiple errors', () => {
    it('collects multiple validation errors', () => {
      const plan: PlanToWorkflowInput = {
        planId: 'plan_multi_errors',
        name: '',
        ownerUserId: 'user_001',
        steps: [
          { stepId: 's1', title: 'Step 1', stepType: 'tool_call', config: {} },
          { stepId: 's1', title: 'Step 2', stepType: 'invalid', config: {} },
        ],
      };

      const result = compilePlanToWorkflowDraft(plan);

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
      expect(result.errors.some(e => e.code === CompilerErrorCode.MISSING_WORKFLOW_NAME)).toBe(true);
      expect(result.errors.some(e => e.code === CompilerErrorCode.DUPLICATE_STEP_ID)).toBe(true);
      expect(result.errors.some(e => e.code === CompilerErrorCode.UNSUPPORTED_STEP_TYPE)).toBe(true);
      expect(result.errors.some(e => e.code === CompilerErrorCode.MISSING_TOOL_NAME)).toBe(true);
    });
  });
});
