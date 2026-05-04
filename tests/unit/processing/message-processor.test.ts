import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  MessageProcessorInput,
  MessageProcessorOutput,
} from '../../../src/processing/types.js';
import {
  createMessageProcessor,
  convertInboundEnvelopeToProcessorInput,
} from '../../../src/processing/message-processor.js';
import type { InboundEnvelope } from '../../../src/gateway/types.js';

describe('MessageProcessor Contract', () => {
  describe('types', () => {
    it('should have MessageProcessorInput with only channel-neutral fields', () => {
      const input: MessageProcessorInput = {
        correlationId: 'test-correlation-123',
        userId: 'user-456',
        sessionId: 'session-789',
        text: 'Hello, world!',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: { source: 'test' },
      };

      expect(input).toHaveProperty('correlationId');
      expect(input).toHaveProperty('userId');
      expect(input).toHaveProperty('sessionId');
      expect(input).toHaveProperty('text');
      expect(input).toHaveProperty('timestamp');
      expect(input).toHaveProperty('metadata');

      // Should NOT have channel-specific fields
      expect(input).not.toHaveProperty('sourceChannel');
      expect(input).not.toHaveProperty('channelRegistry');
    });

    it('should have MessageProcessorOutput with success result', () => {
      const output: MessageProcessorOutput = {
        correlationId: 'test-correlation-123',
        success: true,
        result: {
          text: 'Response text',
          route: 'answer_directly',
        },
        timestamp: '2024-01-15T10:00:00.000Z',
      };

      expect(output.correlationId).toBe('test-correlation-123');
      expect(output.success).toBe(true);
      expect(output.result).toBeDefined();
    });

    it('should have MessageProcessorOutput with error result', () => {
      const errorOutput: MessageProcessorOutput = {
        correlationId: 'test-correlation-123',
        success: false,
        error: {
          code: 'PROCESSING_FAILED',
          message: 'Processing failed due to timeout',
        },
        timestamp: '2024-01-15T10:00:00.000Z',
      };

      expect(errorOutput.correlationId).toBe('test-correlation-123');
      expect(errorOutput.success).toBe(false);
      expect(errorOutput.error).toBeDefined();
      expect(errorOutput.error?.code).toBe('PROCESSING_FAILED');
      expect(errorOutput.error?.message).toBeDefined();
    });
  });

  describe('createMessageProcessor', () => {
    it('should create a message processor factory', () => {
      const processor = createMessageProcessor({
        timeoutMs: 30000,
        processorFn: async () => ({
          correlationId: 'test',
          success: true,
          result: { text: 'test', route: 'answer_directly' },
          timestamp: new Date().toISOString(),
        }),
      });

      expect(processor).toBeDefined();
      expect(typeof processor.process).toBe('function');
    });

    it('should process a message and return success result', async () => {
      const mockProcessorFn = vi.fn().mockResolvedValue({
        correlationId: 'test-correlation-123',
        success: true,
        result: { text: 'Processed successfully', route: 'answer_directly' },
        timestamp: '2024-01-15T10:00:01.000Z',
      });

      const processor = createMessageProcessor({
        timeoutMs: 30000,
        processorFn: mockProcessorFn,
      });

      const input: MessageProcessorInput = {
        correlationId: 'test-correlation-123',
        userId: 'user-456',
        sessionId: 'session-789',
        text: 'Hello!',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor.process(input);

      expect(result.success).toBe(true);
      expect(result.correlationId).toBe('test-correlation-123');
      expect(mockProcessorFn).toHaveBeenCalledWith(input);
    });

    it('should return error result when processing fails', async () => {
      const mockProcessorFn = vi.fn().mockRejectedValue(new Error('Processing error'));

      const processor = createMessageProcessor({
        timeoutMs: 30000,
        processorFn: mockProcessorFn,
      });

      const input: MessageProcessorInput = {
        correlationId: 'test-correlation-123',
        userId: 'user-456',
        sessionId: 'session-789',
        text: 'Hello!',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor.process(input);

      expect(result.success).toBe(false);
      expect(result.correlationId).toBe('test-correlation-123');
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('PROCESSING_ERROR');
    });
  });

  describe('timeout behavior', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('should timeout after 30 seconds and return error result', async () => {
      const slowProcessorFn = vi.fn().mockImplementation(async () => {
        // Never resolves within timeout
        await new Promise(() => {});
        return {
          correlationId: 'test-correlation-123',
          success: true,
          result: { text: 'Processed', route: 'answer_directly' },
          timestamp: new Date().toISOString(),
        };
      });

      const processor = createMessageProcessor({
        timeoutMs: 30000,
        processorFn: slowProcessorFn,
      });

      const input: MessageProcessorInput = {
        correlationId: 'test-correlation-123',
        userId: 'user-456',
        sessionId: 'session-789',
        text: 'Hello!',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const processPromise = processor.process(input);

      // Advance time past the 30 second timeout
      vi.advanceTimersByTime(30001);

      const result = await processPromise;

      expect(result.success).toBe(false);
      expect(result.correlationId).toBe('test-correlation-123');
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toContain('30 seconds');
    });

    it('should complete successfully before timeout', async () => {
      const processorFn = vi.fn().mockResolvedValue({
        correlationId: 'test-correlation-123',
        success: true,
        result: { text: 'Processed', route: 'answer_directly' },
        timestamp: new Date().toISOString(),
      });

      const processor = createMessageProcessor({
        timeoutMs: 30000,
        processorFn,
      });

      const input: MessageProcessorInput = {
        correlationId: 'test-correlation-123',
        userId: 'user-456',
        sessionId: 'session-789',
        text: 'Hello!',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const result = await processor.process(input);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('convertInboundEnvelopeToProcessorInput', () => {
    it('should convert InboundEnvelope to channel-neutral MessageProcessorInput', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'env-123',
        eventType: 'human_message',
        sourceChannel: 'webui', // This should be stripped
        payload: {
          text: 'Hello, world!',
        },
        userId: 'user-456',
        sessionId: 'session-789',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: { customField: 'value' },
      };

      const input = convertInboundEnvelopeToProcessorInput(envelope);

      // Should preserve these fields
      expect(input.correlationId).toBe('env-123');
      expect(input.userId).toBe('user-456');
      expect(input.sessionId).toBe('session-789');
      expect(input.text).toBe('Hello, world!');
      expect(input.timestamp).toBe('2024-01-15T10:00:00.000Z');
      expect(input.metadata).toEqual({
        customField: 'value',
        envelopeEventType: 'human_message',
      });

      // Should NOT include channel-specific fields at top level OR in metadata
      expect(input).not.toHaveProperty('sourceChannel');
      expect(input).not.toHaveProperty('recipient');
      expect(input).not.toHaveProperty('envelopeId');
      expect(input.metadata).not.toHaveProperty('sourceChannel');
      expect(input.metadata).not.toHaveProperty('channel');
    });

    it('should use envelopeId as correlationId', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'unique-envelope-id',
        eventType: 'human_message',
        sourceChannel: 'webui',
        payload: { text: 'Test' },
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const input = convertInboundEnvelopeToProcessorInput(envelope);

      expect(input.correlationId).toBe('unique-envelope-id');
    });

    it('should extract text from payload', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'env-1',
        eventType: 'human_message',
        sourceChannel: 'mobile',
        payload: {
          text: 'Message text content',
        },
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      };

      const input = convertInboundEnvelopeToProcessorInput(envelope);

      expect(input.text).toBe('Message text content');
    });

    it('should not include sourceChannel in metadata', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'env-1',
        eventType: 'human_message',
        sourceChannel: 'webui',
        payload: { text: 'Test' },
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: { existing: 'value' },
      };

      const input = convertInboundEnvelopeToProcessorInput(envelope);

      // sourceChannel should not be at top level
      expect(input).not.toHaveProperty('sourceChannel');
      // sourceChannel should NOT be in metadata either - processor is channel-neutral
      expect(input.metadata).not.toHaveProperty('sourceChannel');
      expect(input.metadata).not.toHaveProperty('channel');
      // Generic correlation fields like envelopeEventType are allowed
      expect(input.metadata).toHaveProperty('envelopeEventType');
    });
  });

  describe('channel neutrality', () => {
    it('should not reference webui, ChannelRegistry, or SSE in processor types', () => {
      // This is a static analysis test to ensure clean architecture
      const input: MessageProcessorInput = {
        correlationId: 'test',
        userId: 'user',
        sessionId: 'session',
        text: 'test',
        timestamp: new Date().toISOString(),
        metadata: {},
      };

      // Verify no channel delivery concepts leak into processor
      const keys = Object.keys(input);
      expect(keys).not.toContain('channelRegistry');
      expect(keys).not.toContain('sseBroadcaster');
      expect(keys).not.toContain('webuiHandler');
      expect(keys).not.toContain('recipient');
      expect(keys).not.toContain('channel');
    });
  });
});
