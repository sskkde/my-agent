/**
 * @module tests/unit/foreground/tools/transcript-redaction.test
 * Redaction coverage tests for transcript persistence
 */

import { describe, it, expect } from 'vitest';
import { mapKernelResultToTranscript, hasHiddenPromptContent } from '../../../../src/foreground/tools/transcript-redaction-mapper.js';
import type { KernelRunResult } from '../../../../src/kernel/types.js';

describe('Transcript Redaction Mapper', () => {
  describe('Sensitive tool args redacted', () => {
    it('token/password/secret-like fields are NOT persisted', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        iterationsUsed: 1,
        toolCalls: [
          {
            toolCallId: 'tc-1',
            toolName: 'authenticate',
            params: {
              username: 'user123',
              password: 'secret-password-123',
              apiKey: 'sk-api-key-123',
              token: 'bearer-token-xyz',
              secret: 'webhook-secret',
            },
          },
        ],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result).toBeDefined();
      expect(result?.toolCallSummaries).toHaveLength(1);
      expect(result?.toolCallSummaries?.[0].toolCallId).toBe('tc-1');
      expect(result?.toolCallSummaries?.[0].toolName).toBe('authenticate');
      expect(result?.toolCallSummaries?.[0].status).toBe('completed');

      // SAFETY: Verify raw params are NOT included
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>;
      expect(summary.params).toBeUndefined();
      expect(summary.password).toBeUndefined();
      expect(summary.apiKey).toBeUndefined();
      expect(summary.token).toBeUndefined();
      expect(summary.secret).toBeUndefined();
    });

    it('raw tool params are never persisted', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        iterationsUsed: 1,
        toolCalls: [
          {
            toolCallId: 'tc-2',
            toolName: 'read_file',
            params: {
              path: '/some/file.txt',
              encoding: 'utf-8',
            },
          },
        ],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result).toBeDefined();
      expect(result?.toolCallSummaries).toHaveLength(1);

      // SAFETY: Even non-sensitive params should not be persisted
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>;
      expect(summary.params).toBeUndefined();
      expect(summary.path).toBeUndefined();
      expect(summary.encoding).toBeUndefined();
    });
  });

  describe('Hidden prompt not persisted', () => {
    it('kernel result with private reasoning does not leak', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        iterationsUsed: 1,
        toolCalls: [
          {
            toolCallId: 'tc-3',
            toolName: 'search',
            params: { query: 'test query' },
          },
        ],
        transcript: [
          {
            iteration: 1,
            timestamp: '2024-01-01T00:00:00Z',
            type: 'llm_response',
            content: {
              hiddenPrompt: 'This is private chain-of-thought reasoning',
              visibleResponse: 'This is the public response',
            },
          },
        ],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      // SAFETY: Transcript is not persisted in runtimeSummary
      expect(result).toBeDefined();
      expect(result?.toolCallSummaries).toHaveLength(1);
      expect(result?.toolCallSummaries?.[0].toolName).toBe('search');

      // SAFETY: No transcript content leaked
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>;
      expect(summary.transcript).toBeUndefined();
      expect(summary.hiddenPrompt).toBeUndefined();
      expect(summary.content).toBeUndefined();

      // SAFETY: hasHiddenPromptContent check returns false (we don't leak by design)
      expect(hasHiddenPromptContent(kernelResult)).toBe(false);
    });
  });

  describe('Tool call summary includes ID, name, status', () => {
    it('no raw params/results in summary', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        iterationsUsed: 2,
        toolCalls: [
          {
            toolCallId: 'tc-4',
            toolName: 'read_file',
            params: { path: '/sensitive/path' },
          },
          {
            toolCallId: 'tc-5',
            toolName: 'write_file',
            params: { path: '/output.txt', content: 'sensitive data' },
          },
        ],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result).toBeDefined();
      expect(result?.toolCallSummaries).toHaveLength(2);

      // First tool call
      const summary1 = result?.toolCallSummaries?.[0];
      expect(summary1?.toolCallId).toBe('tc-4');
      expect(summary1?.toolName).toBe('read_file');
      expect(summary1?.status).toBe('completed');
      expect(summary1?.summary).toBe('Tool: read_file');
      expect(summary1?.resultRef).toBeUndefined();

      // Second tool call
      const summary2 = result?.toolCallSummaries?.[1];
      expect(summary2?.toolCallId).toBe('tc-5');
      expect(summary2?.toolName).toBe('write_file');
      expect(summary2?.status).toBe('completed');
      expect(summary2?.summary).toBe('Tool: write_file');

      // SAFETY: Verify no raw data
      const rawSummary1 = summary1 as unknown as Record<string, unknown>;
      expect(rawSummary1.params).toBeUndefined();
      expect(rawSummary1.result).toBeUndefined();

      const rawSummary2 = summary2 as unknown as Record<string, unknown>;
      expect(rawSummary2.params).toBeUndefined();
      expect(rawSummary2.result).toBeUndefined();
    });

    it('status is failed when kernel fails', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'failed',
        iterationsUsed: 1,
        toolCalls: [
          {
            toolCallId: 'tc-6',
            toolName: 'dangerous_tool',
            params: { action: 'delete_all' },
          },
        ],
        transcript: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: 'Tool execution failed',
        },
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result).toBeDefined();
      expect(result?.toolCallSummaries).toHaveLength(1);
      expect(result?.toolCallSummaries?.[0].status).toBe('failed');

      // SAFETY: Error details not leaked
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>;
      expect(summary.error).toBeUndefined();
    });

    it('status is failed when kernel times out', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'timeout',
        iterationsUsed: 5,
        toolCalls: [
          {
            toolCallId: 'tc-7',
            toolName: 'slow_tool',
            params: {},
          },
        ],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result?.toolCallSummaries?.[0].status).toBe('failed');
    });

    it('status is completed when max iterations reached', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'max_iterations_reached',
        iterationsUsed: 10,
        toolCalls: [
          {
            toolCallId: 'tc-8',
            toolName: 'iterative_tool',
            params: {},
          },
        ],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      // Tools that executed are still completed
      expect(result?.toolCallSummaries?.[0].status).toBe('completed');
    });
  });

  describe('Empty tool calls returns undefined', () => {
    it('returns undefined when no tool calls', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result).toBeUndefined();
    });

    it('returns undefined when kernelResult is undefined', () => {
      const result = mapKernelResultToTranscript(undefined);

      expect(result).toBeUndefined();
    });

    it('returns undefined when toolCalls is undefined', () => {
      const kernelResult = {
        finalStatus: 'completed' as const,
        iterationsUsed: 1,
        toolCalls: undefined as unknown as never[],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result).toBeUndefined();
    });
  });

  describe('Multiple tool calls', () => {
    it('handles multiple tool calls with mixed parameters', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        iterationsUsed: 3,
        toolCalls: [
          {
            toolCallId: 'tc-a',
            toolName: 'search',
            params: { query: 'test', apiKey: 'secret-key' },
          },
          {
            toolCallId: 'tc-b',
            toolName: 'read',
            params: { path: '/file.txt' },
          },
          {
            toolCallId: 'tc-c',
            toolName: 'write',
            params: { path: '/output.txt', content: 'data', password: 'secret' },
          },
        ],
        transcript: [],
      };

      const result = mapKernelResultToTranscript(kernelResult);

      expect(result).toBeDefined();
      expect(result?.toolCallSummaries).toHaveLength(3);

      // All summaries have safe structure
      result?.toolCallSummaries?.forEach((summary, index) => {
        expect(summary.toolCallId).toBe(`tc-${['a', 'b', 'c'][index]}`);
        expect(summary.status).toBe('completed');
        expect(summary.summary).toContain('Tool:');

        // SAFETY: No raw params
        const raw = summary as unknown as Record<string, unknown>;
        expect(raw.params).toBeUndefined();
      });
    });
  });
});
