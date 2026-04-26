import { describe, it, expect } from 'vitest';
import type {
  RuntimeError,
  RuntimeErrorCategory,
  Recoverability,
  ErrorSource,
  UserVisibleError,
  TechnicalErrorDetails,
} from '../../../src/shared/errors';

describe('RuntimeError Contracts', () => {
  describe('RuntimeErrorCategory', () => {
    it('should accept all documented error categories', () => {
      const categories: RuntimeErrorCategory[] = [
        'user_input_error',
        'permission_error',
        'approval_rejected',
        'connector_auth_error',
        'connector_rate_limited',
        'tool_validation_error',
        'tool_execution_error',
        'model_error',
        'context_overflow',
        'timeout',
        'external_event_timeout',
        'workflow_step_error',
        'subagent_error',
        'planner_error',
        'dispatcher_error',
        'duplicate_event',
        'state_conflict',
        'system_internal_error',
      ];

      expect(categories).toHaveLength(18);

      categories.forEach((category) => {
        expect(typeof category).toBe('string');
      });
    });
  });

  describe('Recoverability', () => {
    it('should accept all documented recoverability values', () => {
      const recoverabilityValues: Recoverability[] = [
        'recoverable_auto',
        'recoverable_with_user',
        'recoverable_with_approval',
        'retryable_later',
        'non_recoverable',
      ];

      expect(recoverabilityValues).toHaveLength(5);

      recoverabilityValues.forEach((value) => {
        expect(typeof value).toBe('string');
      });
    });
  });

  describe('RuntimeError', () => {
    it('should create a complete RuntimeError object', () => {
      const source: ErrorSource = {
        module: 'test-module',
        runId: 'krun_test123',
        plannerRunId: 'pl_run_test456',
        workflowRunId: 'wf_run_test789',
        workflowStepRunId: 'step_001',
        backgroundRunId: 'bg_run_001',
        toolCallId: 'tool_call_001',
        actionId: 'act_001',
        connectorId: 'conn_001',
      };

      const userVisible: UserVisibleError = {
        title: 'Test Error',
        summary: 'A test error occurred',
        suggestedActions: ['Retry', 'Contact support'],
      };

      const technical: TechnicalErrorDetails = {
        stackRef: 'stack-ref-123',
        rawErrorRef: 'raw-error-456',
        retryAfterMs: 5000,
      };

      const error: RuntimeError = {
        errorId: 'err_test_001',
        category: 'model_error',
        code: 'MODEL_TIMEOUT',
        message: 'Model request timed out',
        recoverability: 'retryable_later',
        source,
        userVisible,
        technical,
        createdAt: new Date().toISOString(),
      };

      expect(error.errorId).toBe('err_test_001');
      expect(error.category).toBe('model_error');
      expect(error.code).toBe('MODEL_TIMEOUT');
      expect(error.message).toBe('Model request timed out');
      expect(error.recoverability).toBe('retryable_later');
      expect(error.createdAt).toBeDefined();
      expect(error.source).toEqual(source);
      expect(error.userVisible).toEqual(userVisible);
      expect(error.technical).toEqual(technical);
    });

    it('should create a RuntimeError with minimal required fields', () => {
      const error: RuntimeError = {
        errorId: 'err_test_002',
        category: 'system_internal_error',
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred',
        recoverability: 'non_recoverable',
        source: {
          module: 'kernel',
        },
        createdAt: new Date().toISOString(),
      };

      expect(error.errorId).toBe('err_test_002');
      expect(error.category).toBe('system_internal_error');
      expect(error.recoverability).toBe('non_recoverable');
      expect(error.userVisible).toBeUndefined();
      expect(error.technical).toBeUndefined();
    });

    it('should accept connector_rate_limited as retryable_later', () => {
      const error: RuntimeError = {
        errorId: 'err_rate_limit_001',
        category: 'connector_rate_limited',
        code: 'RATE_LIMITED',
        message: 'API rate limit exceeded',
        recoverability: 'retryable_later',
        source: { module: 'connector' },
        technical: { retryAfterMs: 60000 },
        createdAt: new Date().toISOString(),
      };

      expect(error.category).toBe('connector_rate_limited');
      expect(error.recoverability).toBe('retryable_later');
      expect(error.technical?.retryAfterMs).toBe(60000);
    });

    it('should accept approval_rejected as recoverable_with_user', () => {
      const error: RuntimeError = {
        errorId: 'err_approval_001',
        category: 'approval_rejected',
        code: 'APPROVAL_DENIED',
        message: 'User rejected the approval request',
        recoverability: 'recoverable_with_user',
        source: { module: 'approval' },
        userVisible: {
          title: 'Action Not Approved',
          summary: 'The requested action was not approved by the user',
        },
        createdAt: new Date().toISOString(),
      };

      expect(error.category).toBe('approval_rejected');
      expect(error.recoverability).toBe('recoverable_with_user');
    });

    it('should accept tool_execution_error as non_recoverable for destructive actions', () => {
      const error: RuntimeError = {
        errorId: 'err_tool_001',
        category: 'tool_execution_error',
        code: 'DESTRUCTIVE_DENIED',
        message: 'Destructive action was denied',
        recoverability: 'non_recoverable',
        source: { module: 'tools' },
        userVisible: {
          title: 'Action Denied',
          summary: 'The destructive action cannot be completed',
        },
        createdAt: new Date().toISOString(),
      };

      expect(error.category).toBe('tool_execution_error');
      expect(error.recoverability).toBe('non_recoverable');
    });
  });

  describe('ErrorSource', () => {
    it('should support all documented source fields', () => {
      const source: ErrorSource = {
        module: 'planner',
        runId: 'krun_001',
        plannerRunId: 'pl_run_001',
        workflowRunId: 'wf_run_001',
        workflowStepRunId: 'step_001',
        backgroundRunId: 'bg_run_001',
        toolCallId: 'tool_call_001',
        actionId: 'act_001',
        connectorId: 'conn_001',
      };

      expect(source.module).toBe('planner');
      expect(source.runId).toBe('krun_001');
      expect(source.plannerRunId).toBe('pl_run_001');
      expect(source.workflowRunId).toBe('wf_run_001');
      expect(source.workflowStepRunId).toBe('step_001');
      expect(source.backgroundRunId).toBe('bg_run_001');
      expect(source.toolCallId).toBe('tool_call_001');
      expect(source.actionId).toBe('act_001');
      expect(source.connectorId).toBe('conn_001');
    });

    it('should only require module field', () => {
      const source: ErrorSource = {
        module: 'kernel',
      };

      expect(source.module).toBe('kernel');
    });
  });
});
