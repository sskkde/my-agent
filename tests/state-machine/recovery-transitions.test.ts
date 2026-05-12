import { describe, it, expect } from 'vitest';
import {
  validateBackgroundSubagentTransition,
  validatePlannerTransition,
  validateWorkflowRunTransition,
  validateKernelRunTransition,
  validateForegroundTransition,
  validateRuntimeActionTransition,
  validateToolExecutionTransition,
  isTerminalState,
} from '../../src/shared/transitions';
import {
  BACKGROUND_SUBAGENT_STATES,
  PLANNER_STATES,
  WORKFLOW_RUN_STATES,
  KERNEL_RUN_STATES,
  FOREGROUND_STATES,
  RUNTIME_ACTION_STATES,
  TOOL_EXECUTION_STATES,
  TERMINAL_STATES,
} from '../../src/shared/states';

describe('Recovery Transitions', () => {
  describe('Terminal State Recovery Constraints', () => {
    describe('BackgroundSubagentRun', () => {
      it('should reject transition from completed to recovering', () => {
        const result = validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.COMPLETED,
          BACKGROUND_SUBAGENT_STATES.RECOVERING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to recovering', () => {
        const result = validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.FAILED,
          BACKGROUND_SUBAGENT_STATES.RECOVERING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from cancelled to recovering', () => {
        const result = validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.CANCELLED,
          BACKGROUND_SUBAGENT_STATES.RECOVERING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from expired to recovering', () => {
        const result = validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.EXPIRED,
          BACKGROUND_SUBAGENT_STATES.RECOVERING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from completed to running', () => {
        const result = validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.COMPLETED,
          BACKGROUND_SUBAGENT_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to running', () => {
        const result = validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.FAILED,
          BACKGROUND_SUBAGENT_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from cancelled to running', () => {
        const result = validateBackgroundSubagentTransition(
          BACKGROUND_SUBAGENT_STATES.CANCELLED,
          BACKGROUND_SUBAGENT_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });

    describe('PlannerRun', () => {
      it('should reject transition from completed to initializing', () => {
        const result = validatePlannerTransition(
          PLANNER_STATES.COMPLETED,
          PLANNER_STATES.INITIALIZING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to initializing', () => {
        const result = validatePlannerTransition(
          PLANNER_STATES.FAILED,
          PLANNER_STATES.INITIALIZING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from cancelled to initializing', () => {
        const result = validatePlannerTransition(
          PLANNER_STATES.CANCELLED,
          PLANNER_STATES.INITIALIZING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from archived to initializing', () => {
        const result = validatePlannerTransition(
          PLANNER_STATES.ARCHIVED,
          PLANNER_STATES.INITIALIZING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from completed to planning', () => {
        const result = validatePlannerTransition(
          PLANNER_STATES.COMPLETED,
          PLANNER_STATES.PLANNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });

    describe('WorkflowRun', () => {
      it('should reject transition from completed to running', () => {
        const result = validateWorkflowRunTransition(
          WORKFLOW_RUN_STATES.COMPLETED,
          WORKFLOW_RUN_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to running', () => {
        const result = validateWorkflowRunTransition(
          WORKFLOW_RUN_STATES.FAILED,
          WORKFLOW_RUN_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from cancelled to running', () => {
        const result = validateWorkflowRunTransition(
          WORKFLOW_RUN_STATES.CANCELLED,
          WORKFLOW_RUN_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from timeout to running', () => {
        const result = validateWorkflowRunTransition(
          WORKFLOW_RUN_STATES.TIMEOUT,
          WORKFLOW_RUN_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });

    describe('KernelRun', () => {
      it('should reject transition from completed to initializing', () => {
        const result = validateKernelRunTransition(
          KERNEL_RUN_STATES.COMPLETED,
          KERNEL_RUN_STATES.INITIALIZING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to initializing', () => {
        const result = validateKernelRunTransition(
          KERNEL_RUN_STATES.FAILED,
          KERNEL_RUN_STATES.INITIALIZING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from cancelled to initializing', () => {
        const result = validateKernelRunTransition(
          KERNEL_RUN_STATES.CANCELLED,
          KERNEL_RUN_STATES.INITIALIZING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });

    describe('ForegroundConversationRun', () => {
      it('should reject transition from completed to received', () => {
        const result = validateForegroundTransition(
          FOREGROUND_STATES.COMPLETED,
          FOREGROUND_STATES.RECEIVED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to received', () => {
        const result = validateForegroundTransition(
          FOREGROUND_STATES.FAILED,
          FOREGROUND_STATES.RECEIVED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });

    describe('RuntimeAction', () => {
      it('should reject transition from completed to created', () => {
        const result = validateRuntimeActionTransition(
          RUNTIME_ACTION_STATES.COMPLETED,
          RUNTIME_ACTION_STATES.CREATED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to created', () => {
        const result = validateRuntimeActionTransition(
          RUNTIME_ACTION_STATES.FAILED,
          RUNTIME_ACTION_STATES.CREATED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from cancelled to created', () => {
        const result = validateRuntimeActionTransition(
          RUNTIME_ACTION_STATES.CANCELLED,
          RUNTIME_ACTION_STATES.CREATED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });

    describe('ToolExecution', () => {
      it('should reject transition from completed to received', () => {
        const result = validateToolExecutionTransition(
          TOOL_EXECUTION_STATES.COMPLETED,
          TOOL_EXECUTION_STATES.RECEIVED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from failed to received', () => {
        const result = validateToolExecutionTransition(
          TOOL_EXECUTION_STATES.FAILED,
          TOOL_EXECUTION_STATES.RECEIVED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });

      it('should reject transition from cancelled to received', () => {
        const result = validateToolExecutionTransition(
          TOOL_EXECUTION_STATES.CANCELLED,
          TOOL_EXECUTION_STATES.RECEIVED
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });
  });

  describe('Recovery Model Constraints', () => {
    it('should identify completed as a terminal state', () => {
      expect(isTerminalState('completed')).toBe(true);
    });

    it('should identify failed as a terminal state', () => {
      expect(isTerminalState('failed')).toBe(true);
    });

    it('should identify cancelled as a terminal state', () => {
      expect(isTerminalState('cancelled')).toBe(true);
    });

    it('should identify timeout as a terminal state', () => {
      expect(isTerminalState('timeout')).toBe(true);
    });

    it('should identify expired as a terminal state', () => {
      expect(isTerminalState('expired')).toBe(true);
    });

    it('should identify archived as a terminal state', () => {
      expect(isTerminalState('archived')).toBe(true);
    });

    it('should not identify recovering as a terminal state', () => {
      expect(isTerminalState('recovering')).toBe(false);
    });

    it('should not identify running as a terminal state', () => {
      expect(isTerminalState('running')).toBe(false);
    });

    it('should not identify queued as a terminal state', () => {
      expect(isTerminalState('queued')).toBe(false);
    });

    it('TERMINAL_STATES constant should contain all terminal states', () => {
      expect(TERMINAL_STATES).toContain('completed');
      expect(TERMINAL_STATES).toContain('failed');
      expect(TERMINAL_STATES).toContain('cancelled');
      expect(TERMINAL_STATES).toContain('timeout');
      expect(TERMINAL_STATES).toContain('expired');
      expect(TERMINAL_STATES).toContain('archived');
      expect(TERMINAL_STATES).toContain('partial_success');
    });
  });

  describe('Recovery Creates New Run (Not Modifies Terminal)', () => {
    it('should enforce that terminal states are immutable', () => {
      const terminalStates = [
        BACKGROUND_SUBAGENT_STATES.COMPLETED,
        BACKGROUND_SUBAGENT_STATES.FAILED,
        BACKGROUND_SUBAGENT_STATES.CANCELLED,
        BACKGROUND_SUBAGENT_STATES.EXPIRED,
      ];
      
      terminalStates.forEach((state) => {
        const result = validateBackgroundSubagentTransition(
          state,
          BACKGROUND_SUBAGENT_STATES.RUNNING
        );
        expect(result.valid).toBe(false);
        expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
      });
    });

    it('should allow recovery only from non-terminal states', () => {
      const nonTerminalStates = [
        BACKGROUND_SUBAGENT_STATES.QUEUED,
        BACKGROUND_SUBAGENT_STATES.RUNNING,
        BACKGROUND_SUBAGENT_STATES.WAITING_FOR_USER,
        BACKGROUND_SUBAGENT_STATES.WAITING_FOR_APPROVAL,
        BACKGROUND_SUBAGENT_STATES.WAITING_FOR_EXTERNAL_EVENT,
        BACKGROUND_SUBAGENT_STATES.SLEEPING,
      ];

      nonTerminalStates.forEach((state) => {
        const result = validateBackgroundSubagentTransition(
          state,
          BACKGROUND_SUBAGENT_STATES.RECOVERING
        );
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('Idempotent Write Actions on Recovery', () => {
    it('should prevent re-entry to terminal state from itself', () => {
      const result = validateBackgroundSubagentTransition(
        BACKGROUND_SUBAGENT_STATES.COMPLETED,
        BACKGROUND_SUBAGENT_STATES.COMPLETED
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    });

    it('should prevent any transition from terminal state to any state', () => {
      const allStates = Object.values(BACKGROUND_SUBAGENT_STATES);
      const terminalStates = [
        BACKGROUND_SUBAGENT_STATES.COMPLETED,
        BACKGROUND_SUBAGENT_STATES.FAILED,
        BACKGROUND_SUBAGENT_STATES.CANCELLED,
        BACKGROUND_SUBAGENT_STATES.EXPIRED,
      ];

      terminalStates.forEach((terminal) => {
        allStates.forEach((target) => {
          const result = validateBackgroundSubagentTransition(terminal, target);
          expect(result.valid).toBe(false);
          expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
        });
      });
    });

    it('should prevent write action duplication by blocking terminal-to-active transitions', () => {
      const result = validateRuntimeActionTransition(
        RUNTIME_ACTION_STATES.COMPLETED,
        RUNTIME_ACTION_STATES.DISPATCHING
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    });

    it('should prevent duplicate execution by blocking completed-to-executing transition', () => {
      const result = validateToolExecutionTransition(
        TOOL_EXECUTION_STATES.COMPLETED,
        TOOL_EXECUTION_STATES.EXECUTING
      );
      expect(result.valid).toBe(false);
      expect(result.error?.code).toBe('INVALID_FROM_TERMINAL');
    });
  });
});
