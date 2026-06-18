import { describe, it, expect } from 'vitest'
import type { SendMessageRequest } from '../../../src/api/types.js'
import type { InboundEnvelope } from '../../../src/gateway/types.js'
import type { MessageProcessorInput } from '../../../src/processing/types.js'
import { convertInboundEnvelopeToProcessorInput } from '../../../src/processing/message-processor.js'
import { createGateway } from '../../../src/gateway/gateway.js'

describe('Message Attachments Pipeline', () => {
  describe('SendMessageRequest', () => {
    it('should accept optional attachmentIds', () => {
      const request: SendMessageRequest = {
        text: 'Hello',
        attachmentIds: ['att-1', 'att-2'],
      }
      expect(request.attachmentIds).toEqual(['att-1', 'att-2'])
    })

    it('should work without attachmentIds', () => {
      const request: SendMessageRequest = { text: 'Hello' }
      expect(request.attachmentIds).toBeUndefined()
    })
  })

  describe('InboundEnvelope payload', () => {
    it('should carry attachmentIds in payload', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'env-1',
        eventType: 'human_message',
        sourceChannel: 'webui',
        payload: {
          text: 'Hello',
          attachmentIds: ['att-1', 'att-2'],
        },
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: '2024-01-15T10:00:00.000Z',
      }
      expect(envelope.payload.attachmentIds).toEqual(['att-1', 'att-2'])
    })

    it('should work without attachmentIds in payload', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'env-1',
        eventType: 'human_message',
        sourceChannel: 'webui',
        payload: { text: 'Hello' },
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: '2024-01-15T10:00:00.000Z',
      }
      expect(envelope.payload.attachmentIds).toBeUndefined()
    })
  })

  describe('receiveUserMessage', () => {
    it('should store attachmentIds in envelope payload', () => {
      const gateway = createGateway({
        stores: {
          eventStore: { append: () => {}, query: () => [] },
          summaryStore: { getSessionMemory: () => null },
          transcriptStore: { findBySession: () => [] },
          runtimeActionStore: {},
        },
      })

      const envelope = gateway.receiveUserMessage('user-1', 'session-1', 'Hello', 'webui', ['att-1', 'att-2'])

      expect(envelope.payload.attachmentIds).toEqual(['att-1', 'att-2'])
      expect(envelope.payload.text).toBe('Hello')
    })

    it('should work without attachmentIds', () => {
      const gateway = createGateway({
        stores: {
          eventStore: { append: () => {}, query: () => [] },
          summaryStore: { getSessionMemory: () => null },
          transcriptStore: { findBySession: () => [] },
          runtimeActionStore: {},
        },
      })

      const envelope = gateway.receiveUserMessage('user-1', 'session-1', 'Hello')

      expect(envelope.payload.attachmentIds).toBeUndefined()
      expect(envelope.payload.text).toBe('Hello')
    })
  })

  describe('MessageProcessorInput', () => {
    it('should include optional attachmentIds', () => {
      const input: MessageProcessorInput = {
        correlationId: 'corr-1',
        userId: 'user-1',
        sessionId: 'session-1',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
        attachmentIds: ['att-1'],
      }
      expect(input.attachmentIds).toEqual(['att-1'])
    })

    it('should work without attachmentIds', () => {
      const input: MessageProcessorInput = {
        correlationId: 'corr-1',
        userId: 'user-1',
        sessionId: 'session-1',
        text: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z',
      }
      expect(input.attachmentIds).toBeUndefined()
    })
  })

  describe('convertInboundEnvelopeToProcessorInput', () => {
    it('should propagate attachmentIds from envelope to processor input', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'env-1',
        eventType: 'human_message',
        sourceChannel: 'webui',
        payload: {
          text: 'Hello',
          attachmentIds: ['att-1', 'att-2'],
        },
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const input = convertInboundEnvelopeToProcessorInput(envelope)

      expect(input.attachmentIds).toEqual(['att-1', 'att-2'])
      expect(input.text).toBe('Hello')
    })

    it('should propagate undefined attachmentIds', () => {
      const envelope: InboundEnvelope = {
        envelopeId: 'env-1',
        eventType: 'human_message',
        sourceChannel: 'webui',
        payload: { text: 'Hello' },
        userId: 'user-1',
        sessionId: 'session-1',
        timestamp: '2024-01-15T10:00:00.000Z',
        metadata: {},
      }

      const input = convertInboundEnvelopeToProcessorInput(envelope)

      expect(input.attachmentIds).toBeUndefined()
    })
  })
})
