import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { toBrowserSessionId } from '../../search/browser/browser-session-manager.js'
import {
  mapRouteInputToEvent,
  dispatchInputToPage,
  writeFrameSseStream,
  BrowserInputParseError,
} from './browser-sessions-helpers.js'
import {
  loadAndAuthorizeSession,
  resolveUserId,
  buildStatusResponse,
  resolveSessionState,
} from './browser-sessions-auth.js'
import type {
  BrowserStatusResponse,
  BrowserTakeoverResponse,
  BrowserInputResponse,
} from './browser-sessions-types.js'

interface BrowserSessionParams {
  sessionId: string
}

interface BrowserInputBody {
  action: string
  payload: Record<string, unknown>
}

export async function registerBrowserSessionRoutes(
  server: FastifyInstance,
  context: ApiContext,
): Promise<void> {
  const sessionStore = context.stores.sessionStore
  const browserSessionManager = context.browserSessionManager
  const browserFrameStream = context.browserFrameStream

  // ===========================================================================
  // GET /api/v1/sessions/:sessionId/browser/status
  // ===========================================================================
  server.get<{ Params: BrowserSessionParams }>(
    '/api/v1/sessions/:sessionId/browser/status',
    async (request: FastifyRequest<{ Params: BrowserSessionParams }>, reply: FastifyReply) => {
      const { sessionId } = request.params

      const persisted = await loadAndAuthorizeSession(request, reply, sessionStore, sessionId)
      if (!persisted) return

      if (!browserSessionManager) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Browser sessions not configured', request.requestId))
      }

      const response = buildStatusResponse(sessionId, browserSessionManager)
      return reply.code(200).send(success(response, request.requestId))
    },
  )

  // ===========================================================================
  // GET /api/v1/sessions/:sessionId/browser/frame/stream (SSE)
  // ===========================================================================
  server.get<{ Params: BrowserSessionParams }>(
    '/api/v1/sessions/:sessionId/browser/frame/stream',
    async (request: FastifyRequest<{ Params: BrowserSessionParams }>, reply: FastifyReply) => {
      const { sessionId } = request.params

      const persisted = await loadAndAuthorizeSession(request, reply, sessionStore, sessionId)
      if (!persisted) return

      if (!browserSessionManager || !browserFrameStream) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Browser sessions not configured', request.requestId))
      }

      const bsId = toBrowserSessionId(sessionId)
      writeFrameSseStream(reply, request, bsId, browserSessionManager, browserFrameStream)
    },
  )

  // ===========================================================================
  // POST /api/v1/sessions/:sessionId/browser/takeover
  // ===========================================================================
  server.post<{ Params: BrowserSessionParams }>(
    '/api/v1/sessions/:sessionId/browser/takeover',
    async (request: FastifyRequest<{ Params: BrowserSessionParams }>, reply: FastifyReply) => {
      const { sessionId } = request.params

      const persisted = await loadAndAuthorizeSession(request, reply, sessionStore, sessionId)
      if (!persisted) return

      if (!browserSessionManager) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Browser sessions not configured', request.requestId))
      }

      const bsId = toBrowserSessionId(sessionId)
      const previousState = resolveSessionState(browserSessionManager, sessionId, 'idle')
      const userId = resolveUserId(request)
      const result = await browserSessionManager.requestTakeover(bsId, userId)

      if (!result.success) {
        if (result.error === 'SESSION_NOT_FOUND') {
          return reply
            .code(404)
            .send(envelopeError('NOT_FOUND', 'Browser session not found', request.requestId))
        }
        if (result.error === 'LEASE_CONFLICT') {
          return reply
            .code(409)
            .send(envelopeError('LEASE_CONFLICT', 'Another user already holds the takeover lease', request.requestId))
        }
        return reply
          .code(409)
          .send(envelopeError('TAKEOVER_FAILED', result.error ?? 'Takeover failed', request.requestId))
      }

      const state = resolveSessionState(browserSessionManager, sessionId, 'user_controlled')
      const response: BrowserTakeoverResponse = { sessionId, state, previousState }
      return reply.code(200).send(success(response, request.requestId))
    },
  )

  // ===========================================================================
  // POST /api/v1/sessions/:sessionId/browser/input
  // ===========================================================================
  server.post<{ Params: BrowserSessionParams; Body: BrowserInputBody }>(
    '/api/v1/sessions/:sessionId/browser/input',
    async (
      request: FastifyRequest<{ Params: BrowserSessionParams; Body: BrowserInputBody }>,
      reply: FastifyReply,
    ) => {
      const { sessionId } = request.params

      const persisted = await loadAndAuthorizeSession(request, reply, sessionStore, sessionId)
      if (!persisted) return

      if (!browserSessionManager) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Browser sessions not configured', request.requestId))
      }

      const body = request.body
      if (!body || typeof body.action !== 'string' || typeof body.payload !== 'object' || body.payload === null) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'Body must contain "action" (string) and "payload" (object)', request.requestId))
      }

      const bsId = toBrowserSessionId(sessionId)
      const userId = resolveUserId(request)

      // Verify lease before dispatching input.
      const auth = await browserSessionManager.sendInput(bsId, userId)
      if (!auth.authorized) {
        return reply
          .code(403)
          .send(envelopeError('FORBIDDEN', 'No active takeover lease for this session', request.requestId))
      }

      // Parse the route input into a domain event at the boundary.
      let inputEvent
      try {
        inputEvent = mapRouteInputToEvent(body.action, body.payload)
      } catch (err) {
        if (err instanceof BrowserInputParseError) {
          return reply
            .code(400)
            .send(envelopeError('INVALID_INPUT', err.message, request.requestId))
        }
        throw err
      }

      // Dispatch to the live page.
      const page = browserSessionManager.getPage(bsId)
      if (!page) {
        return reply
          .code(404)
          .send(envelopeError('NOT_FOUND', 'No live browser page for this session', request.requestId))
      }

      try {
        await dispatchInputToPage(page, inputEvent)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Input dispatch failed'
        return reply
          .code(500)
          .send(envelopeError('INPUT_DISPATCH_FAILED', message, request.requestId))
      }

      const response: BrowserInputResponse = { success: true }
      return reply.code(200).send(success(response, request.requestId))
    },
  )

  // ===========================================================================
  // POST /api/v1/sessions/:sessionId/browser/release
  // ===========================================================================
  server.post<{ Params: BrowserSessionParams }>(
    '/api/v1/sessions/:sessionId/browser/release',
    async (request: FastifyRequest<{ Params: BrowserSessionParams }>, reply: FastifyReply) => {
      const { sessionId } = request.params

      const persisted = await loadAndAuthorizeSession(request, reply, sessionStore, sessionId)
      if (!persisted) return

      if (!browserSessionManager) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Browser sessions not configured', request.requestId))
      }

      const bsId = toBrowserSessionId(sessionId)
      const previousState = resolveSessionState(browserSessionManager, sessionId, 'idle')
      const userId = resolveUserId(request)
      const result = await browserSessionManager.releaseTakeover(bsId, userId)

      if (!result.success) {
        if (result.error === 'SESSION_NOT_FOUND') {
          return reply
            .code(404)
            .send(envelopeError('NOT_FOUND', 'Browser session not found', request.requestId))
        }
        if (result.error === 'NO_ACTIVE_LEASE' || result.error === 'NOT_LEASE_HOLDER') {
          return reply
            .code(403)
            .send(envelopeError('FORBIDDEN', 'You are not the current lease holder', request.requestId))
        }
        return reply
          .code(409)
          .send(envelopeError('RELEASE_FAILED', result.error ?? 'Release failed', request.requestId))
      }

      const state = resolveSessionState(browserSessionManager, sessionId, 'agent_controlled')
      const response: BrowserTakeoverResponse = { sessionId, state, previousState }
      return reply.code(200).send(success(response, request.requestId))
    },
  )

  // ===========================================================================
  // POST /api/v1/sessions/:sessionId/browser/agent-request-takeover
  //
  // Called by the agent/tool (not the user) to signal that human help is
  // needed. Transitions the session to `handoff_requested` WITHOUT creating a
  // lease, so a human user can subsequently call /takeover to acquire the
  // lease. Returns the current status with the `handoff_requested` state so
  // the frontend can render the handoff banner.
  // ===========================================================================
  server.post<{ Params: BrowserSessionParams }>(
    '/api/v1/sessions/:sessionId/browser/agent-request-takeover',
    async (request: FastifyRequest<{ Params: BrowserSessionParams }>, reply: FastifyReply) => {
      const { sessionId } = request.params

      const persisted = await loadAndAuthorizeSession(request, reply, sessionStore, sessionId)
      if (!persisted) return

      if (!browserSessionManager) {
        return reply
          .code(503)
          .send(envelopeError('SERVICE_UNAVAILABLE', 'Browser sessions not configured', request.requestId))
      }

      const bsId = toBrowserSessionId(sessionId)
      const handoff = browserSessionManager.requestHandoff(bsId)
      if (!handoff.success) {
        if (handoff.error === 'SESSION_NOT_FOUND') {
          return reply
            .code(404)
            .send(envelopeError('NOT_FOUND', 'Browser session not found', request.requestId))
        }
        return reply
          .code(409)
          .send(envelopeError('HANDOFF_FAILED', handoff.error ?? 'Handoff failed', request.requestId))
      }

      const response: BrowserStatusResponse = buildStatusResponse(sessionId, browserSessionManager)
      return reply.code(200).send(success(response, request.requestId))
    },
  )
}