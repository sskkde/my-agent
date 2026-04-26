import { describe, it, expect } from 'vitest';
import {
  // ForegroundConversationRun states
  FOREGROUND_STATES,
  // PlannerRun states
  PLANNER_STATES,
  // ExecutionPlan states
  EXECUTION_PLAN_STATES,
  // RuntimeAction states
  RUNTIME_ACTION_STATES,
  // KernelRun states
  KERNEL_RUN_STATES,
  // ToolExecution states
  TOOL_EXECUTION_STATES,
  // BackgroundSubagentRun states
  BACKGROUND_SUBAGENT_STATES,
  // WorkflowRun states
  WORKFLOW_RUN_STATES,
  // ApprovalRequest states
  APPROVAL_STATES,
  // WaitCondition states
  WAIT_CONDITION_STATES,
  // RuntimeTriggerEvent states
  TRIGGER_EVENT_STATES,
  // Summary states
  SUMMARY_STATES,
  // Memory states
  MEMORY_STATES,
  // State classifications
  ACTIVE_STATES,
  WAITING_STATES,
  TERMINAL_STATES,
} from '../../src/shared/states';

describe('State Constants', () => {
  describe('ForegroundConversationRun States', () => {
    it('should define all required states', () => {
      expect(FOREGROUND_STATES.RECEIVED).toBe('received');
      expect(FOREGROUND_STATES.HYDRATING).toBe('hydrating');
      expect(FOREGROUND_STATES.CLASSIFYING).toBe('classifying');
      expect(FOREGROUND_STATES.DECIDING).toBe('deciding');
      expect(FOREGROUND_STATES.RESPONDING).toBe('responding');
      expect(FOREGROUND_STATES.DIRECT_DELEGATING).toBe('direct_delegating');
      expect(FOREGROUND_STATES.SPAWNING_PLANNER).toBe('spawning_planner');
      expect(FOREGROUND_STATES.QUERYING_STATUS).toBe('querying_status');
      expect(FOREGROUND_STATES.HANDLING_APPROVAL).toBe('handling_approval');
      expect(FOREGROUND_STATES.HANDLING_INTERRUPT).toBe('handling_interrupt');
      expect(FOREGROUND_STATES.COMPLETED).toBe('completed');
      expect(FOREGROUND_STATES.FAILED).toBe('failed');
    });
  });

  describe('PlannerRun States', () => {
    it('should define all required states', () => {
      expect(PLANNER_STATES.INITIALIZING).toBe('initializing');
      expect(PLANNER_STATES.PLANNING).toBe('planning');
      expect(PLANNER_STATES.WAITING_FOR_USER).toBe('waiting_for_user');
      expect(PLANNER_STATES.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(PLANNER_STATES.WAITING_FOR_EXECUTION_RESULT).toBe('waiting_for_execution_result');
      expect(PLANNER_STATES.WAITING_FOR_EXTERNAL_EVENT).toBe('waiting_for_external_event');
      expect(PLANNER_STATES.REPLANNING).toBe('replanning');
      expect(PLANNER_STATES.PAUSED).toBe('paused');
      expect(PLANNER_STATES.COMPLETED).toBe('completed');
      expect(PLANNER_STATES.FAILED).toBe('failed');
      expect(PLANNER_STATES.CANCELLED).toBe('cancelled');
      expect(PLANNER_STATES.ARCHIVED).toBe('archived');
    });
  });

  describe('ExecutionPlan States', () => {
    it('should define all required states', () => {
      expect(EXECUTION_PLAN_STATES.DRAFT).toBe('draft');
      expect(EXECUTION_PLAN_STATES.APPROVED).toBe('approved');
      expect(EXECUTION_PLAN_STATES.IN_EXECUTION).toBe('in_execution');
      expect(EXECUTION_PLAN_STATES.BLOCKED).toBe('blocked');
      expect(EXECUTION_PLAN_STATES.WAITING_FOR_USER).toBe('waiting_for_user');
      expect(EXECUTION_PLAN_STATES.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(EXECUTION_PLAN_STATES.REPLANNING).toBe('replanning');
      expect(EXECUTION_PLAN_STATES.COMPLETED).toBe('completed');
      expect(EXECUTION_PLAN_STATES.FAILED).toBe('failed');
      expect(EXECUTION_PLAN_STATES.ABANDONED).toBe('abandoned');
    });
  });

  describe('RuntimeAction States', () => {
    it('should define all required states', () => {
      expect(RUNTIME_ACTION_STATES.CREATED).toBe('created');
      expect(RUNTIME_ACTION_STATES.VALIDATED).toBe('validated');
      expect(RUNTIME_ACTION_STATES.DUPLICATE).toBe('duplicate');
      expect(RUNTIME_ACTION_STATES.DENIED).toBe('denied');
      expect(RUNTIME_ACTION_STATES.ACCEPTED).toBe('accepted');
      expect(RUNTIME_ACTION_STATES.QUEUED).toBe('queued');
      expect(RUNTIME_ACTION_STATES.DISPATCHING).toBe('dispatching');
      expect(RUNTIME_ACTION_STATES.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(RUNTIME_ACTION_STATES.WAITING_FOR_TARGET).toBe('waiting_for_target');
      expect(RUNTIME_ACTION_STATES.COMPLETED).toBe('completed');
      expect(RUNTIME_ACTION_STATES.FAILED).toBe('failed');
      expect(RUNTIME_ACTION_STATES.TIMEOUT).toBe('timeout');
      expect(RUNTIME_ACTION_STATES.CANCELLED).toBe('cancelled');
    });
  });

  describe('KernelRun States', () => {
    it('should define all required states', () => {
      expect(KERNEL_RUN_STATES.INITIALIZING).toBe('initializing');
      expect(KERNEL_RUN_STATES.BUILDING_CONTEXT).toBe('building_context');
      expect(KERNEL_RUN_STATES.BUILDING_MODEL_INPUT).toBe('building_model_input');
      expect(KERNEL_RUN_STATES.SAMPLING_MODEL).toBe('sampling_model');
      expect(KERNEL_RUN_STATES.PARSING_MODEL_OUTPUT).toBe('parsing_model_output');
      expect(KERNEL_RUN_STATES.DISPATCHING_TOOLS).toBe('dispatching_tools');
      expect(KERNEL_RUN_STATES.LAUNCHING_SUBAGENT).toBe('launching_subagent');
      expect(KERNEL_RUN_STATES.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(KERNEL_RUN_STATES.WAITING_FOR_USER).toBe('waiting_for_user');
      expect(KERNEL_RUN_STATES.CHECKING_COMPACT).toBe('checking_compact');
      expect(KERNEL_RUN_STATES.COMPACTING).toBe('compacting');
      expect(KERNEL_RUN_STATES.COMPLETED).toBe('completed');
      expect(KERNEL_RUN_STATES.FAILED).toBe('failed');
      expect(KERNEL_RUN_STATES.CANCELLED).toBe('cancelled');
      expect(KERNEL_RUN_STATES.INTERRUPTED).toBe('interrupted');
      expect(KERNEL_RUN_STATES.PARTIAL_SUCCESS).toBe('partial_success');
      expect(KERNEL_RUN_STATES.MAX_ITERATIONS_REACHED).toBe('max_iterations_reached');
    });
  });

  describe('ToolExecution States', () => {
    it('should define all required states', () => {
      expect(TOOL_EXECUTION_STATES.RECEIVED).toBe('received');
      expect(TOOL_EXECUTION_STATES.SCHEMA_VALIDATING).toBe('schema_validating');
      expect(TOOL_EXECUTION_STATES.PERMISSION_CHECKING).toBe('permission_checking');
      expect(TOOL_EXECUTION_STATES.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(TOOL_EXECUTION_STATES.DENIED).toBe('denied');
      expect(TOOL_EXECUTION_STATES.EXECUTING).toBe('executing');
      expect(TOOL_EXECUTION_STATES.MAPPING_RESULT).toBe('mapping_result');
      expect(TOOL_EXECUTION_STATES.COMPLETED).toBe('completed');
      expect(TOOL_EXECUTION_STATES.FAILED).toBe('failed');
      expect(TOOL_EXECUTION_STATES.TIMEOUT).toBe('timeout');
      expect(TOOL_EXECUTION_STATES.CANCELLED).toBe('cancelled');
      expect(TOOL_EXECUTION_STATES.ABORTED).toBe('aborted');
      expect(TOOL_EXECUTION_STATES.DISCARDED).toBe('discarded');
    });
  });

  describe('BackgroundSubagentRun States', () => {
    it('should define all required states', () => {
      expect(BACKGROUND_SUBAGENT_STATES.QUEUED).toBe('queued');
      expect(BACKGROUND_SUBAGENT_STATES.RUNNING).toBe('running');
      expect(BACKGROUND_SUBAGENT_STATES.WAITING_FOR_USER).toBe('waiting_for_user');
      expect(BACKGROUND_SUBAGENT_STATES.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(BACKGROUND_SUBAGENT_STATES.WAITING_FOR_EXTERNAL_EVENT).toBe('waiting_for_external_event');
      expect(BACKGROUND_SUBAGENT_STATES.SLEEPING).toBe('sleeping');
      expect(BACKGROUND_SUBAGENT_STATES.RECOVERING).toBe('recovering');
      expect(BACKGROUND_SUBAGENT_STATES.COMPLETED).toBe('completed');
      expect(BACKGROUND_SUBAGENT_STATES.FAILED).toBe('failed');
      expect(BACKGROUND_SUBAGENT_STATES.CANCELLED).toBe('cancelled');
      expect(BACKGROUND_SUBAGENT_STATES.EXPIRED).toBe('expired');
    });
  });

  describe('WorkflowRun States', () => {
    it('should define all required states', () => {
      expect(WORKFLOW_RUN_STATES.QUEUED).toBe('queued');
      expect(WORKFLOW_RUN_STATES.RUNNING).toBe('running');
      expect(WORKFLOW_RUN_STATES.WAITING_FOR_USER).toBe('waiting_for_user');
      expect(WORKFLOW_RUN_STATES.WAITING_FOR_APPROVAL).toBe('waiting_for_approval');
      expect(WORKFLOW_RUN_STATES.WAITING_FOR_EXTERNAL_EVENT).toBe('waiting_for_external_event');
      expect(WORKFLOW_RUN_STATES.SLEEPING).toBe('sleeping');
      expect(WORKFLOW_RUN_STATES.PAUSED).toBe('paused');
      expect(WORKFLOW_RUN_STATES.COMPLETED).toBe('completed');
      expect(WORKFLOW_RUN_STATES.FAILED).toBe('failed');
      expect(WORKFLOW_RUN_STATES.CANCELLED).toBe('cancelled');
      expect(WORKFLOW_RUN_STATES.TIMEOUT).toBe('timeout');
    });
  });

  describe('ApprovalRequest States', () => {
    it('should define all required states', () => {
      expect(APPROVAL_STATES.PENDING).toBe('pending');
      expect(APPROVAL_STATES.APPROVED).toBe('approved');
      expect(APPROVAL_STATES.REJECTED).toBe('rejected');
      expect(APPROVAL_STATES.EXPIRED).toBe('expired');
      expect(APPROVAL_STATES.CANCELLED).toBe('cancelled');
    });
  });

  describe('WaitCondition States', () => {
    it('should define all required states', () => {
      expect(WAIT_CONDITION_STATES.REGISTERED).toBe('registered');
      expect(WAIT_CONDITION_STATES.ACTIVE).toBe('active');
      expect(WAIT_CONDITION_STATES.SATISFIED).toBe('satisfied');
      expect(WAIT_CONDITION_STATES.FAILED).toBe('failed');
      expect(WAIT_CONDITION_STATES.TIMEOUT).toBe('timeout');
      expect(WAIT_CONDITION_STATES.CANCELLED).toBe('cancelled');
    });
  });

  describe('RuntimeTriggerEvent States', () => {
    it('should define all required states', () => {
      expect(TRIGGER_EVENT_STATES.CREATED).toBe('created');
      expect(TRIGGER_EVENT_STATES.MATCHED).toBe('matched');
      expect(TRIGGER_EVENT_STATES.ACTION_CREATED).toBe('action_created');
      expect(TRIGGER_EVENT_STATES.DISPATCHED).toBe('dispatched');
      expect(TRIGGER_EVENT_STATES.HANDLED).toBe('handled');
      expect(TRIGGER_EVENT_STATES.FAILED).toBe('failed');
      expect(TRIGGER_EVENT_STATES.DUPLICATE).toBe('duplicate');
    });
  });

  describe('Summary States', () => {
    it('should define all required states', () => {
      expect(SUMMARY_STATES.CANDIDATE).toBe('candidate');
      expect(SUMMARY_STATES.VALIDATED).toBe('validated');
      expect(SUMMARY_STATES.ACTIVE).toBe('active');
      expect(SUMMARY_STATES.SUPERSEDED).toBe('superseded');
      expect(SUMMARY_STATES.ARCHIVED).toBe('archived');
      expect(SUMMARY_STATES.EXPIRED).toBe('expired');
    });
  });

  describe('Memory States', () => {
    it('should define all required states', () => {
      expect(MEMORY_STATES.CANDIDATE).toBe('candidate');
      expect(MEMORY_STATES.VALIDATED).toBe('validated');
      expect(MEMORY_STATES.ACTIVE).toBe('active');
      expect(MEMORY_STATES.LOW_PRIORITY).toBe('low_priority');
      expect(MEMORY_STATES.COMPRESSED).toBe('compressed');
      expect(MEMORY_STATES.ARCHIVED).toBe('archived');
      expect(MEMORY_STATES.EXPIRED).toBe('expired');
      expect(MEMORY_STATES.DELETED).toBe('deleted');
    });
  });
});

describe('Global State Classifications', () => {
  describe('Active States', () => {
    it('should include all active states', () => {
      expect(ACTIVE_STATES).toContain('queued');
      expect(ACTIVE_STATES).toContain('initializing');
      expect(ACTIVE_STATES).toContain('planning');
      expect(ACTIVE_STATES).toContain('running');
      expect(ACTIVE_STATES).toContain('executing');
      expect(ACTIVE_STATES).toContain('replanning');
      expect(ACTIVE_STATES).toContain('recovering');
    });

    it('should not include waiting or terminal states', () => {
      expect(ACTIVE_STATES).not.toContain('waiting_for_user');
      expect(ACTIVE_STATES).not.toContain('waiting_for_approval');
      expect(ACTIVE_STATES).not.toContain('completed');
      expect(ACTIVE_STATES).not.toContain('failed');
    });
  });

  describe('Waiting States', () => {
    it('should include all waiting states', () => {
      expect(WAITING_STATES).toContain('waiting_for_user');
      expect(WAITING_STATES).toContain('waiting_for_approval');
      expect(WAITING_STATES).toContain('waiting_for_execution_result');
      expect(WAITING_STATES).toContain('waiting_for_external_event');
      expect(WAITING_STATES).toContain('sleeping');
      expect(WAITING_STATES).toContain('paused');
    });

    it('should not include active or terminal states', () => {
      expect(WAITING_STATES).not.toContain('running');
      expect(WAITING_STATES).not.toContain('completed');
      expect(WAITING_STATES).not.toContain('failed');
    });
  });

  describe('Terminal States', () => {
    it('should include all terminal states', () => {
      expect(TERMINAL_STATES).toContain('completed');
      expect(TERMINAL_STATES).toContain('partial_success');
      expect(TERMINAL_STATES).toContain('failed');
      expect(TERMINAL_STATES).toContain('cancelled');
      expect(TERMINAL_STATES).toContain('timeout');
      expect(TERMINAL_STATES).toContain('expired');
      expect(TERMINAL_STATES).toContain('archived');
    });

    it('should not include active or waiting states', () => {
      expect(TERMINAL_STATES).not.toContain('running');
      expect(TERMINAL_STATES).not.toContain('waiting_for_user');
      expect(TERMINAL_STATES).not.toContain('queued');
    });
  });
});
