import { describe, it, expect } from 'vitest'
import {
  createToolDispatchRequest,
  createToolDispatchResult,
  isTerminalStatus,
  mapToTerminalStatus,
} from '../../../src/tools/runtime/tool-dispatch-contract.js'
import type {
  ToolDispatchRequest,
  ToolDispatchResult,
  ToolExecutionMappedResult,
  ToolDispatchStatus,
  ToolExecutionTerminalStatus,
} from '../../../src/tools/runtime/tool-dispatch-contract.js'

function makeResult(overrides: Partial<ToolExecutionMappedResult> = {}): ToolExecutionMappedResult {
  return {
    toolCallId: 'tc-1',
    toolName: 'file_read',
    status: 'completed',
    resultMessage: {
      toolCallId: 'tc-1',
      toolName: 'file_read',
      isError: false,
      modelFacingContent: '{"ok":true}',
      transcriptSummary: 'Tool completed',
    },
    ...overrides,
  }
}

describe('ToolDispatchContract', () => {
  describe('ToolDispatchRequest', () => {
    it('uses the standard run/user/agent/toolUses shape', () => {
      const req: ToolDispatchRequest = {
        runId: 'run-1',
        userId: 'user-1',
        sessionId: 'sess-1',
        agentId: 'agent-1',
        agentType: 'main',
        assistantMessageId: 'assistant-1',
        toolUses: [{ toolCallId: 'tc-1', toolName: 'file_read', input: { path: '/tmp/test.txt' } }],
        permissionContext: {
          userId: 'user-1',
          sessionId: 'sess-1',
          mode: 'read_only',
          grants: [],
        },
        executionPolicy: {
          maxConcurrency: 1,
          allowParallelReadOnly: true,
          allowWriteConcurrency: false,
        },
      }

      expect(req.runId).toBe('run-1')
      expect(req.agentId).toBe('agent-1')
      expect(req.agentType).toBe('main')
      expect(req.toolUses[0].toolCallId).toBe('tc-1')
      expect(req.toolUses[0].input).toEqual({ path: '/tmp/test.txt' })
    })

    it('supports remote agent type and working context refs', () => {
      const req = createToolDispatchRequest({
        runId: 'run-remote',
        userId: 'user-remote',
        agentId: 'agent-remote',
        agentType: 'remote',
        assistantMessageId: 'assistant-remote',
        workingContextRef: 'ctx-1',
        toolUses: [{ toolCallId: 'tc-remote', toolName: 'status_query', input: {} }],
        permissionContext: {
          userId: 'user-remote',
          sessionId: '',
          mode: 'read_only',
          grants: [],
        },
      })

      expect(req.agentType).toBe('remote')
      expect(req.workingContextRef).toBe('ctx-1')
    })
  })

  describe('createToolDispatchRequest', () => {
    it('fills default executionPolicy when omitted', () => {
      const req = createToolDispatchRequest({
        runId: 'run-3',
        userId: 'user-3',
        agentId: 'agent-3',
        agentType: 'main',
        assistantMessageId: 'assistant-3',
        toolUses: [{ toolCallId: 'tc-3', toolName: 'status_query', input: {} }],
        permissionContext: {
          userId: 'user-3',
          sessionId: 'sess-3',
          mode: 'read_only',
          grants: [],
        },
      })

      expect(req.executionPolicy.maxConcurrency).toBe(1)
      expect(req.executionPolicy.allowParallelReadOnly).toBe(true)
      expect(req.executionPolicy.allowWriteConcurrency).toBe(false)
      expect(req.executionPolicy.timeoutMs).toBeUndefined()
    })

    it('preserves explicit executionPolicy', () => {
      const req = createToolDispatchRequest({
        runId: 'run-4',
        userId: 'user-4',
        sessionId: 'sess-4',
        agentId: 'agent-4',
        agentType: 'subagent',
        assistantMessageId: 'assistant-4',
        toolUses: [{ toolCallId: 'tc-4', toolName: 'file_read', input: { path: '/etc/hosts' } }],
        permissionContext: {
          userId: 'user-4',
          sessionId: 'sess-4',
          mode: 'read_only',
          grants: [],
        },
        executionPolicy: {
          maxConcurrency: 3,
          allowParallelReadOnly: true,
          allowWriteConcurrency: false,
          timeoutMs: 5000,
          abortOnSiblingFailure: true,
        },
      })

      expect(req.executionPolicy.maxConcurrency).toBe(3)
      expect(req.executionPolicy.timeoutMs).toBe(5000)
      expect(req.executionPolicy.abortOnSiblingFailure).toBe(true)
    })

    it('rejects empty toolUses', () => {
      expect(() =>
        createToolDispatchRequest({
          runId: 'run-empty',
          userId: 'user-empty',
          agentId: 'agent-empty',
          agentType: 'main',
          assistantMessageId: 'assistant-empty',
          toolUses: [],
          permissionContext: {
            userId: 'user-empty',
            sessionId: '',
            mode: 'read_only',
            grants: [],
          },
        }),
      ).toThrow('requires at least one tool use')
    })
  })

  describe('ToolDispatchResult', () => {
    it('uses standard run/user/agent/results shape', () => {
      const result: ToolDispatchResult = {
        runId: 'run-5',
        userId: 'user-5',
        sessionId: 'sess-5',
        agentId: 'agent-5',
        status: 'completed',
        results: [makeResult({ toolCallId: 'tc-5' })],
      }

      expect(result.runId).toBe('run-5')
      expect(result.status).toBe('completed')
      expect(result.results[0].toolCallId).toBe('tc-5')
    })

    it('supports context deltas, events, and updated working context refs', () => {
      const result: ToolDispatchResult = {
        runId: 'run-6',
        userId: 'user-6',
        agentId: 'agent-6',
        status: 'completed',
        results: [makeResult()],
        contextDeltas: [{ runId: 'run-6', source: 'tool_result', items: [] }],
        events: [
          { eventType: 'tool_executed', payload: { toolName: 'file_read' }, timestamp: new Date().toISOString() },
        ],
        updatedWorkingContextRef: 'ctx-2',
      }

      expect(result.contextDeltas).toHaveLength(1)
      expect(result.events).toHaveLength(1)
      expect(result.updatedWorkingContextRef).toBe('ctx-2')
    })
  })

  describe('createToolDispatchResult', () => {
    it('infers completed status when all results complete', () => {
      const result = createToolDispatchResult({
        runId: 'run-7',
        userId: 'user-7',
        agentId: 'agent-7',
        results: [makeResult({ status: 'completed' })],
      })

      expect(result.status).toBe('completed')
    })

    it('infers partial status when some results fail', () => {
      const result = createToolDispatchResult({
        runId: 'run-8',
        userId: 'user-8',
        agentId: 'agent-8',
        results: [
          makeResult({ toolCallId: 'tc-ok', status: 'completed' }),
          makeResult({ toolCallId: 'tc-fail', status: 'failed' }),
        ],
      })

      expect(result.status).toBe('partial')
    })

    it('infers failed status when all results fail', () => {
      const result = createToolDispatchResult({
        runId: 'run-9',
        userId: 'user-9',
        agentId: 'agent-9',
        results: [makeResult({ status: 'timeout' })],
      })

      expect(result.status).toBe('failed')
    })

    it('preserves explicit status', () => {
      const result = createToolDispatchResult({
        runId: 'run-10',
        userId: 'user-10',
        agentId: 'agent-10',
        status: 'cancelled',
        results: [makeResult({ status: 'cancelled' })],
      })

      expect(result.status).toBe('cancelled')
    })
  })

  describe('ToolDispatchStatus', () => {
    it('covers document-level dispatch statuses', () => {
      const statuses: ToolDispatchStatus[] = ['completed', 'partial', 'failed', 'cancelled']

      expect(statuses).toHaveLength(4)
    })
  })

  describe('ToolExecutionTerminalStatus', () => {
    it('covers terminal execution statuses', () => {
      const terminal: ToolExecutionTerminalStatus[] = [
        'completed',
        'failed',
        'denied',
        'aborted',
        'cancelled',
        'discarded',
        'timeout',
      ]

      expect(terminal).toHaveLength(7)
    })
  })

  describe('isTerminalStatus', () => {
    it('returns true for terminal dispatch statuses', () => {
      expect(isTerminalStatus('completed')).toBe(true)
      expect(isTerminalStatus('failed')).toBe(true)
      expect(isTerminalStatus('cancelled')).toBe(true)
    })

    it('returns false for partial dispatch status', () => {
      expect(isTerminalStatus('partial')).toBe(false)
    })
  })

  describe('mapToTerminalStatus', () => {
    it('returns same status for terminal dispatch statuses', () => {
      expect(mapToTerminalStatus('completed')).toBe('completed')
      expect(mapToTerminalStatus('failed')).toBe('failed')
      expect(mapToTerminalStatus('cancelled')).toBe('cancelled')
    })

    it('maps partial dispatch status to failed terminal status', () => {
      expect(mapToTerminalStatus('partial')).toBe('failed')
    })
  })

  describe('ToolExecutionMappedResult', () => {
    it('has required document fields', () => {
      const mapped = makeResult({
        toolCallId: 'tc-10',
        toolName: 'status_query',
        status: 'completed',
      })

      expect(mapped.toolCallId).toBe('tc-10')
      expect(mapped.toolName).toBe('status_query')
      expect(mapped.status).toBe('completed')
      expect(mapped.resultMessage.modelFacingContent).toBe('{"ok":true}')
    })

    it('supports output, errors, contextDelta, and metrics', () => {
      const mapped = makeResult({
        status: 'failed',
        output: { partial: true },
        error: { code: 'TIMEOUT', message: 'Timed out', recoverable: true },
        resultMessage: {
          toolCallId: 'tc-11',
          toolName: 'web_search',
          isError: true,
          modelFacingContent: { error: { code: 'TIMEOUT' } },
          transcriptSummary: 'Tool timed out',
          userVisibleSummary: 'Search timed out',
          structuredContent: { error: true },
        },
        contextDelta: { runId: 'run-11', source: 'tool_result', items: [] },
        metrics: {
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:00:01.000Z',
          durationMs: 1000,
        },
      })

      expect(mapped.error?.code).toBe('TIMEOUT')
      expect(mapped.contextDelta?.source).toBe('tool_result')
      expect(mapped.metrics?.durationMs).toBe(1000)
    })
  })
})
