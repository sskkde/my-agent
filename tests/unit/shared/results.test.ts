import { describe, it, expect } from 'vitest';
import type {
  SyntheticToolResult,
  SyntheticToolStatus,
} from '../../../src/shared/results';
import {
  SYNTHETIC_TOOL_STATUSES,
  INTERRUPT_BEHAVIORS,
} from '../../../src/shared/results';

describe('Results Contracts', () => {
  describe('SyntheticToolStatus', () => {
    it('should accept all documented synthetic tool statuses', () => {
      const statuses: SyntheticToolStatus[] = [
        'cancelled',
        'aborted',
        'timeout',
      ];

      expect(statuses).toHaveLength(3);

      statuses.forEach((status) => {
        expect(typeof status).toBe('string');
      });
    });

    it('should export SYNTHETIC_TOOL_STATUSES constant', () => {
      expect(SYNTHETIC_TOOL_STATUSES).toEqual({
        CANCELLED: 'cancelled',
        ABORTED: 'aborted',
        TIMEOUT: 'timeout',
      });
    });
  });

  describe('INTERRUPT_BEHAVIORS', () => {
    it('should export interrupt behavior constants', () => {
      expect(INTERRUPT_BEHAVIORS).toEqual({
        CANCEL: 'cancel',
        BLOCK: 'block',
        FINISH_CURRENT: 'finish_current',
      });
    });
  });

  describe('SyntheticToolResult', () => {
    it('should create a cancelled SyntheticToolResult', () => {
      const result: SyntheticToolResult = {
        toolCallId: 'tool_call_001',
        status: 'cancelled',
        isSynthetic: true,
        modelFacingContent: 'The tool execution was cancelled by user request.',
        userVisibleSummary: 'Tool execution was cancelled',
      };

      expect(result.toolCallId).toBe('tool_call_001');
      expect(result.status).toBe('cancelled');
      expect(result.isSynthetic).toBe(true);
      expect(result.modelFacingContent).toBe('The tool execution was cancelled by user request.');
      expect(result.userVisibleSummary).toBe('Tool execution was cancelled');
    });

    it('should create an aborted SyntheticToolResult', () => {
      const result: SyntheticToolResult = {
        toolCallId: 'tool_call_002',
        status: 'aborted',
        isSynthetic: true,
        modelFacingContent: 'The tool execution was aborted due to a sibling failure.',
        userVisibleSummary: 'Tool execution was aborted',
      };

      expect(result.status).toBe('aborted');
      expect(result.isSynthetic).toBe(true);
    });

    it('should create a timeout SyntheticToolResult', () => {
      const result: SyntheticToolResult = {
        toolCallId: 'tool_call_003',
        status: 'timeout',
        isSynthetic: true,
        modelFacingContent: 'The tool execution timed out before completion.',
        userVisibleSummary: 'Tool execution timed out',
      };

      expect(result.status).toBe('timeout');
      expect(result.isSynthetic).toBe(true);
    });

    it('should support SyntheticToolResult without userVisibleSummary', () => {
      const result: SyntheticToolResult = {
        toolCallId: 'tool_call_004',
        status: 'cancelled',
        isSynthetic: true,
        modelFacingContent: 'Tool was cancelled',
      };

      expect(result.userVisibleSummary).toBeUndefined();
    });

    it('should require isSynthetic to be true', () => {
      const result: SyntheticToolResult = {
        toolCallId: 'tool_call_005',
        status: 'cancelled',
        isSynthetic: true,
        modelFacingContent: 'Tool was cancelled',
      };

      expect(result.isSynthetic).toBe(true);
    });
  });
});
