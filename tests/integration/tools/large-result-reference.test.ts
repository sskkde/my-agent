import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';
import {
  createToolResultBlobStore,
  type ToolResultBlobStore,
} from '../../../src/storage/tool-result-blob-store.js';
import {
  createToolResultProcessor,
  type ToolResultProcessor,
} from '../../../src/tools/runtime/tool-result-processor.js';
import type { ToolExecutionResult } from '../../../src/tools/types.js';

describe('Large Result Reference Integration', () => {
  let connection: ConnectionManager;
  let blobStore: ToolResultBlobStore;
  let processor: ToolResultProcessor;

  beforeEach(() => {
    connection = createConnectionManager(':memory:');
    connection.open();

    const migrationRunner = createMigrationRunner(connection);
    migrationRunner.init();
    migrationRunner.apply(allStoreMigrations);

    blobStore = createToolResultBlobStore(connection);
    processor = createToolResultProcessor(blobStore, {
      thresholdBytes: 1024, // 1KB for testing
      maxPreviewLength: 500,
    });
  });

  afterEach(() => {
    connection.close();
  });

  describe('connector large result', () => {
    it('stores 64 KiB connector result as blob with reference', () => {
      const largeData = generateLargeObject(64 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'connector.fetch_emails',
        userId: 'user-123',
        sessionId: 'session-456',
        toolCallId: 'tool-call-789',
        sensitivity: 'medium',
      });

      expect(processed.isLargeResult).toBe(true);
      expect(processed.rawBlobRef).toBeDefined();
      expect(processed.rawBlobRef?.blobId).toBeDefined();
      expect(processed.rawBlobRef?.sizeBytes).toBeGreaterThan(64 * 1024);
      expect(processed.preview).toBeDefined();
      expect(processed.preview?.length).toBeLessThanOrEqual(503); // 500 + '...'
      expect(processed.summary).toContain('connector.fetch_emails');
      expect(processed.sensitivity).toBe('medium');

      const blob = blobStore.getBlob(processed.rawBlobRef!.blobId, { userId: 'user-123' });
      expect(blob).toBeDefined();
      expect(blob?.toolCallId).toBe('tool-call-789');
      expect(blob?.userId).toBe('user-123');
      expect(blob?.sessionId).toBe('session-456');
    });

    it('result contains reference instead of raw data', () => {
      const largeData = generateLargeObject(10 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'connector.get_calendar',
        userId: 'user-123',
        toolCallId: 'tool-call-abc',
      });

      expect(processed.result.data).toBeUndefined();
      expect(processed.result.resultRef).toBe(processed.rawBlobRef?.blobId);
      expect(processed.result.resultPreview).toBe(processed.preview);
      expect(processed.result.structuredContent).toMatchObject({
        _type: 'blob_ref',
        blobId: processed.rawBlobRef?.blobId,
      });
    });

    it('preview is less than 2000 chars', () => {
      const largeData = generateLargeObject(64 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'connector.fetch_docs',
        userId: 'user-123',
        toolCallId: 'tool-call-def',
      });

      expect(processed.preview).toBeDefined();
      expect(processed.preview!.length).toBeLessThanOrEqual(503);
    });
  });

  describe('small result handling', () => {
    it('keeps small results inline', () => {
      const smallData = { message: 'Hello, world!', count: 42 };
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: smallData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'simple_tool',
        userId: 'user-123',
        toolCallId: 'tool-call-small',
      });

      expect(processed.isLargeResult).toBe(false);
      expect(processed.rawBlobRef).toBeUndefined();
      expect(processed.result.data).toEqual(smallData);
    });

    it('handles error results without blob storage', () => {
      const errorResult: ToolExecutionResult = {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: 'Something went wrong',
          recoverable: false,
        },
      };

      const processed = processor.processResult(errorResult, {
        toolName: 'failing_tool',
        userId: 'user-123',
        toolCallId: 'tool-call-error',
      });

      expect(processed.isLargeResult).toBe(false);
      expect(processed.rawBlobRef).toBeUndefined();
      expect(processed.result.success).toBe(false);
    });

    it('handles synthetic results without blob storage', () => {
      const syntheticResult: ToolExecutionResult = {
        success: false,
        status: 'timeout',
        synthetic: true,
        error: {
          code: 'TIMEOUT',
          message: 'Tool timed out',
          recoverable: true,
        },
      };

      const processed = processor.processResult(syntheticResult, {
        toolName: 'slow_tool',
        userId: 'user-123',
        toolCallId: 'tool-call-timeout',
      });

      expect(processed.isLargeResult).toBe(false);
      expect(processed.rawBlobRef).toBeUndefined();
    });
  });

  describe('unauthorized ref access', () => {
    it('returns undefined for cross-user blob access', () => {
      const largeData = generateLargeObject(5 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'connector.private_data',
        userId: 'user-owner',
        toolCallId: 'tool-call-private',
      });

      const blobId = processed.rawBlobRef!.blobId;

      const blob = blobStore.getBlob(blobId, { userId: 'user-attacker' });
      expect(blob).toBeUndefined();
    });

    it('allows session-based access', () => {
      const largeData = generateLargeObject(5 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'connector.session_data',
        userId: 'user-owner',
        sessionId: 'session-abc',
        toolCallId: 'tool-call-session',
      });

      const blobId = processed.rawBlobRef!.blobId;

      const blob = blobStore.getBlob(blobId, { sessionId: 'session-abc' });
      expect(blob).toBeDefined();
    });

    it('denies access without userId or sessionId', () => {
      const largeData = generateLargeObject(5 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'connector.protected',
        userId: 'user-owner',
        toolCallId: 'tool-call-protected',
      });

      const blobId = processed.rawBlobRef!.blobId;

      const blob = blobStore.getBlob(blobId, {});
      expect(blob).toBeUndefined();
    });
  });

  describe('blob store operations', () => {
    it('lists blobs by user', () => {
      for (let i = 0; i < 5; i++) {
        const largeData = generateLargeObject(2 * 1024);
        const toolExecutionResult: ToolExecutionResult = {
          success: true,
          data: largeData,
        };

        processor.processResult(toolExecutionResult, {
          toolName: `tool_${i}`,
          userId: 'user-list',
          toolCallId: `tool-call-${i}`,
        });
      }

      const blobs = blobStore.listBlobsByUser('user-list');
      expect(blobs).toHaveLength(5);
    });

    it('finds blobs by tool call id', () => {
      const largeData = generateLargeObject(2 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      processor.processResult(toolExecutionResult, {
        toolName: 'tool_multi',
        userId: 'user-multi',
        toolCallId: 'tool-call-multi',
      });

      const blobs = blobStore.getBlobByToolCall('tool-call-multi');
      expect(blobs).toHaveLength(1);
      expect(blobs[0]?.toolCallId).toBe('tool-call-multi');
    });

    it('deletes blobs', () => {
      const largeData = generateLargeObject(2 * 1024);
      const toolExecutionResult: ToolExecutionResult = {
        success: true,
        data: largeData,
      };

      const processed = processor.processResult(toolExecutionResult, {
        toolName: 'tool_delete',
        userId: 'user-delete',
        toolCallId: 'tool-call-delete',
      });

      const blobId = processed.rawBlobRef!.blobId;
      expect(blobStore.getBlob(blobId, { userId: 'user-delete' })).toBeDefined();

      const deleted = blobStore.deleteBlob(blobId);
      expect(deleted).toBe(true);
      expect(blobStore.getBlob(blobId, { userId: 'user-delete' })).toBeUndefined();
    });
  });
});

function generateLargeObject(targetBytes: number): Record<string, unknown> {
  const items: Array<{ id: number; data: string; timestamp: string }> = [];
  const itemSize = 200;
  const count = Math.ceil(targetBytes / itemSize);

  for (let i = 0; i < count; i++) {
    items.push({
      id: i,
      data: 'x'.repeat(itemSize - 50),
      timestamp: new Date().toISOString(),
    });
  }

  return {
    items,
    total: count,
    generated: new Date().toISOString(),
  };
}
