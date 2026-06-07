import { describe, it, expect } from 'vitest'
import { mapToolResultToMessage } from '../../../src/tools/runtime/tool-result-message-mapper.js'
import type { ToolUseResult } from '../../../src/kernel/types.js'

describe('mapToolResultToMessage', () => {
  describe('normal result', () => {
    it('should map normal result to correct format', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-123',
        result: { status: 'success', data: [1, 2, 3] },
      }

      const message = mapToolResultToMessage(result)

      expect(message.role).toBe('tool')
      expect(message.toolCallId).toBe('call-123')
      expect(message.content).toBe('{"status":"success","data":[1,2,3]}')
      expect(message.isError).toBe(false)
      expect(message.modelFacingContent).toBe('{"status":"success","data":[1,2,3]}')
    })

    it('should handle null result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-456',
        result: null,
      }

      const message = mapToolResultToMessage(result)

      expect(message.role).toBe('tool')
      expect(message.toolCallId).toBe('call-456')
      expect(message.content).toBe('null')
      expect(message.isError).toBe(false)
      expect(message.modelFacingContent).toBe('null')
    })

    it('should handle undefined result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-789',
        result: undefined,
      }

      const message = mapToolResultToMessage(result)

      expect(message.role).toBe('tool')
      expect(message.toolCallId).toBe('call-789')
      expect(message.content).toBe('undefined')
      expect(message.isError).toBe(false)
    })

    it('should handle string result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-str',
        result: 'Hello, world!',
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toBe('"Hello, world!"')
      expect(message.modelFacingContent).toBe('"Hello, world!"')
    })

    it('should handle array result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-arr',
        result: ['a', 'b', 'c'],
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toBe('["a","b","c"]')
    })

    it('should set userVisibleSummary for normal result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-vis',
        result: 'short string',
      }

      const message = mapToolResultToMessage(result)
      expect(message.userVisibleSummary).toBe('short string')
    })

    it('should truncate long string in userVisibleSummary', () => {
      const longString = 'x'.repeat(300)
      const result: ToolUseResult = {
        toolCallId: 'call-vis-long',
        result: longString,
      }

      const message = mapToolResultToMessage(result)
      expect(message.userVisibleSummary).toContain('300 chars')
    })

    it('should set userVisibleSummary for array result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-vis-arr',
        result: [1, 2, 3, 4, 5],
      }

      const message = mapToolResultToMessage(result)
      expect(message.userVisibleSummary).toContain('5 items')
    })
  })

  describe('error result', () => {
    it('should map error result to error message format', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-err',
        result: null,
        error: {
          code: 'TIMEOUT',
          message: 'Tool execution timed out after 30s',
          recoverable: true,
        },
      }

      const message = mapToolResultToMessage(result)

      expect(message.role).toBe('tool')
      expect(message.toolCallId).toBe('call-err')
      expect(message.content).toBe('Error: Tool execution timed out after 30s')
      expect(message.isError).toBe(true)
      expect(message.modelFacingContent).toBe('Error: Tool execution timed out after 30s')
      expect(message.transcriptSummary).toBe('Error: TIMEOUT')
      expect(message.structuredContent).toEqual({
        error: true,
        code: 'TIMEOUT',
        recoverable: true,
      })
      expect(message.meta?.errorCode).toBe('TIMEOUT')
    })

    it('should handle non-recoverable error', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-fatal',
        result: undefined,
        error: {
          code: 'INVALID_PARAMS',
          message: 'Missing required parameter: query',
          recoverable: false,
        },
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toBe('Error: Missing required parameter: query')
      expect(message.isError).toBe(true)
      expect(message.structuredContent?.recoverable).toBe(false)
    })

    it('should set userVisibleSummary for error result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-err-vis',
        result: null,
        error: {
          code: 'TIMEOUT',
          message: 'Timeout',
          recoverable: true,
        },
      }

      const message = mapToolResultToMessage(result)
      expect(message.userVisibleSummary).toBe('Tool execution failed')
    })
  })

  describe('large result', () => {
    it('should truncate large result and include blob reference', () => {
      const largeData = 'x'.repeat(10 * 1024)
      const result: ToolUseResult = {
        toolCallId: 'call-large',
        result: { data: largeData },
      }

      const message = mapToolResultToMessage(result)

      expect(message.role).toBe('tool')
      expect(message.toolCallId).toBe('call-large')
      expect(message.content).toContain('[Large result:')
      expect(message.content).toContain('Preview:')
      expect(message.content).toContain('[Full result stored,')
      expect(message.content).toContain('blob:call-large')
      expect(message.isError).toBe(false)
      expect(message.modelFacingContent).toBeDefined()
      expect(message.transcriptSummary).toContain('Large result:')
      expect(message.structuredContent?.isLargeResult).toBeUndefined()
      expect(message.structuredContent?._type).toBe('blob_ref')
    })

    it('should use custom threshold when provided', () => {
      const data = 'y'.repeat(2 * 1024)
      const result: ToolUseResult = {
        toolCallId: 'call-custom',
        result: { data },
      }

      const message = mapToolResultToMessage(result, { thresholdBytes: 1024 })

      expect(message.content).toContain('[Large result:')
      expect(message.content).toContain('blob:call-custom')
      expect(message.isError).toBe(false)
    })

    it('should not truncate if result is exactly at threshold', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-exact',
        result: { value: 'test' },
      }

      const message = mapToolResultToMessage(result, { thresholdBytes: 100000 })

      expect(message.content).not.toContain('[Large result:')
      expect(message.content).toBe('{"value":"test"}')
    })

    it('should include size information in large result', () => {
      const largeArray = Array(1000).fill({ key: 'value', num: 123 })
      const result: ToolUseResult = {
        toolCallId: 'call-size',
        result: largeArray,
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toMatch(/\d+KB/)
      expect(message.structuredContent?.sizeKB).toBeGreaterThan(0)
    })

    it('should use custom preview length when provided', () => {
      const largeData = 'z'.repeat(10 * 1024)
      const result: ToolUseResult = {
        toolCallId: 'call-preview',
        result: { data: largeData },
      }

      const message = mapToolResultToMessage(result, { maxPreviewLength: 100 })

      expect(message.content).toContain('[Large result:')
    })

    it('should not expose full raw JSON in userVisibleSummary for large result', () => {
      const largeData = 's'.repeat(20 * 1024)
      const result: ToolUseResult = {
        toolCallId: 'call-safe-vis',
        result: { data: largeData },
      }

      const message = mapToolResultToMessage(result)

      expect(message.userVisibleSummary).toBeDefined()
      expect(message.userVisibleSummary!.length).toBeLessThan(300)
      expect(message.userVisibleSummary).not.toContain(largeData)
    })
  })

  describe('edge cases', () => {
    it('should handle empty object result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-empty',
        result: {},
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toBe('{}')
      expect(message.isError).toBe(false)
    })

    it('should handle numeric result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-num',
        result: 42,
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toBe('42')
    })

    it('should handle boolean result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-bool',
        result: true,
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toBe('true')
    })

    it('should handle deeply nested object', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-nested',
        result: {
          level1: {
            level2: {
              level3: {
                value: 'deep',
              },
            },
          },
        },
      }

      const message = mapToolResultToMessage(result)

      expect(message.content).toContain('level1')
      expect(message.content).toContain('level2')
      expect(message.content).toContain('level3')
    })

    it('backward compat: preserves role, toolCallId, content, resultRef', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-compat',
        result: { text: 'hello' },
      }

      const message = mapToolResultToMessage(result)

      expect(message.role).toBe('tool')
      expect(message.toolCallId).toBe('call-compat')
      expect(message.content).toBe('{"text":"hello"}')
      expect(message.resultRef).toBeUndefined()
      expect(message.isError).toBe(false)
      expect(message.modelFacingContent).toBe('{"text":"hello"}')
    })
  })
})
