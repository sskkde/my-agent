import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js'
import { ASK_STATES } from '../../../src/storage/ask-store.js'

describe('Asks API', () => {
  let ctx: AuthenticatedTestContext
  let baseUrl: string
  let authCookie: string
  let userId: string

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext()
    baseUrl = ctx.baseUrl
    authCookie = ctx.authCookie

    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: authCookie },
    })
    const meBody = (await meResponse.json()) as { data: { user: { userId: string } } }
    userId = meBody.data.user.userId
  }, 30000)

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx)
  }, 30000)

  describe('GET /api/v1/asks', () => {
    it('should return empty asks list when no asks exist for user', async () => {
      const response = await fetch(`${baseUrl}/api/v1/asks`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { asks: unknown[]; total: number } }
      expect(body.data.asks).toEqual([])
      expect(body.data.total).toBe(0)
    })

    it('should return only asks for authenticated user, earliest requested first', async () => {
      const askStore = ctx.apiContext.stores.askStore

      const askLater = askStore.create({
        id: 'ask_user_later',
        userId,
        sessionId: 'session-1',
        status: ASK_STATES.PENDING,
        question: 'Later question',
        requestedBy: 'system',
        requestedAt: new Date(Date.now() + 5000).toISOString(),
      })

      const askEarlier = askStore.create({
        id: 'ask_user_earlier',
        userId,
        sessionId: 'session-1',
        status: ASK_STATES.PENDING,
        question: 'Earlier question',
        options: [{ value: 'a', label: 'Option A' }],
        requestedBy: 'system',
        requestedAt: new Date(Date.now() - 5000).toISOString(),
      })

      const askOtherUser = askStore.create({
        id: 'ask_other_user',
        userId: 'other-user',
        sessionId: 'session-2',
        status: ASK_STATES.PENDING,
        question: 'Other user question',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/asks`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        data: { asks: Array<{ id: string; userId: string; question: string; status: string }>; total: number }
      }
      expect(body.data.total).toBe(2)
      expect(body.data.asks.map((a) => a.id)).toEqual([askEarlier.id, askLater.id])
      expect(body.data.asks[0]?.userId).toBe(userId)
      expect(body.data.asks[0]?.question).toBe('Earlier question')
      expect(body.data.asks[0]?.status).toBe(ASK_STATES.PENDING)

      askStore.delete(askLater.id)
      askStore.delete(askEarlier.id)
      askStore.delete(askOtherUser.id)
    })

    it('should filter asks by sessionId query param', async () => {
      const askStore = ctx.apiContext.stores.askStore

      const askInSession = askStore.create({
        id: 'ask_session_filter',
        userId,
        sessionId: 'session-10',
        status: ASK_STATES.PENDING,
        question: 'In session',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const askOtherSession = askStore.create({
        id: 'ask_other_session_filter',
        userId,
        sessionId: 'session-11',
        status: ASK_STATES.PENDING,
        question: 'Other session',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      const response = await fetch(`${baseUrl}/api/v1/asks?sessionId=session-10`, {
        headers: { Cookie: authCookie },
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { asks: Array<{ id: string }>; total: number } }
      expect(body.data.total).toBe(1)
      expect(body.data.asks[0]?.id).toBe(askInSession.id)

      askStore.delete(askInSession.id)
      askStore.delete(askOtherSession.id)
    })
  })

  describe('PATCH /api/v1/asks/:askId', () => {
    it('should return 404 for non-existent ask', async () => {
      const response = await fetch(`${baseUrl}/api/v1/asks/non-existent-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ answers: [{ value: 'answer' }] }),
      })
      expect(response.status).toBe(404)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('should return 400 for empty answers array', async () => {
      const response = await fetch(`${baseUrl}/api/v1/asks/test-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ answers: [] }),
      })
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('BAD_REQUEST')
    })

    it('should return 409 for already answered ask', async () => {
      const askStore = ctx.apiContext.stores.askStore

      const ask = askStore.create({
        id: 'ask_already_answered',
        userId,
        sessionId: 'session-1',
        status: ASK_STATES.ANSWERED,
        question: 'Already answered',
        answers: [{ value: 'old' }],
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        responseBy: 'admin',
      })

      const response = await fetch(`${baseUrl}/api/v1/asks/${ask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ answers: [{ value: 'new' }] }),
      })
      expect(response.status).toBe(409)

      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.code).toBe('CONFLICT')

      askStore.delete(ask.id)
    })

    it('should answer a pending ask with authenticated user and schedule the continuation turn', async () => {
      const askStore = ctx.apiContext.stores.askStore
      const eventStore = ctx.apiContext.stores.eventStore

      const ask = askStore.create({
        id: 'ask_answer_me',
        userId,
        sessionId: 'session-1',
        status: ASK_STATES.PENDING,
        question: 'Which option?',
        options: [
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' },
        ],
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      })

      expect(ctx.apiContext.scheduleAskResponseTurn).toBeDefined()

      const response = await fetch(`${baseUrl}/api/v1/asks/${ask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: authCookie },
        body: JSON.stringify({ answers: [{ value: 'a', label: 'Option A' }] }),
      })
      expect(response.status).toBe(200)

      const body = (await response.json()) as { data: { success: boolean; askId: string; status: string } }
      expect(body.data.success).toBe(true)
      expect(body.data.askId).toBe(ask.id)
      expect(body.data.status).toBe(ASK_STATES.ANSWERED)

      const updated = askStore.getById(ask.id)
      expect(updated?.status).toBe(ASK_STATES.ANSWERED)
      expect(updated?.answers).toEqual([{ value: 'a', label: 'Option A' }])
      expect(updated?.responseBy).toBe(userId)
      expect(updated?.respondedAt).toBeDefined()

      const events = eventStore.query({ eventType: 'ask_resolved' })
      const resolvedEvent = events.find((event) => {
        const payload = (event as { payload?: Record<string, unknown> }).payload ?? {}
        return payload.askId === ask.id
      })
      expect(resolvedEvent).toBeDefined()

      askStore.delete(ask.id)
    })
  })
})
