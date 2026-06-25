import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { MessageProcessor, MessageProcessorOutput } from '../../../src/processing/types.js'
import type { OutboundEnvelope } from '../../../src/gateway/types.js'
import type { DeliveryResult } from '../../../src/gateway/channel-registry.js'

async function closeSseReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The stream may already be closed or aborted by the test timeout controller.
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // Ignore already-released locks.
    }
  }
}

describe('Outbound WebUI Routing - Task 8', () => {
  let server: FastifyInstance
  let baseUrl: string
  let apiContext: ApiContext
  let authCookie: string

  let deliveredEnvelopes: Array<{ channelId: string; envelope: OutboundEnvelope }>

  function createFailingProcessor(context: ApiContext): MessageProcessor {
    return {
      process: async (input): Promise<MessageProcessorOutput> => {
        const timestamp = new Date().toISOString()
        const output: MessageProcessorOutput = {
          correlationId: input.correlationId,
          success: false,
          error: {
            code: 'PROCESSING_ERROR',
            message: 'Test processor failure',
          },
          timestamp,
        }

        context.stores.transcriptStore.saveTurn({
          turnId: input.correlationId,
          sessionId: input.sessionId,
          userId: input.userId,
          input: {
            userMessageSummary: input.text,
          },
          output: {
            visibleMessages: [
              {
                messageId: `msg-${input.correlationId}-error`,
                role: 'error',
                content: '[PROCESSING_ERROR] Test processor failure',
              },
            ],
          },
          visibility: 'public',
          createdAt: timestamp,
        })

        return output
      },
    }
  }

  beforeAll(async () => {
    deliveredEnvelopes = []

    const ctx = createApiContext({
      dbPath: ':memory:',
    })

    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`)
    }
    apiContext = ctx
    apiContext.messageProcessor = createFailingProcessor(apiContext)

    const originalDeliver = apiContext.channelRegistry.deliver.bind(apiContext.channelRegistry)
    apiContext.channelRegistry.deliver = (channelId: string, envelope: OutboundEnvelope): Promise<DeliveryResult> => {
      deliveredEnvelopes.push({ channelId, envelope })
      return originalDeliver(channelId, envelope)
    }

    server = await createApiServer(apiContext)
    await server.listen()
    const address = server.server.address()
    baseUrl = `http://localhost:${(address as any).port}`

    const setupResponse = await fetch(`${baseUrl}/api/v1/setup/user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'testuser', password: 'password123' }),
    })

    expect(setupResponse.status).toBe(201)
    authCookie = setupResponse.headers.get('set-cookie')!
  })

  afterAll(async () => {
    await server.close()
    if (apiContext && 'connection' in apiContext) {
      ;(apiContext as any).connection.close()
    }
  })

  describe('Outbound envelope routing', () => {
    it('should deliver outbound envelope through webui channel', async () => {
      deliveredEnvelopes = []

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Test message' }),
      })

      expect(response.status).toBe(202)
      const body = (await response.json()) as { data: { correlationId: string; envelopeId: string } }
      const correlationId = body.data.correlationId

      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(deliveredEnvelopes.length).toBeGreaterThanOrEqual(1)

      const webuiDelivery = deliveredEnvelopes.find((d) => d.channelId === 'webui')
      expect(webuiDelivery).toBeDefined()
      expect(webuiDelivery!.envelope.recipient.channel).toBe('webui')
      expect(webuiDelivery!.envelope.correlationId).toBe(correlationId)
    })

    it('should use gateway.formatOutbound() for replies', async () => {
      deliveredEnvelopes = []

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Hello' }),
      })

      await new Promise((resolve) => setTimeout(resolve, 200))

      const webuiDelivery = deliveredEnvelopes.find((d) => d.channelId === 'webui')
      expect(webuiDelivery).toBeDefined()

      const envelope = webuiDelivery!.envelope
      expect(envelope.envelopeId).toBeDefined()
      expect(envelope.messageType).toBe('error')
      expect(envelope.recipient.userId).toBeDefined()
      expect(envelope.recipient.sessionId).toBe(sessionId)
      expect(envelope.content.error).toBeDefined()
      expect(envelope.timestamp).toBeDefined()
    })

    it('should set recipient channel from original sourceChannel', async () => {
      deliveredEnvelopes = []

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Channel test' }),
      })

      await new Promise((resolve) => setTimeout(resolve, 200))

      const webuiDelivery = deliveredEnvelopes.find((d) => d.channelId === 'webui')
      expect(webuiDelivery).toBeDefined()
      expect(webuiDelivery!.envelope.recipient.channel).toBe('webui')
    })

    it('should default sourceChannel to webui when omitted', async () => {
      deliveredEnvelopes = []

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Default channel test' }),
      })

      expect(response.status).toBe(202)

      await new Promise((resolve) => setTimeout(resolve, 200))

      const webuiDelivery = deliveredEnvelopes.find((d) => d.channelId === 'webui')
      expect(webuiDelivery).toBeDefined()
      expect(webuiDelivery!.envelope.recipient.channel).toBe('webui')
    })

    it('should fall back to webui when sourceChannel is not registered', async () => {
      deliveredEnvelopes = []

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Unknown channel test', sourceChannel: 'nonexistent-channel' }),
      })

      expect(response.status).toBe(202)

      await new Promise((resolve) => setTimeout(resolve, 200))

      const webuiDelivery = deliveredEnvelopes.find((d) => d.channelId === 'webui')
      expect(webuiDelivery).toBeDefined()
      expect(webuiDelivery!.envelope.recipient.channel).toBe('webui')
    })

    it('should route success responses through webui channel', async () => {
      deliveredEnvelopes = []

      const successProcessor: MessageProcessor = {
        process: async (input): Promise<MessageProcessorOutput> => {
          return {
            correlationId: input.correlationId,
            success: true,
            result: {
              text: 'Success response',
              route: 'answer_directly',
            },
            timestamp: new Date().toISOString(),
          }
        },
      }

      const successCtx = createApiContext({
        dbPath: ':memory:',
        messageProcessor: successProcessor,
      })

      if (isApiContextError(successCtx)) {
        throw new Error(`Failed to create API context: ${successCtx.message}`)
      }

      const originalDeliver = successCtx.channelRegistry.deliver.bind(successCtx.channelRegistry)
      successCtx.channelRegistry.deliver = (channelId: string, envelope: OutboundEnvelope): Promise<DeliveryResult> => {
        deliveredEnvelopes.push({ channelId, envelope })
        return originalDeliver(channelId, envelope)
      }

      const successServer = await createApiServer(successCtx)
      await successServer.listen()
      const address = successServer.server.address()
      const successBaseUrl = `http://localhost:${(address as any).port}`

      const setupResponse = await fetch(`${successBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'successuser', password: 'password123' }),
      })
      const successAuthCookie = setupResponse.headers.get('set-cookie')!

      const createResponse = await fetch(`${successBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: successAuthCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      await fetch(`${successBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: successAuthCookie },
        body: JSON.stringify({ text: 'Success test' }),
      })

      await new Promise((resolve) => setTimeout(resolve, 200))

      const webuiDelivery = deliveredEnvelopes.find((d) => d.channelId === 'webui')
      expect(webuiDelivery).toBeDefined()
      expect(webuiDelivery!.envelope.messageType).toBe('text')
      expect(webuiDelivery!.envelope.content.text).toBe('Success response')

      await successServer.close()
      ;(successCtx as any).connection.close()
    })
  })

  describe('Live SSE event delivery', () => {
    it('should receive error timeline event via SSE when processing fails', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      let receivedErrorEvent = false
      let sseChunks = ''

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/event-stream')

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()

        const readPromise = (async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            sseChunks += decoder.decode(value, { stream: true })
            if (sseChunks.includes('"eventType":"error"')) {
              receivedErrorEvent = true
              break
            }
          }
        })()

        await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: authCookie },
          body: JSON.stringify({ text: 'Error trigger message' }),
        })

        await Promise.race([
          readPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000)),
        ])

        expect(receivedErrorEvent).toBe(true)
        expect(sseChunks).toContain('event: timeline_event')
        expect(sseChunks).toContain('"eventType":"error"')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should receive assistant_message via SSE through Gateway flow', async () => {
      const successCtx = createApiContext({
        dbPath: ':memory:',
      })

      if (isApiContextError(successCtx)) {
        throw new Error(`Failed to create API context: ${successCtx.message}`)
      }

      // Create processor that persists transcript before returning success
      const transcriptStore = successCtx.stores.transcriptStore
      const successProcessor: MessageProcessor = {
        process: async (input): Promise<MessageProcessorOutput> => {
          const correlationId = input.correlationId

          // Persist transcript with assistant message
          transcriptStore.saveTurn({
            turnId: correlationId,
            sessionId: input.sessionId,
            userId: input.userId,
            input: {
              userMessageSummary: input.text,
            },
            output: {
              visibleMessages: [
                {
                  messageId: `msg-${correlationId}-assistant`,
                  role: 'assistant',
                  content: 'Live assistant response via Gateway',
                },
              ],
            },
            visibility: 'public',
            createdAt: new Date().toISOString(),
          })

          return {
            correlationId,
            success: true,
            result: {
              text: 'Live assistant response via Gateway',
              route: 'answer_directly',
            },
            timestamp: new Date().toISOString(),
          }
        },
      }

      // Inject the processor by creating a new context with it
      const finalCtx = createApiContext({
        dbPath: ':memory:',
        existingStores: successCtx.stores,
        messageProcessor: successProcessor,
        timelineBroadcaster: successCtx.timelineBroadcaster,
        channelRegistry: successCtx.channelRegistry,
      })

      if (isApiContextError(finalCtx)) {
        throw new Error(`Failed to create API context: ${finalCtx.message}`)
      }

      const successServer = await createApiServer(finalCtx)
      await successServer.listen()
      const address = successServer.server.address()
      const successBaseUrl = `http://localhost:${(address as any).port}`

      const setupResponse = await fetch(`${successBaseUrl}/api/v1/setup/user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'assistantuser', password: 'password123' }),
      })
      const successAuthCookie = setupResponse.headers.get('set-cookie')!

      const createResponse = await fetch(`${successBaseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: successAuthCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      let receivedAssistantEvent = false
      let sseChunks = ''

      try {
        const response = await fetch(`${successBaseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: { Cookie: successAuthCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()

        const readPromise = (async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            sseChunks += decoder.decode(value, { stream: true })
            if (sseChunks.includes('"eventType":"assistant_message"')) {
              receivedAssistantEvent = true
              break
            }
          }
        })()

        // Send message - this triggers Gateway -> Processor -> Transcript -> Channel -> SSE flow
        const messageResponse = await fetch(`${successBaseUrl}/api/v1/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: successAuthCookie },
          body: JSON.stringify({ text: 'Trigger assistant response' }),
        })
        expect(messageResponse.status).toBe(202)
        await messageResponse.json()

        await Promise.race([
          readPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000)),
        ])

        expect(receivedAssistantEvent).toBe(true)
        expect(sseChunks).toContain('event: timeline_event')
        expect(sseChunks).toContain('"eventType":"assistant_message"')
        expect(sseChunks).toContain('Live assistant response via Gateway')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }

      await successServer.close()
      ;(finalCtx as any).connection.close()
      ;(successCtx as any).connection.close()
    })

    it('should receive user_message via SSE for sent messages', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      let receivedUserEvent = false
      let sseChunks = ''

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()

        const readPromise = (async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            sseChunks += decoder.decode(value, { stream: true })
            if (sseChunks.includes('"eventType":"user_message"')) {
              receivedUserEvent = true
              break
            }
          }
        })()

        await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: authCookie },
          body: JSON.stringify({ text: 'User message content' }),
        })

        await Promise.race([
          readPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 4000)),
        ])

        expect(receivedUserEvent).toBe(true)
        expect(sseChunks).toContain('event: timeline_event')
        expect(sseChunks).toContain('"eventType":"user_message"')
        expect(sseChunks).toContain('User message content')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should catch up missed events on reconnect with Last-Event-ID', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const firstController = new AbortController()
      const firstTimeout = setTimeout(() => firstController.abort(), 5000)
      let lastEventId = ''
      let firstChunks = ''

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: firstController.signal,
        })

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()

        await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: authCookie },
          body: JSON.stringify({ text: 'First message' }),
        })

        for (let i = 0; i < 50; i++) {
          const { done, value } = await reader.read()
          if (done) break
          firstChunks += decoder.decode(value, { stream: true })
          if (firstChunks.includes('"eventType":"error"')) break
          await new Promise((r) => setTimeout(r, 50))
        }

        const idMatch = firstChunks.match(/id: (turn-[^\n]+)/)
        if (idMatch) {
          lastEventId = idMatch[1]
        }

        await closeSseReader(reader)
      } finally {
        clearTimeout(firstTimeout)
        firstController.abort()
      }

      expect(lastEventId).toBeTruthy()

      await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Second message while disconnected' }),
      })

      await new Promise((resolve) => setTimeout(resolve, 300))

      const secondController = new AbortController()
      const secondTimeout = setTimeout(() => secondController.abort(), 5000)
      let catchUpChunks = ''

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream?after=${lastEventId}`, {
          headers: {
            Cookie: authCookie,
            'Last-Event-ID': lastEventId,
          },
          signal: secondController.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()

        for (let i = 0; i < 30; i++) {
          const { done, value } = await reader.read()
          if (done) break
          catchUpChunks += decoder.decode(value, { stream: true })
          if (catchUpChunks.includes('Second message')) break
          await new Promise((r) => setTimeout(r, 100))
        }

        expect(catchUpChunks).toContain('Second message while disconnected')

        await closeSseReader(reader)
      } finally {
        clearTimeout(secondTimeout)
        secondController.abort()
      }
    })
  })

  describe('Correlation preservation', () => {
    it('should preserve correlationId from envelope through to outbound', async () => {
      deliveredEnvelopes = []

      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      const {
        data: {
          session: { sessionId },
        },
      } = (await createResponse.json()) as any

      const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ text: 'Correlation test' }),
      })

      const body = (await response.json()) as { data: { correlationId: string } }
      const correlationId = body.data.correlationId

      await new Promise((resolve) => setTimeout(resolve, 200))

      const webuiDelivery = deliveredEnvelopes.find((d) => d.channelId === 'webui')
      expect(webuiDelivery).toBeDefined()
      expect(webuiDelivery!.envelope.correlationId).toBe(correlationId)
    })
  })
})
