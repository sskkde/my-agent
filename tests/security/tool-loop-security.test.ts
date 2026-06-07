import { describe, it, expect } from 'vitest'
import { ToolResultPairingGuard, validateToolResultPairing } from '../../src/kernel/tool-result-pairing-guard.js'
import type { KernelTranscriptEntry, ToolUseRequest, ToolUseResult } from '../../src/kernel/types.js'
import { mapToolResultToMessage } from '../../src/tools/runtime/tool-result-message-mapper.js'

describe('Tool Loop Security', () => {
  describe('PairingGuard orphan detection', () => {
    it('detects orphan tool results via validateToolResultPairing', () => {
      const transcript: KernelTranscriptEntry[] = [
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_call',
          content: { toolCallId: 'tc-1', toolName: 'file_read', params: {} } as ToolUseRequest,
        },
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_result',
          content: { toolCallId: 'tc-1', result: 'ok' } as ToolUseResult,
        },
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_result',
          content: { toolCallId: 'tc-orphan', result: 'injected data' } as ToolUseResult,
        },
      ]

      const validation = validateToolResultPairing(transcript)
      expect(validation.valid).toBe(false)
      const orphanWarning = validation.warnings.find((w) => w.type === 'orphan_result')
      expect(orphanWarning).toBeDefined()
      expect(orphanWarning?.toolCallId).toBe('tc-orphan')
    })

    it('detects missing tool results for tracked tool calls', () => {
      const guard = new ToolResultPairingGuard()
      guard.trackAssistantToolCalls([
        { toolCallId: 'tc-1', toolName: 'file_read', params: {} },
        { toolCallId: 'tc-2', toolName: 'web_search', params: { query: 'test' } },
      ])
      guard.acceptToolResult({ toolCallId: 'tc-1', result: 'ok' })

      expect(guard.hasPendingCalls()).toBe(true)
      expect(guard.getPendingCallIds()).toContain('tc-2')

      const missing = guard.flushMissingResults('security_check')
      expect(missing).toHaveLength(1)
      expect(missing[0].toolCallId).toBe('tc-2')
      expect(missing[0].error?.code).toBe('MISSING_TOOL_RESULT')
    })

    it('validateToolResultPairing detects orphans in transcript', () => {
      const transcript: KernelTranscriptEntry[] = [
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_call',
          content: { toolCallId: 'tc-1', toolName: 'file_read', params: {} } as ToolUseRequest,
        },
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_result',
          content: { toolCallId: 'tc-1', result: 'ok' } as ToolUseResult,
        },
        {
          iteration: 1,
          timestamp: new Date().toISOString(),
          type: 'tool_result',
          content: { toolCallId: 'tc-rogue', result: 'rogue data' } as ToolUseResult,
        },
      ]

      const result = validateToolResultPairing(transcript)
      expect(result.valid).toBe(false)
      expect(result.warnings.some((w) => w.type === 'orphan_result')).toBe(true)
    })

    it('flushMissingResults produces synthetic results with recoverable=true', () => {
      const guard = new ToolResultPairingGuard()
      guard.trackAssistantToolCalls([{ toolCallId: 'tc-missing', toolName: 'memory_retrieve', params: {} }])

      const missing = guard.flushMissingResults('test')
      expect(missing).toHaveLength(1)
      expect(missing[0].error).toBeDefined()
      expect(missing[0].error?.recoverable).toBe(true)
      expect(missing[0].result).toBeNull()
    })
  })

  describe('ToolResultMessage does not expose large raw result as visible summary', () => {
    it('userVisibleSummary does not contain raw large data', () => {
      const largePayload = 'X'.repeat(50 * 1024)
      const result: ToolUseResult = {
        toolCallId: 'call-large-sec',
        result: { data: largePayload },
      }

      const message = mapToolResultToMessage(result)

      expect(message.userVisibleSummary).toBeDefined()
      expect(message.userVisibleSummary!.length).toBeLessThan(500)
      expect(message.userVisibleSummary).not.toContain(largePayload)
    })

    it('userVisibleSummary for error does not leak internal details', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-err-sec',
        result: null,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database connection string: postgres://admin:password@host:5432/db',
          recoverable: false,
        },
      }

      const message = mapToolResultToMessage(result)

      expect(message.userVisibleSummary).toBe('Tool execution failed')
      expect(message.userVisibleSummary).not.toContain('postgres://')
      expect(message.userVisibleSummary).not.toContain('password')
    })

    it('modelFacingContent for large result is preview only, not full data', () => {
      const largeData = 'Y'.repeat(100 * 1024)
      const result: ToolUseResult = {
        toolCallId: 'call-model-sec',
        result: { content: largeData },
      }

      const message = mapToolResultToMessage(result)

      expect(message.modelFacingContent.length).toBeLessThan(largeData.length)
      expect(message.content).toContain('[Large result:')
    })

    it('structuredContent for large result does not contain raw data', () => {
      const largeData = 'Z'.repeat(20 * 1024)
      const result: ToolUseResult = {
        toolCallId: 'call-struct-sec',
        result: { data: largeData },
      }

      const message = mapToolResultToMessage(result)

      expect(message.structuredContent).toBeDefined()
      expect(message.structuredContent?._type).toBe('blob_ref')
      expect(JSON.stringify(message.structuredContent)).not.toContain(largeData)
    })
  })
})
