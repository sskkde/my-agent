import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FOREGROUND_MAX_ITERATIONS,
  DEFAULT_FOREGROUND_TIMEOUT_MS,
  MAX_ITERATION_EXCEEDED_USER_MESSAGE,
  TIMEOUT_USER_MESSAGE,
  mapKernelErrorToForegroundResult,
  createSyntheticKernelErrorResult,
} from '../../../src/foreground/kernel-guard-constants.js';
import type { KernelRunResult } from '../../../src/kernel/types.js';

describe('kernel-guard-constants', () => {
  describe('Constants', () => {
    it('defines DEFAULT_FOREGROUND_MAX_ITERATIONS as 6', () => {
      expect(DEFAULT_FOREGROUND_MAX_ITERATIONS).toBe(6);
    });

    it('defines DEFAULT_FOREGROUND_TIMEOUT_MS as 60000', () => {
      expect(DEFAULT_FOREGROUND_TIMEOUT_MS).toBe(60000);
    });

    it('defines MAX_ITERATION_EXCEEDED_USER_MESSAGE with safe message', () => {
      expect(MAX_ITERATION_EXCEEDED_USER_MESSAGE).toBe(
        'I could not complete this in the allowed number of steps. Please try breaking it into a smaller request.'
      );
    });

    it('defines TIMEOUT_USER_MESSAGE with safe message', () => {
      expect(TIMEOUT_USER_MESSAGE).toBe(
        'The request took too long to process. Please try a simpler request.'
      );
    });
  });

  describe('mapKernelErrorToForegroundResult', () => {
    it('Max iteration safe failure tested', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'max_iterations_reached',
        iterationsUsed: 6,
        toolCalls: [
          { toolCallId: 'tc-1', toolName: 'search', params: {} },
          { toolCallId: 'tc-2', toolName: 'read_file', params: {} },
        ],
        transcript: [],
        error: { code: 'MAX_ITERATIONS', message: 'Max iterations reached' },
      };

      const result = mapKernelErrorToForegroundResult(kernelResult);

      expect(result.status).toBe('failed');
      expect(result.finalResponse).toBe(MAX_ITERATION_EXCEEDED_USER_MESSAGE);
      expect(result.decisionTrace.route).toBe('answer_directly');
      expect(result.decisionTrace.requiresPlanner).toBe(false);
      expect(result.error?.code).toBe('MAX_ITERATIONS_EXCEEDED');
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(2);

      // Verify no sensitive data in finalResponse
      expect(result.finalResponse).not.toContain('6');
      expect(result.finalResponse).not.toContain('iterations');
      expect(result.finalResponse).not.toContain('MAX_ITERATIONS');
    });

    it('Timeout safe failure tested', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'timeout',
        iterationsUsed: 3,
        toolCalls: [{ toolCallId: 'tc-1', toolName: 'long_running_tool', params: {} }],
        transcript: [],
        error: { code: 'TIMEOUT', message: 'Execution timed out after 60000ms' },
      };

      const result = mapKernelErrorToForegroundResult(kernelResult);

      expect(result.status).toBe('failed');
      expect(result.finalResponse).toBe(TIMEOUT_USER_MESSAGE);
      expect(result.decisionTrace.route).toBe('answer_directly');
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.runtimeSummary?.toolCallSummaries).toHaveLength(1);

      // Verify no sensitive timing data in finalResponse
      expect(result.finalResponse).not.toContain('60000');
      expect(result.finalResponse).not.toContain('ms');
      expect(result.finalResponse).not.toContain('timeout');
    });

    it('LLM error safe failure tested', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
        error: { code: 'LLM_RATE_LIMIT', message: 'Rate limit exceeded for provider openai' },
      };

      const result = mapKernelErrorToForegroundResult(kernelResult);

      expect(result.status).toBe('failed');
      expect(result.finalResponse).toBe(
        'The AI service encountered an issue. Please try again.'
      );
      expect(result.error?.code).toBe('LLM_ERROR');
    });

    it('Generic error safe failure tested', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'UNKNOWN', message: 'Something unexpected happened' },
      };

      const result = mapKernelErrorToForegroundResult(kernelResult);

      expect(result.status).toBe('failed');
      expect(result.finalResponse).toBe(
        'Something went wrong while processing your request. Please try again.'
      );
      expect(result.error?.code).toBe('GENERIC_ERROR');
    });

    it('does not expose raw error message in finalResponse', () => {
      const sensitiveMessage = 'Database connection failed: password=secret123';
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 0,
        toolCalls: [],
        transcript: [],
        error: { code: 'DB_ERROR', message: sensitiveMessage },
      };

      const result = mapKernelErrorToForegroundResult(kernelResult);

      // finalResponse must NOT contain the raw error message
      expect(result.finalResponse).not.toContain('secret123');
      expect(result.finalResponse).not.toContain('password');
      expect(result.finalResponse).not.toContain('Database');
    });

    it('does not expose tool params in runtimeSummary', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'max_iterations_reached',
        iterationsUsed: 1,
        toolCalls: [
          {
            toolCallId: 'tc-1',
            toolName: 'web_search',
            params: { query: 'secret api key xyz789' },
          },
        ],
        transcript: [],
        error: { code: 'MAX_ITERATIONS', message: 'Max iterations reached' },
      };

      const result = mapKernelErrorToForegroundResult(kernelResult);

      // runtimeSummary should have tool call summaries but NOT params
      expect(result.runtimeSummary?.toolCallSummaries).toBeDefined();
      expect(result.runtimeSummary?.toolCallSummaries?.[0]?.toolName).toBe('web_search');
      // The summary should be a safe description, not the params
      expect(result.runtimeSummary?.toolCallSummaries?.[0]?.summary).toBe(
        'Tool execution interrupted'
      );
    });
  });

  describe('createSyntheticKernelErrorResult', () => {
    it('creates synthetic result for MAX_ITERATIONS_EXCEEDED', () => {
      const result = createSyntheticKernelErrorResult(
        'MAX_ITERATIONS_EXCEEDED',
        'Test error'
      );

      expect(result.finalStatus).toBe('max_iterations_reached');
      expect(result.iterationsUsed).toBe(0);
      expect(result.toolCalls).toEqual([]);
      expect(result.error?.code).toBe('MAX_ITERATIONS_EXCEEDED');
    });

    it('creates synthetic result for TIMEOUT', () => {
      const result = createSyntheticKernelErrorResult('TIMEOUT', 'Test timeout');

      expect(result.finalStatus).toBe('timeout');
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('creates synthetic result for LLM_ERROR', () => {
      const result = createSyntheticKernelErrorResult('LLM_ERROR', 'Provider down');

      expect(result.finalStatus).toBe('failed');
      expect(result.error?.code).toBe('LLM_ERROR');
    });

    it('creates synthetic result for GENERIC_ERROR', () => {
      const result = createSyntheticKernelErrorResult('GENERIC_ERROR', 'Unknown failure');

      expect(result.finalStatus).toBe('failed');
      expect(result.error?.code).toBe('GENERIC_ERROR');
    });
  });
});
