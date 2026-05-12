import { describe, it, expect } from 'vitest';
import { ReplanPolicy, ReplanOptions } from '../../../src/planner/replan-policy.js';

function makeOptions(overrides?: Partial<ReplanOptions>): ReplanOptions {
  return {
    hasAlternativePaths: false,
    isRetryable: false,
    completedStepIds: [],
    ...overrides,
  };
}

const policy = new ReplanPolicy();

describe('ReplanPolicy', () => {
  describe('approval_rejected', () => {
    it('returns replan with preserveCompletedSteps when alternatives exist', () => {
      const result = policy.decide('approval_rejected', makeOptions({ hasAlternativePaths: true }));

      expect(result.action).toBe('replan');
      expect(result.reason).toBe('approval_rejected');
      expect(result.preserveCompletedSteps).toBe(true);
      expect(result.userVisibleMessage).toContain('alternative');
    });

    it('returns terminate when no alternatives exist', () => {
      const result = policy.decide('approval_rejected', makeOptions({ hasAlternativePaths: false }));

      expect(result.action).toBe('terminate');
      expect(result.reason).toBe('approval_rejected');
      expect(result.preserveCompletedSteps).toBe(false);
      expect(result.userVisibleMessage).toContain('no alternative');
    });
  });

  describe('user_modified_goal', () => {
    it('returns replan with preserveCompletedSteps', () => {
      const result = policy.decide('user_modified_goal', makeOptions());

      expect(result.action).toBe('replan');
      expect(result.reason).toBe('user_modified_goal');
      expect(result.preserveCompletedSteps).toBe(true);
      expect(result.userVisibleMessage).toContain('modified');
    });
  });

  describe('tool_failed', () => {
    it('returns replan when retryable', () => {
      const result = policy.decide('tool_failed', makeOptions({ isRetryable: true }));

      expect(result.action).toBe('replan');
      expect(result.reason).toBe('tool_failed');
      expect(result.preserveCompletedSteps).toBe(true);
    });

    it('returns terminate when not retryable', () => {
      const result = policy.decide('tool_failed', makeOptions({ isRetryable: false }));

      expect(result.action).toBe('terminate');
      expect(result.reason).toBe('tool_failed');
      expect(result.preserveCompletedSteps).toBe(false);
    });
  });

  describe('dependency_missing', () => {
    it('returns replan with excludedStepIds and preserveCompletedSteps', () => {
      const completedSteps = ['step-1', 'step-2'];
      const result = policy.decide('dependency_missing', makeOptions({ completedStepIds: completedSteps }));

      expect(result.action).toBe('replan');
      expect(result.reason).toBe('dependency_missing');
      expect(result.preserveCompletedSteps).toBe(true);
      expect(result.excludedStepIds).toEqual(completedSteps);
      expect(result.userVisibleMessage).toContain('dependency');
    });
  });

  describe('timeout', () => {
    it('returns wait_for_user', () => {
      const result = policy.decide('timeout', makeOptions());

      expect(result.action).toBe('wait_for_user');
      expect(result.reason).toBe('timeout');
      expect(result.preserveCompletedSteps).toBe(false);
      expect(result.userVisibleMessage).toContain('timed out');
    });
  });

  describe('context_changed', () => {
    it('returns replan with preserveCompletedSteps', () => {
      const result = policy.decide('context_changed', makeOptions());

      expect(result.action).toBe('replan');
      expect(result.reason).toBe('context_changed');
      expect(result.preserveCompletedSteps).toBe(true);
      expect(result.userVisibleMessage).toContain('context');
    });
  });
});
