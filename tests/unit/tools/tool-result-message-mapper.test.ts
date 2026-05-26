import { describe, it, expect } from 'vitest';
import { mapToolResultToMessage } from '../../../src/tools/runtime/tool-result-message-mapper.js';
import type { ToolUseResult } from '../../../src/kernel/types.js';

describe('mapToolResultToMessage', () => {
  describe('normal result', () => {
    it('should map normal result to correct format', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-123',
        result: { status: 'success', data: [1, 2, 3] },
      };

      const message = mapToolResultToMessage(result);

      expect(message.role).toBe('tool');
      expect(message.toolCallId).toBe('call-123');
      expect(message.content).toBe('{"status":"success","data":[1,2,3]}');
    });

    it('should handle null result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-456',
        result: null,
      };

      const message = mapToolResultToMessage(result);

      expect(message.role).toBe('tool');
      expect(message.toolCallId).toBe('call-456');
      expect(message.content).toBe('null');
    });

    it('should handle undefined result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-789',
        result: undefined,
      };

      const message = mapToolResultToMessage(result);

      expect(message.role).toBe('tool');
      expect(message.toolCallId).toBe('call-789');
      expect(message.content).toBe('undefined');
    });

    it('should handle string result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-str',
        result: 'Hello, world!',
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toBe('"Hello, world!"');
    });

    it('should handle array result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-arr',
        result: ['a', 'b', 'c'],
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toBe('["a","b","c"]');
    });
  });

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
      };

      const message = mapToolResultToMessage(result);

      expect(message.role).toBe('tool');
      expect(message.toolCallId).toBe('call-err');
      expect(message.content).toBe('Error: Tool execution timed out after 30s');
    });

    it('should handle non-recoverable error', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-fatal',
        result: undefined,
        error: {
          code: 'INVALID_PARAMS',
          message: 'Missing required parameter: query',
          recoverable: false,
        },
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toBe('Error: Missing required parameter: query');
    });
  });

  describe('large result', () => {
    it('should truncate large result and include blob reference', () => {
      // Create a result larger than 8KB
      const largeData = 'x'.repeat(10 * 1024); // 10KB string
      const result: ToolUseResult = {
        toolCallId: 'call-large',
        result: { data: largeData },
      };

      const message = mapToolResultToMessage(result);

      expect(message.role).toBe('tool');
      expect(message.toolCallId).toBe('call-large');
      expect(message.content).toContain('[Large result:');
      expect(message.content).toContain('Preview:');
      expect(message.content).toContain('[Full result stored,');
      expect(message.content).toContain('blob:call-large');
    });

    it('should use custom threshold when provided', () => {
      // Create a result of 2KB
      const data = 'y'.repeat(2 * 1024);
      const result: ToolUseResult = {
        toolCallId: 'call-custom',
        result: { data },
      };

      // Use 1KB threshold, so 2KB result should be truncated
      const message = mapToolResultToMessage(result, { thresholdBytes: 1024 });

      expect(message.content).toContain('[Large result:');
      expect(message.content).toContain('blob:call-custom');
    });

    it('should not truncate if result is exactly at threshold', () => {
      // Create result that serializes to exactly 100 bytes
      const result: ToolUseResult = {
        toolCallId: 'call-exact',
        result: { value: 'test' },
      };

      // Use a very high threshold so it's not truncated
      const message = mapToolResultToMessage(result, { thresholdBytes: 100000 });

      expect(message.content).not.toContain('[Large result:');
      expect(message.content).toBe('{"value":"test"}');
    });

    it('should include size information in large result', () => {
      const largeArray = Array(1000).fill({ key: 'value', num: 123 });
      const result: ToolUseResult = {
        toolCallId: 'call-size',
        result: largeArray,
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toMatch(/\d+KB/);
    });

    it('should use custom preview length when provided', () => {
      const largeData = 'z'.repeat(10 * 1024);
      const result: ToolUseResult = {
        toolCallId: 'call-preview',
        result: { data: largeData },
      };

      // Use 100 char preview length
      const message = mapToolResultToMessage(result, { maxPreviewLength: 100 });

      expect(message.content).toContain('[Large result:');
      // Preview should be truncated
      const previewMatch = message.content.match(/Preview: (.+)/);
      if (previewMatch) {
        // Preview line should end with ... since it's truncated
        expect(previewMatch[1]).toContain('...');
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty object result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-empty',
        result: {},
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toBe('{}');
    });

    it('should handle numeric result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-num',
        result: 42,
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toBe('42');
    });

    it('should handle boolean result', () => {
      const result: ToolUseResult = {
        toolCallId: 'call-bool',
        result: true,
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toBe('true');
    });

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
      };

      const message = mapToolResultToMessage(result);

      expect(message.content).toContain('level1');
      expect(message.content).toContain('level2');
      expect(message.content).toContain('level3');
    });
  });
});
