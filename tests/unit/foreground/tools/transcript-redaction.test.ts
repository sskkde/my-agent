/**
 * @module tests/unit/foreground/tools/transcript-redaction.test
 * Redaction coverage tests for transcript persistence
 */

import { describe, it, expect } from 'vitest'
import {
  mapKernelResultToTranscript,
  mapKernelResultToVisibleMessages,
  buildToolCallSummaries,
  hasHiddenPromptContent,
  buildToolCallEventId,
  buildToolResultEventId,
} from '../../../../src/foreground/tools/transcript-redaction-mapper.js'
import type { KernelRunResult, KernelTranscriptEntry } from '../../../../src/kernel/types.js'

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result).toBeDefined()
      expect(result?.toolCallSummaries).toHaveLength(1)
      expect(result?.toolCallSummaries?.[0].toolCallId).toBe('tc-1')
      expect(result?.toolCallSummaries?.[0].toolName).toBe('authenticate')
      expect(result?.toolCallSummaries?.[0].status).toBe('completed')

      // SAFETY: Verify raw params are NOT included
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>
      expect(summary.params).toBeUndefined()
      expect(summary.password).toBeUndefined()
      expect(summary.apiKey).toBeUndefined()
      expect(summary.token).toBeUndefined()
      expect(summary.secret).toBeUndefined()
    })

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result).toBeDefined()
      expect(result?.toolCallSummaries).toHaveLength(1)

      // SAFETY: Even non-sensitive params should not be persisted
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>
      expect(summary.params).toBeUndefined()
      expect(summary.path).toBeUndefined()
      expect(summary.encoding).toBeUndefined()
    })
  })

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      // SAFETY: Transcript is not persisted in runtimeSummary
      expect(result).toBeDefined()
      expect(result?.toolCallSummaries).toHaveLength(1)
      expect(result?.toolCallSummaries?.[0].toolName).toBe('search')

      // SAFETY: No transcript content leaked
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>
      expect(summary.transcript).toBeUndefined()
      expect(summary.hiddenPrompt).toBeUndefined()
      expect(summary.content).toBeUndefined()

      // SAFETY: hasHiddenPromptContent check returns false (we don't leak by design)
      expect(hasHiddenPromptContent(kernelResult)).toBe(false)
    })
  })

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result).toBeDefined()
      expect(result?.toolCallSummaries).toHaveLength(2)

      // First tool call
      const summary1 = result?.toolCallSummaries?.[0]
      expect(summary1?.toolCallId).toBe('tc-4')
      expect(summary1?.toolName).toBe('read_file')
      expect(summary1?.status).toBe('completed')
      expect(summary1?.summary).toBe('Tool: read_file')
      expect(summary1?.resultRef).toBeUndefined()

      // Second tool call
      const summary2 = result?.toolCallSummaries?.[1]
      expect(summary2?.toolCallId).toBe('tc-5')
      expect(summary2?.toolName).toBe('write_file')
      expect(summary2?.status).toBe('completed')
      expect(summary2?.summary).toBe('Tool: write_file')

      // SAFETY: Verify no raw data
      const rawSummary1 = summary1 as unknown as Record<string, unknown>
      expect(rawSummary1.params).toBeUndefined()
      expect(rawSummary1.result).toBeUndefined()

      const rawSummary2 = summary2 as unknown as Record<string, unknown>
      expect(rawSummary2.params).toBeUndefined()
      expect(rawSummary2.result).toBeUndefined()
    })

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result).toBeDefined()
      expect(result?.toolCallSummaries).toHaveLength(1)
      expect(result?.toolCallSummaries?.[0].status).toBe('failed')

      // SAFETY: Error details not leaked
      const summary = result?.toolCallSummaries?.[0] as unknown as Record<string, unknown>
      expect(summary.error).toBeUndefined()
    })

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result?.toolCallSummaries?.[0].status).toBe('failed')
    })

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      // Tools that executed are still completed
      expect(result?.toolCallSummaries?.[0].status).toBe('completed')
    })
  })

  describe('Empty tool calls returns undefined', () => {
    it('returns undefined when no tool calls', () => {
      const kernelResult: KernelRunResult = {
        finalStatus: 'completed',
        iterationsUsed: 1,
        toolCalls: [],
        transcript: [],
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result).toBeUndefined()
    })

    it('returns undefined when kernelResult is undefined', () => {
      const result = mapKernelResultToTranscript(undefined)

      expect(result).toBeUndefined()
    })

    it('returns undefined when toolCalls is undefined', () => {
      const kernelResult = {
        finalStatus: 'completed' as const,
        iterationsUsed: 1,
        toolCalls: undefined as unknown as never[],
        transcript: [],
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result).toBeUndefined()
    })
  })

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
      }

      const result = mapKernelResultToTranscript(kernelResult)

      expect(result).toBeDefined()
      expect(result?.toolCallSummaries).toHaveLength(3)

      // All summaries have safe structure
      result?.toolCallSummaries?.forEach((summary, index) => {
        expect(summary.toolCallId).toBe(`tc-${['a', 'b', 'c'][index]}`)
        expect(summary.status).toBe('completed')
        expect(summary.summary).toContain('Tool:')

        // SAFETY: No raw params
        const raw = summary as unknown as Record<string, unknown>
        expect(raw.params).toBeUndefined()
      })
    })
  })
})


// ─── Plan C ordered projection ────────────────────────────────────────────────

function entry(
  type: KernelTranscriptEntry['type'],
  content: unknown,
  timestamp = '2026-07-16T00:00:00.000Z',
  iteration = 0,
): KernelTranscriptEntry {
  return { type, content, timestamp, iteration }
}

describe('Plan C ordered projection', () => {
  it('S1: interleaves assistant text with tool results in transcript order', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'Final answer.',
      iterationsUsed: 2,
      toolCalls: [
        { toolCallId: 'tc-1', toolName: 'search', params: { q: 'secret-token-xyz' } },
        { toolCallId: 'tc-2', toolName: 'read', params: { path: '/secret/path' } },
      ],
      transcript: [
        entry('llm_response', { content: 'I will check.', toolCalls: [{ id: 'tc-1' }] }),
        entry('tool_call', { toolCallId: 'tc-1', toolName: 'search', params: { q: 'secret-token-xyz' } }),
        entry('tool_result', { toolCallId: 'tc-1', result: { password: 'hunter2', data: 'hits' } }),
        entry('llm_response', {
          content: 'I found one source; checking another.',
          toolCalls: [{ id: 'tc-2' }],
        }),
        entry('tool_call', { toolCallId: 'tc-2', toolName: 'read', params: { path: '/secret/path' } }),
        entry('tool_result', { toolCallId: 'tc-2', result: { apiKey: 'sk-live-123' } }),
        entry('llm_response', { content: 'Final answer.' }),
      ],
    }

    const messages = mapKernelResultToVisibleMessages(kernelResult, 'turn-s1')
    expect(messages.map((m) => m.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ])
    expect(messages.map((m) => m.content)).toEqual([
      'I will check.',
      'Tool completed: search',
      'I found one source; checking another.',
      'Tool completed: read',
      'Final answer.',
    ])
    expect(messages[1].toolCallId).toBe('tc-1')
    expect(messages[3].toolCallId).toBe('tc-2')
    expect(messages[1].toolStatus).toBe('completed')

    const serialized = JSON.stringify(messages)
    expect(serialized).not.toContain('secret-token-xyz')
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('sk-live-123')
    expect(serialized).not.toContain('/secret/path')
  })

  it('S2: omits blank intermediate text and marks failed tools', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'I could not use that source, but here is what I know.',
      iterationsUsed: 1,
      toolCalls: [{ toolCallId: 'tc-fail', toolName: 'lookup', params: { token: 'bearer-xyz' } }],
      transcript: [
        entry('llm_response', { content: '   ', toolCalls: [{ id: 'tc-fail' }] }),
        entry('tool_call', { toolCallId: 'tc-fail', toolName: 'lookup', params: { token: 'bearer-xyz' } }),
        entry('tool_result', {
          toolCallId: 'tc-fail',
          result: null,
          error: { code: 'TIMEOUT', message: 'lookup timed out with secret', recoverable: true },
        }),
        entry('llm_response', {
          content: 'I could not use that source, but here is what I know.',
        }),
      ],
    }

    const messages = mapKernelResultToVisibleMessages(kernelResult, 'turn-s2')
    expect(messages.map((m) => m.role)).toEqual(['tool', 'assistant'])
    expect(messages[0].content).toBe('Tool failed: lookup')
    expect(messages[0].toolStatus).toBe('failed')
    expect(messages[1].content).toContain('I could not use that source')

    const summaries = buildToolCallSummaries(kernelResult)
    expect(summaries).toHaveLength(1)
    expect(summaries?.[0].status).toBe('failed')
    expect(summaries?.[0].toolName).toBe('lookup')

    const serialized = JSON.stringify({ messages, summaries })
    expect(serialized).not.toContain('bearer-xyz')
    expect(serialized).not.toContain('lookup timed out with secret')
    expect(serialized).not.toContain('TIMEOUT')
  })

  it('S3: direct answer produces one assistant part and no tool summaries', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'Direct answer.',
      iterationsUsed: 1,
      toolCalls: [],
      transcript: [entry('llm_response', { content: 'Direct answer.' })],
    }

    const messages = mapKernelResultToVisibleMessages(kernelResult, 'turn-s3')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'assistant', content: 'Direct answer.' })
    expect(mapKernelResultToTranscript(kernelResult)).toBeUndefined()
  })

  it('keeps first tool completed when later tool fails', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'failed',
      iterationsUsed: 2,
      toolCalls: [
        { toolCallId: 'tc-ok', toolName: 'a', params: {} },
        { toolCallId: 'tc-bad', toolName: 'b', params: {} },
      ],
      transcript: [
        entry('tool_call', { toolCallId: 'tc-ok', toolName: 'a', params: {} }),
        entry('tool_result', { toolCallId: 'tc-ok', result: { ok: true } }),
        entry('tool_call', { toolCallId: 'tc-bad', toolName: 'b', params: {} }),
        entry('tool_result', {
          toolCallId: 'tc-bad',
          result: null,
          error: { code: 'X', message: 'fail', recoverable: false },
        }),
      ],
    }
    const summaries = buildToolCallSummaries(kernelResult)
    expect(summaries?.find((s) => s.toolCallId === 'tc-ok')?.status).toBe('completed')
    expect(summaries?.find((s) => s.toolCallId === 'tc-bad')?.status).toBe('failed')
  })

  it('builds deterministic tool event IDs without CR/LF', () => {
    expect(buildToolCallEventId('turn-1', 'call\r\nA')).toBe('turn-turn-1-tool-callA-call')
    expect(buildToolResultEventId('turn-1', 'tc-1')).toBe('turn-turn-1-tool-tc-1-result')
  })

  it('falls back to finalResponse when transcript has no assistant content', () => {
    const kernelResult: KernelRunResult = {
      finalStatus: 'completed',
      finalResponse: 'Only final.',
      iterationsUsed: 1,
      toolCalls: [{ toolCallId: 'tc-1', toolName: 'search', params: {} }],
      transcript: [
        entry('tool_call', { toolCallId: 'tc-1', toolName: 'search', params: {} }),
        entry('tool_result', { toolCallId: 'tc-1', result: {} }),
      ],
    }
    const messages = mapKernelResultToVisibleMessages(kernelResult, 'turn-fb')
    expect(messages.map((m) => m.role)).toEqual(['tool', 'assistant'])
    expect(messages[1].content).toBe('Only final.')
  })
})
