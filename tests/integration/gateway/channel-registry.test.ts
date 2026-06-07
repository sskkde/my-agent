import { describe, it, expect, beforeEach } from 'vitest'
import {
  createChannelRegistry,
  createWebUIChannelHandler,
  type ChannelRegistry,
  type ChannelHandler,
  type DeliveryResult,
} from '../../../src/gateway/channel-registry.js'
import type { OutboundEnvelope } from '../../../src/gateway/types.js'

describe('Channel Registry', () => {
  let registry: ChannelRegistry

  beforeEach(() => {
    registry = createChannelRegistry()
  })

  describe('registration', () => {
    it('should register a channel handler', () => {
      const handler: ChannelHandler = {
        deliver: (): DeliveryResult => ({ success: true }),
      }

      registry.register('test-channel', handler)

      expect(registry.has('test-channel')).toBe(true)
    })

    it('should retrieve a registered channel', () => {
      const handler: ChannelHandler = {
        deliver: (): DeliveryResult => ({ success: true }),
      }

      registry.register('test-channel', handler)
      const entry = registry.get('test-channel')

      expect(entry).toBeDefined()
      expect(entry?.id).toBe('test-channel')
      expect(entry?.handler).toBe(handler)
    })

    it('should return undefined for unregistered channel', () => {
      const entry = registry.get('nonexistent')
      expect(entry).toBeUndefined()
    })

    it('should list all registered channels', () => {
      const handler1: ChannelHandler = { deliver: (): DeliveryResult => ({ success: true }) }
      const handler2: ChannelHandler = { deliver: (): DeliveryResult => ({ success: true }) }

      registry.register('channel-1', handler1)
      registry.register('channel-2', handler2)

      const channels = registry.list()

      expect(channels).toHaveLength(2)
      expect(channels.map((c) => c.connectorId)).toContain('channel-1')
      expect(channels.map((c) => c.connectorId)).toContain('channel-2')
    })

    it('should unregister a channel', () => {
      const handler: ChannelHandler = { deliver: (): DeliveryResult => ({ success: true }) }

      registry.register('test-channel', handler)
      const removed = registry.unregister('test-channel')

      expect(removed).toBe(true)
      expect(registry.has('test-channel')).toBe(false)
    })

    it('should return false when unregistering nonexistent channel', () => {
      const removed = registry.unregister('nonexistent')
      expect(removed).toBe(false)
    })
  })

  describe('webui channel', () => {
    it('should have webui channel registered by default when created with factory', () => {
      const webuiHandler = createWebUIChannelHandler()

      const envelope: OutboundEnvelope = {
        envelopeId: 'env-1',
        messageType: 'text',
        recipient: { userId: 'user-1', sessionId: 'session-1', channel: 'webui' },
        content: { text: 'Hello' },
        correlationId: 'corr-1',
        timestamp: new Date().toISOString(),
      }

      const result = webuiHandler.deliver(envelope)

      expect(result.success).toBe(true)
    })

    it('should include webui in channel list when registered', () => {
      const webuiHandler = createWebUIChannelHandler()
      registry.register('webui', webuiHandler, {
        type: 'webui',
        status: 'active',
        configured: true,
      })

      const channels = registry.list()

      expect(channels).toHaveLength(1)
      expect(channels[0].connectorId).toBe('webui')
      expect(channels[0].type).toBe('webui')
    })
  })

  describe('delivery', () => {
    it('should deliver envelope to registered channel', () => {
      const deliveredEnvelopes: OutboundEnvelope[] = []
      const handler: ChannelHandler = {
        deliver: (envelope: OutboundEnvelope): DeliveryResult => {
          deliveredEnvelopes.push(envelope)
          return { success: true }
        },
      }

      registry.register('test-channel', handler)

      const envelope: OutboundEnvelope = {
        envelopeId: 'env-1',
        messageType: 'text',
        recipient: { userId: 'user-1', sessionId: 'session-1', channel: 'test-channel' },
        content: { text: 'Hello' },
        correlationId: 'corr-1',
        timestamp: new Date().toISOString(),
      }

      const result = registry.deliver('test-channel', envelope)

      expect(result.success).toBe(true)
      expect(deliveredEnvelopes).toHaveLength(1)
      expect(deliveredEnvelopes[0].envelopeId).toBe('env-1')
    })

    it('should return controlled failure for unknown channel', () => {
      const envelope: OutboundEnvelope = {
        envelopeId: 'env-1',
        messageType: 'text',
        recipient: { userId: 'user-1', sessionId: 'session-1', channel: 'unknown' },
        content: { text: 'Hello' },
        correlationId: 'corr-1',
        timestamp: new Date().toISOString(),
      }

      const result = registry.deliver('unknown-channel', envelope)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('CHANNEL_NOT_FOUND')
      expect(result.error?.message).toContain('unknown-channel')
    })

    it('should not throw for unknown channel delivery', () => {
      const envelope: OutboundEnvelope = {
        envelopeId: 'env-1',
        messageType: 'text',
        recipient: { userId: 'user-1', sessionId: 'session-1' },
        content: { text: 'Hello' },
        correlationId: 'corr-1',
        timestamp: new Date().toISOString(),
      }

      expect(() => {
        registry.deliver('nonexistent-channel', envelope)
      }).not.toThrow()
    })

    it('should handle handler errors gracefully', () => {
      const handler: ChannelHandler = {
        deliver: (): DeliveryResult => {
          throw new Error('Handler error')
        },
      }

      registry.register('error-channel', handler)

      const envelope: OutboundEnvelope = {
        envelopeId: 'env-1',
        messageType: 'text',
        recipient: { userId: 'user-1', sessionId: 'session-1' },
        content: { text: 'Hello' },
        correlationId: 'corr-1',
        timestamp: new Date().toISOString(),
      }

      const result = registry.deliver('error-channel', envelope)

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('DELIVERY_ERROR')
    })

    it('should not throw when handler throws', () => {
      const handler: ChannelHandler = {
        deliver: (): never => {
          throw new Error('Handler error')
        },
      }

      registry.register('error-channel', handler)

      const envelope: OutboundEnvelope = {
        envelopeId: 'env-1',
        messageType: 'text',
        recipient: { userId: 'user-1', sessionId: 'session-1' },
        content: { text: 'Hello' },
        correlationId: 'corr-1',
        timestamp: new Date().toISOString(),
      }

      expect(() => {
        registry.deliver('error-channel', envelope)
      }).not.toThrow()
    })
  })

  describe('metadata', () => {
    it('should store custom metadata on registration', () => {
      const handler: ChannelHandler = { deliver: (): DeliveryResult => ({ success: true }) }

      registry.register('custom-channel', handler, {
        type: 'slack',
        status: 'active',
        configured: true,
      })

      const entry = registry.get('custom-channel')

      expect(entry?.metadata.type).toBe('slack')
      expect(entry?.metadata.status).toBe('active')
      expect(entry?.metadata.configured).toBe(true)
    })

    it('should use default metadata when not provided', () => {
      const handler: ChannelHandler = { deliver: (): DeliveryResult => ({ success: true }) }

      registry.register('default-channel', handler)

      const entry = registry.get('default-channel')

      expect(entry?.metadata.connectorId).toBe('default-channel')
      expect(entry?.metadata.type).toBe('custom')
      expect(entry?.metadata.status).toBe('active')
      expect(entry?.metadata.configured).toBe(true)
    })
  })
})

describe('createChannelRegistry factory', () => {
  it('should create independent registries', () => {
    const registry1 = createChannelRegistry()
    const registry2 = createChannelRegistry()

    const handler: ChannelHandler = { deliver: (): DeliveryResult => ({ success: true }) }

    registry1.register('channel-1', handler)
    registry2.register('channel-2', handler)

    expect(registry1.has('channel-1')).toBe(true)
    expect(registry1.has('channel-2')).toBe(false)
    expect(registry2.has('channel-1')).toBe(false)
    expect(registry2.has('channel-2')).toBe(true)
  })
})
