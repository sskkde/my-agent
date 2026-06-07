import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createApiServer } from '../../../src/api/server.js'
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js'
import type { FastifyInstance } from 'fastify'
import type { ConsoleTimelineEvent, ProcessingStatusPayload } from '../../../src/api/types.js'

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
import type { AddressInfo } from 'node:net'

describe('Timeline SSE Route Integration', () => {
  let server: FastifyInstance
  let baseUrl: string
  let context: ApiContext
  let authCookie: string

  beforeAll(async () => {
    const ctx = createApiContext({ dbPath: ':memory:' })
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`)
    }
    context = ctx
    server = await createApiServer(context)
    await server.listen()
    const address = server.server.address() as AddressInfo | null
    baseUrl = `http://localhost:${address?.port ?? 0}`

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
    context.connection.close()
  })

  describe('SSE endpoint', () => {
    it('should return 404 for non-existent session', async () => {
      const controller = new AbortController()
      const response = await fetch(`${baseUrl}/api/v1/sessions/non-existent-session/timeline/stream`, {
        headers: { Cookie: authCookie },
        signal: controller.signal,
      })

      expect(response.status).toBe(404)
      controller.abort()
    })

    it('should open SSE stream and emit snapshot for existing session', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const body = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = body.data.session.sessionId

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain('text/event-stream')

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          if (chunks.includes('"type":"snapshot"')) break
        }

        expect(chunks).toContain('"type":"snapshot"')
        expect(chunks).toContain('data:')
        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should receive live timeline_event via broadcaster while stream is open', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const body = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = body.data.session.sessionId

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      let receivedLiveEvent = false

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''

        const readPromise = (async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks += decoder.decode(value, { stream: true })
            if (chunks.includes('live-test-event-001')) {
              receivedLiveEvent = true
              break
            }
          }
        })()

        await new Promise((resolve) => setTimeout(resolve, 100))

        const liveEvent: ConsoleTimelineEvent = {
          eventId: 'live-test-event-001',
          eventType: 'assistant_message',
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
          content: 'Live test message',
          actor: 'assistant',
        }

        context.timelineBroadcaster!.broadcast(sessionId, liveEvent)

        await Promise.race([
          readPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
        ])

        expect(receivedLiveEvent).toBe(true)
        expect(chunks).toContain('event: timeline_event')
        expect(chunks).toContain('live-test-event-001')
        expect(chunks).toContain('Live test message')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should not deliver different-session events to the stream', async () => {
      const createResponse1 = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse1.status).toBe(201)
      const body1 = (await createResponse1.json()) as { data: { session: { sessionId: string } } }
      const sessionIdA = body1.data.session.sessionId

      const createResponse2 = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse2.status).toBe(201)
      const body2 = (await createResponse2.json()) as { data: { session: { sessionId: string } } }
      const sessionIdB = body2.data.session.sessionId

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionIdA}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''

        await new Promise((resolve) => setTimeout(resolve, 100))

        const wrongSessionEvent: ConsoleTimelineEvent = {
          eventId: 'wrong-session-event',
          eventType: 'user_message',
          sessionId: sessionIdB,
          timestamp: new Date().toISOString(),
          content: 'This should not appear',
          actor: 'user',
        }

        context.timelineBroadcaster!.broadcast(sessionIdB, wrongSessionEvent)

        await new Promise((resolve) => setTimeout(resolve, 200))

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          break
        }

        expect(chunks).not.toContain('wrong-session-event')
        expect(chunks).not.toContain('This should not appear')

        const rightSessionEvent: ConsoleTimelineEvent = {
          eventId: 'right-session-event',
          eventType: 'assistant_message',
          sessionId: sessionIdA,
          timestamp: new Date().toISOString(),
          content: 'This should appear',
          actor: 'assistant',
        }

        context.timelineBroadcaster!.broadcast(sessionIdA, rightSessionEvent)

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          if (chunks.includes('right-session-event')) break
        }

        expect(chunks).toContain('right-session-event')
        expect(chunks).toContain('This should appear')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should handle Last-Event-ID header for catch-up at route level', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const body = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = body.data.session.sessionId

      const transcriptStore = context.stores.transcriptStore
      transcriptStore.saveTurn({
        turnId: 'turn-001',
        sessionId: sessionId,
        userId: 'test-user',
        input: { userMessageSummary: 'First message' },
        output: { visibleMessages: [] },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      })
      transcriptStore.saveTurn({
        turnId: 'turn-002',
        sessionId: sessionId,
        userId: 'test-user',
        input: { userMessageSummary: 'Second message' },
        output: { visibleMessages: [] },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: {
            Cookie: authCookie,
            'Last-Event-ID': 'turn-turn-001-input',
          },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          if (chunks.includes('"type":"snapshot"')) break
        }

        expect(chunks).toContain('"type":"snapshot"')
        expect(chunks).not.toContain('turn-turn-001-input')
        expect(chunks).toContain('turn-turn-002-input')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should handle ?after= query parameter for catch-up', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const body = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = body.data.session.sessionId

      const transcriptStore = context.stores.transcriptStore
      transcriptStore.saveTurn({
        turnId: 'turn-003',
        sessionId: sessionId,
        userId: 'test-user',
        input: { userMessageSummary: 'Third message' },
        output: { visibleMessages: [] },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      })
      transcriptStore.saveTurn({
        turnId: 'turn-004',
        sessionId: sessionId,
        userId: 'test-user',
        input: { userMessageSummary: 'Fourth message' },
        output: { visibleMessages: [] },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      try {
        const response = await fetch(
          `${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream?after=turn-turn-003-input`,
          { headers: { Cookie: authCookie }, signal: controller.signal },
        )

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          if (chunks.includes('"type":"snapshot"')) break
        }

        expect(chunks).toContain('"type":"snapshot"')
        expect(chunks).not.toContain('turn-turn-003-input')
        expect(chunks).toContain('turn-turn-004-input')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should prefer Last-Event-ID over ?after= when both provided', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const body = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = body.data.session.sessionId

      const transcriptStore = context.stores.transcriptStore
      transcriptStore.saveTurn({
        turnId: 'turn-005',
        sessionId: sessionId,
        userId: 'test-user',
        input: { userMessageSummary: 'Fifth message' },
        output: { visibleMessages: [] },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      })

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream?after=non-existent-id`, {
          headers: {
            Cookie: authCookie,
            'Last-Event-ID': 'turn-turn-005-input',
          },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          if (chunks.includes('"type":"snapshot"')) break
        }

        expect(chunks).toContain('"type":"snapshot"')
        expect(chunks).not.toContain('turn-turn-005-input')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should deliver processing_status via broadcaster to SSE subscribers', async () => {
      const createResponse = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse.status).toBe(201)
      const body = (await createResponse.json()) as { data: { session: { sessionId: string } } }
      const sessionId = body.data.session.sessionId

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''
        let receivedStatus = false

        const readPromise = (async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks += decoder.decode(value, { stream: true })
            if (chunks.includes('"type":"processing_status"')) {
              receivedStatus = true
              break
            }
          }
        })()

        await new Promise((resolve) => setTimeout(resolve, 100))

        const statusPayload: ProcessingStatusPayload = {
          sessionId,
          attemptId: 'test-attempt-001',
          stage: 'model_call',
          stageLabel: '模型调用',
          providerId: 'openrouter',
          model: 'anthropic/claude-3-opus',
          activeTools: [],
          timestamp: new Date().toISOString(),
        }

        context.timelineBroadcaster.broadcastProcessingStatus(sessionId, statusPayload)

        await Promise.race([
          readPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
        ])

        expect(receivedStatus).toBe(true)
        expect(chunks).toContain('"type":"processing_status"')
        expect(chunks).toContain('"providerId":"openrouter"')
        expect(chunks).toContain('"model":"anthropic/claude-3-opus"')
        expect(chunks).toContain('"stage":"model_call"')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })

    it('should not deliver processing_status for a different session', async () => {
      const createResponse1 = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse1.status).toBe(201)
      const body1 = (await createResponse1.json()) as { data: { session: { sessionId: string } } }
      const sessionIdA = body1.data.session.sessionId

      const createResponse2 = await fetch(`${baseUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({}),
      })
      expect(createResponse2.status).toBe(201)
      const body2 = (await createResponse2.json()) as { data: { session: { sessionId: string } } }
      const sessionIdB = body2.data.session.sessionId

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)

      try {
        const response = await fetch(`${baseUrl}/api/v1/sessions/${sessionIdA}/timeline/stream`, {
          headers: { Cookie: authCookie },
          signal: controller.signal,
        })

        expect(response.status).toBe(200)

        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let chunks = ''

        await new Promise((resolve) => setTimeout(resolve, 100))

        const wrongSessionStatus: ProcessingStatusPayload = {
          sessionId: sessionIdB,
          attemptId: 'wrong-attempt',
          stage: 'model_call',
          stageLabel: '模型调用',
          providerId: 'openrouter',
          model: 'test-model',
          activeTools: [],
          timestamp: new Date().toISOString(),
        }

        context.timelineBroadcaster.broadcastProcessingStatus(sessionIdB, wrongSessionStatus)

        await new Promise((resolve) => setTimeout(resolve, 200))

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks += decoder.decode(value, { stream: true })
          break
        }

        expect(chunks).not.toContain('wrong-attempt')
        expect(chunks).not.toContain('"type":"processing_status"')

        await closeSseReader(reader)
      } finally {
        clearTimeout(timeout)
        controller.abort()
      }
    })
  })
})
