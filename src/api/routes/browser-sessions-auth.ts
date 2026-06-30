import type { FastifyRequest, FastifyReply } from 'fastify'
import { envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import type { Session } from '../../storage/session-store.js'
import type { SessionStore } from '../../storage/session-store.js'
import { toBrowserSessionId } from '../../search/browser/browser-session-manager.js'
import type { BrowserSessionManager } from '../../search/browser/browser-session-manager.js'
import { mapOwnershipToState } from './browser-sessions-helpers.js'
import type { BrowserStatusResponse, BrowserSessionState } from './browser-sessions-types.js'

/**
 * Check if the user can access the session. Mirrors the pattern in
 * `sessions.ts` and `todos.ts`: local mode (no user) or session owner or
 * admin.
 */
export function canAccessSession(request: FastifyRequest, session: Session): boolean {
  const userId = request.user?.userId
  const role = request.user?.role
  return !userId || session.userId === userId || role === 'admin'
}

export function sendSessionAccessDenied(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply.code(403).send(envelopeError('FORBIDDEN', 'Access denied to this session', request.requestId))
}

/**
 * Resolve the authenticated user id for lease attribution. In local mode
 * (no authenticated user) a synthetic local id is used so the lease machinery
 * still works.
 */
export function resolveUserId(request: FastifyRequest): string {
  return request.user?.userId ?? 'local-user'
}

/**
 * Build a `BrowserStatusResponse` from the manager's current state. When no
 * browser session exists, returns an idle status with null url/viewport.
 */
export function buildStatusResponse(
  sessionId: string,
  manager: BrowserSessionManager,
): BrowserStatusResponse {
  const meta = manager.getSession(toBrowserSessionId(sessionId))
  if (!meta) {
    return {
      sessionId,
      state: 'idle',
      url: null,
      lastActivityAt: null,
      viewport: null,
    }
  }
  return {
    sessionId,
    state: mapOwnershipToState(meta.ownership),
    url: meta.url,
    lastActivityAt: meta.lastActivityAt,
    viewport: meta.viewport,
  }
}

/**
 * Map the manager's current ownership state to the API session state, with
 * a fallback for missing sessions.
 */
export function resolveSessionState(
  manager: BrowserSessionManager,
  sessionId: string,
  fallback: BrowserSessionState,
): BrowserSessionState {
  const meta = manager.getSession(toBrowserSessionId(sessionId))
  return meta ? mapOwnershipToState(meta.ownership) : fallback
}

/**
 * Shared session ownership guard. Loads the persisted session, returns 404 if
 * missing, 403 if the caller cannot access it. Returns the persisted session
 * on success, or `null` if the reply was already sent.
 */
export async function loadAndAuthorizeSession(
  request: FastifyRequest,
  reply: FastifyReply,
  sessionStore: SessionStore,
  sessionId: string,
): Promise<Session | null> {
  if (!request.requirePermission(ResourceType.sessions, Action.read)) {
    return null
  }

  const persistedSession = sessionStore.getById(sessionId)
  if (!persistedSession) {
    reply.code(404).send(envelopeError('NOT_FOUND', 'Session not found', request.requestId))
    return null
  }

  if (!canAccessSession(request, persistedSession)) {
    sendSessionAccessDenied(request, reply)
    return null
  }

  return persistedSession
}