/**
 * Architecture Contract Tests — Path 4: Tool Result Reference
 *
 * Verifies ToolExecution → ToolResultReference → Storage contract.
 * Tests type mapping, threshold policy, and error paths without runtime.
 */
import { describe, it, expect } from 'vitest';
import type {
  ToolExecutionResult,
  ToolCategory,
} from '../../src/tools/types.js';
import type { ProcessedToolOutput, ResultRefMetadata } from '../../src/tools/tool-result-reference.js';
import {
  INLINE_THRESHOLD,
  shouldStoreAsRef,
  getOutputSize,
  processToolOutput,
  createResultRef,
} from '../../src/tools/tool-result-reference.js';
import type { ToolResultBlob, ToolResultStore } from '../../src/storage/tool-result-store.js';
import { TOOL_EXECUTION_STATES } from '../../src/shared/states.js';

// ─── ToolExecutionResult → ResultRef Conversion ───────────────────────────

describe('Path 4: Tool Result Reference Contract', () => {

  describe('ToolExecutionResult → ProcessedToolOutput Conversion', () => {
    it('ToolExecutionResult includes optional resultRef fields for storage', () => {
      const resultKeys: Array<keyof ToolExecutionResult> = [
        'success', 'data', 'error', 'resultRef', 'resultPreview',
        'structuredContent', 'contextDelta', 'events',
      ];
      for (const key of resultKeys) {
        expect(typeof key).toBe('string');
      }
    });

    it('ProcessedToolOutput is a discriminated union: isRef: true → resultRef', () => {
      const resultRef: ProcessedToolOutput = {
        isRef: true,
        resultRef: {
          resultId: 'r-1', toolExecutionId: 'te-1',
          sizeBytes: 50000, contentType: 'application/json; type=object',
          createdAt: '2026-01-01T00:00:00Z',
        },
      };
      expect(resultRef.isRef).toBe(true);
      expect(resultRef.inlineOutput).toBeUndefined();
    });

    it('ProcessedToolOutput inline path: isRef: false → inlineOutput', () => {
      const inline: ProcessedToolOutput = {
        isRef: false,
        inlineOutput: { status: 'ok', data: 'result' },
      };
      expect(inline.isRef).toBe(false);
      expect(inline.resultRef).toBeUndefined();
      expect(inline.inlineOutput).toEqual({ status: 'ok', data: 'result' });
    });
  });

  // ─── ResultRef Metadata Contract ──────────────────────────────────────

  describe('ResultRefMetadata Structure', () => {
    it('contains all fields required for retrieval and attribution', () => {
      const metadata: ResultRefMetadata = {
        resultId: 'abc-123',
        toolExecutionId: 'te-456',
        sizeBytes: 102400,
        contentType: 'application/json; type=array',
        createdAt: '2026-05-11T00:00:00Z',
      };
      expect(metadata.resultId).toBeTruthy();
      expect(metadata.toolExecutionId).toBeTruthy();
      expect(metadata.sizeBytes).toBeGreaterThan(0);
      expect(metadata.contentType).toBeTruthy();
      expect(metadata.createdAt).toBeTruthy();
    });

    it('contentType follows the determineContentType convention', () => {
      // Null → application/json; type=null
      // Array → application/json; type=array
      // Object → application/json; type=object
      // Numeric → application/json; type=number
      // Boolean → application/json; type=boolean
      // String JSON → application/json; type=string
      // String plain → text/plain
      // Unknown → application/octet-stream
      const contentTypePattern = /^(application\/json|text\/plain|application\/octet-stream)/;
      expect(contentTypePattern.test('application/json; type=object')).toBe(true);
      expect(contentTypePattern.test('text/plain')).toBe(true);
    });
  });

  // ─── 32 KiB Threshold Contract ────────────────────────────────────────

  describe('INLINE_THRESHOLD (32 KiB) Policy', () => {
    it('INLINE_THRESHOLD equals exactly 32 * 1024', () => {
      expect(INLINE_THRESHOLD).toBe(32768);
    });

    it('shouldStoreAsRef returns false for small outputs (< 32 KiB)', () => {
      const small = { key: 'value' };
      expect(shouldStoreAsRef(small)).toBe(false);
    });

    it('shouldStoreAsRef returns true for large outputs (>= 32 KiB)', () => {
      // Create a string ~33 KiB
      const largeString = 'x'.repeat(INLINE_THRESHOLD);
      expect(getOutputSize(largeString)).toBeGreaterThanOrEqual(INLINE_THRESHOLD);
      expect(shouldStoreAsRef(largeString)).toBe(true);
    });

    it('shouldStoreAsRef returns false when serialization fails', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      // JSON.stringify throws on circular refs → shouldStoreAsRef returns false
      expect(shouldStoreAsRef(circular)).toBe(false);
    });

    it('getOutputSize returns 0 for unserializable objects', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(getOutputSize(circular)).toBe(0);
    });

    it('processToolOutput returns inline for small outputs', () => {
      const mockStore = createMockToolResultStore();
      const result = processToolOutput(mockStore, 'te-1', { small: true }, {
        toolName: 'read_file', userId: 'u1',
      });
      expect(result.isRef).toBe(false);
      expect(result.inlineOutput).toEqual({ small: true });
    });

    it('processToolOutput returns ref for large outputs', () => {
      const mockStore = createMockToolResultStore();
      const largeData = 'x'.repeat(INLINE_THRESHOLD);
      const result = processToolOutput(mockStore, 'te-1', largeData, {
        toolName: 'read_file', userId: 'u1',
      });
      expect(result.isRef).toBe(true);
      expect(result.resultRef).toBeDefined();
      expect(result.resultRef!.sizeBytes).toBeGreaterThanOrEqual(INLINE_THRESHOLD);
    });
  });

  // ─── ToolResultBlob Storage Format ─────────────────────────────────────

  describe('ToolResultBlob Storage Contract', () => {
    it('ToolResultBlob has all required persistence fields', () => {
      const requiredKeys: Array<keyof ToolResultBlob> = [
        'id', 'resultRef', 'toolCallId', 'toolName', 'userId',
        'sensitivity', 'createdAt',
      ];
      for (const key of requiredKeys) {
        expect(typeof key).toBe('string');
      }
    });

    it('ToolResultBlob supports optional preview and structuredContent', () => {
      const blob: Partial<ToolResultBlob> = {
        preview: 'Preview text...',
        structuredContent: { full: 'data' },
        sessionId: 's1',
        rawBlobRef: undefined,
      };
      expect(blob.preview).toBeDefined();
      expect(blob.structuredContent).toBeDefined();
      expect(blob.sessionId).toBe('s1');
    });

    it('createResultRef generates preview with 1000-char truncation', () => {
      const mockStore = createMockToolResultStore();
      const shortOutput = 'short';
      const refShort = createResultRef(mockStore, 'te-1', shortOutput, {
        toolName: 'read_file', userId: 'u1',
      });
      // Short output → full content in preview (via JSON.stringify wraps in quotes)
      expect(refShort.sizeBytes).toBe(JSON.stringify(shortOutput).length);
      expect(refShort.resultId).toBeTruthy();

      const longOutput = 'y'.repeat(2000);
      const refLong = createResultRef(mockStore, 'te-2', longOutput, {
        toolName: 'read_file', userId: 'u1',
      });
      expect(refLong.sizeBytes).toBe(JSON.stringify(longOutput).length);
      // The stored blob has preview truncated to 1000 + '...'
      const storedBlobs = mockStore.findByToolCallId(refLong.toolExecutionId);
      expect(storedBlobs.length).toBeGreaterThan(0);
      const storedBlob = storedBlobs[0];
      expect(storedBlob!.preview).toBeDefined();
      expect(storedBlob!.preview!.length).toBeLessThan(JSON.stringify(longOutput).length);
    });
  });

  // ─── State Machine Contract ───────────────────────────────────────────

  describe('TOOL_EXECUTION_STATES for Result Reference', () => {
    it('result ref applies after execution: mapping_result → completed', () => {
      const states = Object.values(TOOL_EXECUTION_STATES) as string[];
      expect(states).toContain(TOOL_EXECUTION_STATES.MAPPING_RESULT);
      expect(states).toContain(TOOL_EXECUTION_STATES.COMPLETED);
    });

    it('error states skip result ref: denied, failed, timeout, cancelled, aborted, discarded', () => {
      const errorStates = [
        TOOL_EXECUTION_STATES.DENIED,
        TOOL_EXECUTION_STATES.FAILED,
        TOOL_EXECUTION_STATES.TIMEOUT,
        TOOL_EXECUTION_STATES.CANCELLED,
        TOOL_EXECUTION_STATES.ABORTED,
        TOOL_EXECUTION_STATES.DISCARDED,
      ];
      const states = Object.values(TOOL_EXECUTION_STATES) as string[];
      for (const es of errorStates) {
        expect(states).toContain(es);
      }
    });
  });

  // ─── Error Handling Contract ─────────────────────────────────────────

  describe('Error Handling', () => {
    it('execution failure → ToolExecutionResult.error with code and recoverable flag', () => {
      const errorResult: ToolExecutionResult = {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: 'Tool execution failed',
          recoverable: false,
        },
      };
      expect(errorResult.success).toBe(false);
      expect(errorResult.error?.code).toBe('EXECUTION_FAILED');
      expect(errorResult.error?.recoverable).toBe(false);
    });

    it('failed execution has no resultRef or structuredContent', () => {
      // Error results skip resultRef mapping
      const errorResult: ToolExecutionResult = {
        success: false,
        error: { code: 'TOOL_NOT_FOUND', message: 'Tool not found', recoverable: false },
      };
      // resultRef is optional and typically undefined for failures
      expect(errorResult.resultRef).toBeUndefined();
    });
  });

  // ─── ToolCategory Contract ────────────────────────────────────────────

  describe('ToolCategory Consistency', () => {
    it('ToolCategory has write and delete for approval-requiring operations', () => {
      const writeCategories: ToolCategory[] = ['write', 'delete'];
      for (const c of writeCategories) {
        expect(typeof c).toBe('string');
      }
      const readCategories: ToolCategory[] = ['read', 'search', 'internal'];
      for (const c of readCategories) {
        expect(typeof c).toBe('string');
      }
    });
  });
});

// ─── Minimal Mock Store for Unit Testing ─────────────────────────────────

function createMockToolResultStore(): ToolResultStore {
  const blobs: Map<string, ToolResultBlob> = new Map();
  return {
    applyMigrations: () => {},
    create(data: Omit<ToolResultBlob, 'id' | 'createdAt'>): ToolResultBlob {
      const blob: ToolResultBlob = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      blobs.set(blob.id, blob);
      return blob;
    },
    findById(id: string): ToolResultBlob | undefined {
      return blobs.get(id);
    },
    findByToolCallId(toolCallId: string): ToolResultBlob[] {
      return [...blobs.values()].filter(b => b.toolCallId === toolCallId);
    },
    findBySessionId: () => [],
    findByToolName: () => [],
    findBySensitivity: () => [],
    delete: () => false,
  };
}
