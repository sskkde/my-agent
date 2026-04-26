import { describe, it, expect } from 'vitest';
import {
  // Transition validators
  validateForegroundTransition,
  validatePlannerTransition,
  validateExecutionPlanTransition,
  validateRuntimeActionTransition,
  validateKernelRunTransition,
  validateToolExecutionTransition,
  validateBackgroundSubagentTransition,
  validateWorkflowRunTransition,
  validateApprovalTransition,
  validateWaitConditionTransition,
  validateTriggerEventTransition,
  validateSummaryTransition,
  validateMemoryTransition,
  // State classification helpers
  isActiveState,
  isWaitingState,
  isTerminalState,
  // Error types
  TransitionError,
  TransitionResult,
} from '../../src/shared/transitions';
import {
  FOREGROUND_STATES,
  PLANNER_STATES,
  EXECUTION_PLAN_STATES,
  RUNTIME_ACTION_STATES,
  KERNEL_RUN_STATES,
  TOOL_EXECUTION_STATES,
  BACKGROUND_SUBAGENT_STATES,
  WORKFLOW_RUN_STATES,
  APPROVAL_STATES,
  WAIT_CONDITION_STATES,
  TRIGGER_EVENT_STATES,
  SUMMARY_STATES,
  MEMORY_STATES,
} from '../../src/shared/states';

describe('Transition Validation', () => {
  describe('validateForegroundTransition', () => {
    it('should allow valid transitions', () => {
      const result = validateForegroundTransition(
        FOREGROUND_STATES.RECEIVED,
        FOREGROUND_STATES.HYDRATING
      );
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('should reject invalid transitions from terminal states', () => {
      const result = validateForegroundTransition(
        FOREGROUND_STATES.COMPLETED,
        FOREGROUND_STATES.HYDRATING
      );
      expect(result.valid).toBe(false);
      expect(result.error).not.toBeNull();
      expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    });

    it('should reject transitions from non-existent states', () => {
      const result = validateForegroundTransition('invalid_state', FOREGROUND_STATES.RECEIVED);
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_SOURCE_STATE');
    });
  });

  describe('validatePlannerTransition', () => {
    it('should allow transition from initializing to planning', () => {
      const result = validatePlannerTransition(
        PLANNER_STATES.INITIALIZING,
        PLANNER_STATES.PLANNING
      );
      expect(result.valid).toBe(true);
    });

    it('should allow transition from planning to waiting_for_execution_result', () => {
      const result = validatePlannerTransition(
        PLANNER_STATES.PLANNING,
        PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT
      );
      expect(result.valid).toBe(true);
    });

    it('should allow transition from planning to completed', () => {
      const result = validatePlannerTransition(
        PLANNER_STATES.PLANNING,
        PLANNER_STATES.COMPLETED
      );
      expect(result.valid).toBe(true);
    });

    it('should reject transition from completed to running', () => {
      const result = validatePlannerTransition(
        PLANNER_STATES.COMPLETED,
        PLANNER_STATES.PLANNING
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    });

    it('should reject transition from archived to any state', () => {
      const result = validatePlannerTransition(
        PLANNER_STATES.ARCHIVED,
        PLANNER_STATES.INITIALIZING
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('validateExecutionPlanTransition', () => {
    it('should allow draft to approved', () => {
      const result = validateExecutionPlanTransition(
        EXECUTION_PLAN_STATES.DRAFT,
        EXECUTION_PLAN_STATES.APPROVED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow approved to in_execution', () => {
      const result = validateExecutionPlanTransition(
        EXECUTION_PLAN_STATES.APPROVED,
        EXECUTION_PLAN_STATES.IN_EXECUTION
      );
      expect(result.valid).toBe(true);
    });

    it('should reject approved directly to completed', () => {
      const result = validateExecutionPlanTransition(
        EXECUTION_PLAN_STATES.APPROVED,
        EXECUTION_PLAN_STATES.COMPLETED
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('TRANSITION_NOT_ALLOWED');
    });

    it('should allow in_execution to completed', () => {
      const result = validateExecutionPlanTransition(
        EXECUTION_PLAN_STATES.IN_EXECUTION,
        EXECUTION_PLAN_STATES.COMPLETED
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('validateRuntimeActionTransition', () => {
    it('should allow created to validated', () => {
      const result = validateRuntimeActionTransition(
        RUNTIME_ACTION_STATES.CREATED,
        RUNTIME_ACTION_STATES.VALIDATED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow validated to accepted', () => {
      const result = validateRuntimeActionTransition(
        RUNTIME_ACTION_STATES.VALIDATED,
        RUNTIME_ACTION_STATES.ACCEPTED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow validated to duplicate (terminal)', () => {
      const result = validateRuntimeActionTransition(
        RUNTIME_ACTION_STATES.VALIDATED,
        RUNTIME_ACTION_STATES.DUPLICATE
      );
      expect(result.valid).toBe(true);
    });

    it('should reject transition from duplicate to any state', () => {
      const result = validateRuntimeActionTransition(
        RUNTIME_ACTION_STATES.DUPLICATE,
        RUNTIME_ACTION_STATES.CREATED
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    });
  });

  describe('validateKernelRunTransition', () => {
    it('should allow initializing to building_context', () => {
      const result = validateKernelRunTransition(
        KERNEL_RUN_STATES.INITIALIZING,
        KERNEL_RUN_STATES.BUILDING_CONTEXT
      );
      expect(result.valid).toBe(true);
    });

    it('should allow building_context to building_model_input', () => {
      const result = validateKernelRunTransition(
        KERNEL_RUN_STATES.BUILDING_CONTEXT,
        KERNEL_RUN_STATES.BUILDING_MODEL_INPUT
      );
      expect(result.valid).toBe(true);
    });

    it('should allow transition to waiting states', () => {
      const result = validateKernelRunTransition(
        KERNEL_RUN_STATES.PARSING_MODEL_OUTPUT,
        KERNEL_RUN_STATES.WAITING_FOR_APPROVAL
      );
      expect(result.valid).toBe(true);
    });

    it('should allow resuming from waiting_for_user to running', () => {
      const result = validateKernelRunTransition(
        KERNEL_RUN_STATES.WAITING_FOR_USER,
        KERNEL_RUN_STATES.PARSING_MODEL_OUTPUT
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('validateToolExecutionTransition', () => {
    it('should allow received to schema_validating', () => {
      const result = validateToolExecutionTransition(
        TOOL_EXECUTION_STATES.RECEIVED,
        TOOL_EXECUTION_STATES.SCHEMA_VALIDATING
      );
      expect(result.valid).toBe(true);
    });

    it('should allow schema_validating to permission_checking', () => {
      const result = validateToolExecutionTransition(
        TOOL_EXECUTION_STATES.SCHEMA_VALIDATING,
        TOOL_EXECUTION_STATES.PERMISSION_CHECKING
      );
      expect(result.valid).toBe(true);
    });

    it('should allow permission_checking to waiting_for_approval', () => {
      const result = validateToolExecutionTransition(
        TOOL_EXECUTION_STATES.PERMISSION_CHECKING,
        TOOL_EXECUTION_STATES.WAITING_FOR_APPROVAL
      );
      expect(result.valid).toBe(true);
    });

    it('should allow permission_checking to denied (terminal)', () => {
      const result = validateToolExecutionTransition(
        TOOL_EXECUTION_STATES.PERMISSION_CHECKING,
        TOOL_EXECUTION_STATES.DENIED
      );
      expect(result.valid).toBe(true);
    });

    it('should reject transition from denied to executing', () => {
      const result = validateToolExecutionTransition(
        TOOL_EXECUTION_STATES.DENIED,
        TOOL_EXECUTION_STATES.EXECUTING
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('validateBackgroundSubagentTransition', () => {
    it('should allow queued to running', () => {
      const result = validateBackgroundSubagentTransition(
        BACKGROUND_SUBAGENT_STATES.QUEUED,
        BACKGROUND_SUBAGENT_STATES.RUNNING
      );
      expect(result.valid).toBe(true);
    });

    it('should allow running to waiting states', () => {
      const result = validateBackgroundSubagentTransition(
        BACKGROUND_SUBAGENT_STATES.RUNNING,
        BACKGROUND_SUBAGENT_STATES.WAITING_FOR_EXTERNAL_EVENT
      );
      expect(result.valid).toBe(true);
    });

    it('should allow running to terminal states', () => {
      expect(
        validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.RUNNING,
          BACKGROUND_SUBAGENT_STATES.COMPLETED
        ).valid
      ).toBe(true);
      expect(
        validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.RUNNING,
          BACKGROUND_SUBAGENT_STATES.FAILED
        ).valid
      ).toBe(true);
    });

    it('should reject transition from expired to any state', () => {
      const result = validateBackgroundSubagentTransition(
        BACKGROUND_SUBAGENT_STATES.EXPIRED,
        BACKGROUND_SUBAGENT_STATES.RUNNING
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    });
  });

  describe('validateWorkflowRunTransition', () => {
    it('should allow queued to running', () => {
      const result = validateWorkflowRunTransition(
        WORKFLOW_RUN_STATES.QUEUED,
        WORKFLOW_RUN_STATES.RUNNING
      );
      expect(result.valid).toBe(true);
    });

    it('should allow running to paused', () => {
      const result = validateWorkflowRunTransition(
        WORKFLOW_RUN_STATES.RUNNING,
        WORKFLOW_RUN_STATES.PAUSED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow paused to running', () => {
      const result = validateWorkflowRunTransition(
        WORKFLOW_RUN_STATES.PAUSED,
        WORKFLOW_RUN_STATES.RUNNING
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('validateApprovalTransition', () => {
    it('should allow pending to approved', () => {
      const result = validateApprovalTransition(
        APPROVAL_STATES.PENDING,
        APPROVAL_STATES.APPROVED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow pending to rejected', () => {
      const result = validateApprovalTransition(
        APPROVAL_STATES.PENDING,
        APPROVAL_STATES.REJECTED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow pending to expired', () => {
      const result = validateApprovalTransition(
        APPROVAL_STATES.PENDING,
        APPROVAL_STATES.EXPIRED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow pending to cancelled', () => {
      const result = validateApprovalTransition(
        APPROVAL_STATES.PENDING,
        APPROVAL_STATES.CANCELLED
      );
      expect(result.valid).toBe(true);
    });

    it('should reject all transitions from approved', () => {
      const result = validateApprovalTransition(
        APPROVAL_STATES.APPROVED,
        APPROVAL_STATES.REJECTED
      );
      expect(result.valid).toBe(false);
    });

    it('should reject all transitions from rejected', () => {
      const result = validateApprovalTransition(
        APPROVAL_STATES.REJECTED,
        APPROVAL_STATES.APPROVED
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('validateWaitConditionTransition', () => {
    it('should allow registered to active', () => {
      const result = validateWaitConditionTransition(
        WAIT_CONDITION_STATES.REGISTERED,
        WAIT_CONDITION_STATES.ACTIVE
      );
      expect(result.valid).toBe(true);
    });

    it('should allow active to satisfied', () => {
      const result = validateWaitConditionTransition(
        WAIT_CONDITION_STATES.ACTIVE,
        WAIT_CONDITION_STATES.SATISFIED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow active to timeout', () => {
      const result = validateWaitConditionTransition(
        WAIT_CONDITION_STATES.ACTIVE,
        WAIT_CONDITION_STATES.TIMEOUT
      );
      expect(result.valid).toBe(true);
    });

    it('should reject transition from satisfied to active', () => {
      const result = validateWaitConditionTransition(
        WAIT_CONDITION_STATES.SATISFIED,
        WAIT_CONDITION_STATES.ACTIVE
      );
      expect(result.valid).toBe(false);
    });
  });

  describe('validateTriggerEventTransition', () => {
    it('should allow created to matched', () => {
      const result = validateTriggerEventTransition(
        TRIGGER_EVENT_STATES.CREATED,
        TRIGGER_EVENT_STATES.MATCHED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow matched to action_created', () => {
      const result = validateTriggerEventTransition(
        TRIGGER_EVENT_STATES.MATCHED,
        TRIGGER_EVENT_STATES.ACTION_CREATED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow action_created to dispatched', () => {
      const result = validateTriggerEventTransition(
        TRIGGER_EVENT_STATES.ACTION_CREATED,
        TRIGGER_EVENT_STATES.DISPATCHED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow dispatched to handled', () => {
      const result = validateTriggerEventTransition(
        TRIGGER_EVENT_STATES.DISPATCHED,
        TRIGGER_EVENT_STATES.HANDLED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow matched to duplicate (terminal)', () => {
      const result = validateTriggerEventTransition(
        TRIGGER_EVENT_STATES.MATCHED,
        TRIGGER_EVENT_STATES.DUPLICATE
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('validateSummaryTransition', () => {
    it('should allow candidate to validated', () => {
      const result = validateSummaryTransition(
        SUMMARY_STATES.CANDIDATE,
        SUMMARY_STATES.VALIDATED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow validated to active', () => {
      const result = validateSummaryTransition(
        SUMMARY_STATES.VALIDATED,
        SUMMARY_STATES.ACTIVE
      );
      expect(result.valid).toBe(true);
    });

    it('should allow active to superseded', () => {
      const result = validateSummaryTransition(
        SUMMARY_STATES.ACTIVE,
        SUMMARY_STATES.SUPERSEDED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow active to archived', () => {
      const result = validateSummaryTransition(
        SUMMARY_STATES.ACTIVE,
        SUMMARY_STATES.ARCHIVED
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('validateMemoryTransition', () => {
    it('should allow candidate to validated', () => {
      const result = validateMemoryTransition(
        MEMORY_STATES.CANDIDATE,
        MEMORY_STATES.VALIDATED
      );
      expect(result.valid).toBe(true);
    });

    it('should allow validated to active', () => {
      const result = validateMemoryTransition(
        MEMORY_STATES.VALIDATED,
        MEMORY_STATES.ACTIVE
      );
      expect(result.valid).toBe(true);
    });

    it('should allow active to various terminal states', () => {
      expect(
        validateMemoryTransition(MEMORY_STATES.ACTIVE, MEMORY_STATES.ARCHIVED).valid
      ).toBe(true);
      expect(
        validateMemoryTransition(MEMORY_STATES.ACTIVE, MEMORY_STATES.COMPRESSED).valid
      ).toBe(true);
      expect(
        validateMemoryTransition(MEMORY_STATES.ACTIVE, MEMORY_STATES.LOW_PRIORITY).valid
      ).toBe(true);
    });
  });
});

describe('State Classification Helpers', () => {
  describe('isActiveState', () => {
    it('should return true for active states', () => {
      expect(isActiveState('queued')).toBe(true);
      expect(isActiveState('running')).toBe(true);
      expect(isActiveState('executing')).toBe(true);
      expect(isActiveState('planning')).toBe(true);
    });

    it('should return false for waiting states', () => {
      expect(isActiveState('waiting_for_user')).toBe(false);
      expect(isActiveState('waiting_for_approval')).toBe(false);
    });

    it('should return false for terminal states', () => {
      expect(isActiveState('completed')).toBe(false);
      expect(isActiveState('failed')).toBe(false);
    });
  });

  describe('isWaitingState', () => {
    it('should return true for waiting states', () => {
      expect(isWaitingState('waiting_for_user')).toBe(true);
      expect(isWaitingState('waiting_for_approval')).toBe(true);
      expect(isWaitingState('waiting_for_execution_result')).toBe(true);
      expect(isWaitingState('sleeping')).toBe(true);
      expect(isWaitingState('paused')).toBe(true);
    });

    it('should return false for active states', () => {
      expect(isWaitingState('running')).toBe(false);
      expect(isWaitingState('queued')).toBe(false);
    });

    it('should return false for terminal states', () => {
      expect(isWaitingState('completed')).toBe(false);
    });
  });

  describe('isTerminalState', () => {
    it('should return true for terminal states', () => {
      expect(isTerminalState('completed')).toBe(true);
      expect(isTerminalState('failed')).toBe(true);
      expect(isTerminalState('cancelled')).toBe(true);
      expect(isTerminalState('timeout')).toBe(true);
      expect(isTerminalState('expired')).toBe(true);
      expect(isTerminalState('archived')).toBe(true);
    });

    it('should return false for active states', () => {
      expect(isTerminalState('running')).toBe(false);
      expect(isTerminalState('queued')).toBe(false);
    });

    it('should return false for waiting states', () => {
      expect(isTerminalState('waiting_for_user')).toBe(false);
    });
  });
});

describe('TransitionResult structure', () => {
  it('should have correct structure for valid transition', () => {
    const result: TransitionResult = {
      valid: true,
      error: null,
    };
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('should have correct structure for invalid transition', () => {
    const error: TransitionError = {
      code: 'INVALID_FROM_TERMINAL',
      message: 'Cannot transition from terminal state completed',
    };
    const result: TransitionResult = {
      valid: false,
      error,
    };
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    expect(result.error?.message).toBe('Cannot transition from terminal state completed');
  });
});
