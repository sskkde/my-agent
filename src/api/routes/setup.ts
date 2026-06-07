import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import type { SetupStatusResponse, AuthSuccessResponse, CreateUserRequest } from '../types.js'
import { hashPassword, generateSessionToken, hashToken } from '../../storage/auth-crypto.js'
import { setSessionCookie } from '../middleware/auth.js'
import { randomUUID } from 'crypto'
import { ResourceType, Action } from '../../permissions/rbac-types.js'

const SESSION_TTL_HOURS = 24
const LOCAL_USER_ID = 'local-user'

async function migrateLocalUserSessions(
  context: ApiContext,
  newUserId: string,
): Promise<{ sessionsMigrated: number; transcriptsMigrated: number; eventsMigrated: number }> {
  const sessionStore = context.stores.sessionStore
  const transcriptStore = context.stores.transcriptStore
  const eventStore = context.stores.eventStore

  let sessionsMigrated = 0
  let transcriptsMigrated = 0
  let eventsMigrated = 0

  try {
    const localSessions = sessionStore.list({ userId: LOCAL_USER_ID })

    for (const session of localSessions) {
      const sessionUpdated = sessionStore.updateUserId(session.sessionId, newUserId)
      if (sessionUpdated) {
        sessionsMigrated++
      }

      const transcriptCount = transcriptStore.updateUserIdForSession(session.sessionId, newUserId)
      transcriptsMigrated += transcriptCount

      const eventCount = eventStore.updateUserIdForSession(session.sessionId, newUserId)
      eventsMigrated += eventCount
    }

    if (sessionsMigrated > 0) {
      console.warn(`[Setup] Migrated ${sessionsMigrated} sessions from '${LOCAL_USER_ID}' to '${newUserId}'`)
      console.warn(`[Setup] Migrated ${transcriptsMigrated} transcripts from '${LOCAL_USER_ID}' to '${newUserId}'`)
      console.warn(`[Setup] Migrated ${eventsMigrated} events from '${LOCAL_USER_ID}' to '${newUserId}'`)
    }
  } catch (error) {
    console.warn('[Setup] Session migration failed:', error)
  }

  return { sessionsMigrated, transcriptsMigrated, eventsMigrated }
}

export function registerSetupRoutes(server: FastifyInstance, context: ApiContext): void {
  const userStore = context.stores.userStore
  const authTokenStore = context.stores.authTokenStore

  server.get('/api/v1/setup/status', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.users, Action.read)) {
      return reply
    }
    const users = userStore.list()
    const needsSetup = users.length === 0

    const response: SetupStatusResponse = { needsSetup }
    return reply.code(200).send(success(response, request.requestId))
  })

  server.post<{ Body: CreateUserRequest }>(
    '/api/v1/setup/user',
    async (request: FastifyRequest<{ Body: CreateUserRequest }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.users, Action.create)) {
        return reply
      }
      const users = userStore.list()
      if (users.length > 0) {
        return reply.code(409).send(envelopeError('CONFLICT', 'Setup has already been completed', request.requestId))
      }

      const { username, password } = request.body || {}

      if (!username || typeof username !== 'string' || username.trim().length === 0) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'Username is required and cannot be empty', request.requestId))
      }

      if (!password || typeof password !== 'string' || password.length === 0) {
        return reply
          .code(400)
          .send(envelopeError('BAD_REQUEST', 'Password is required and cannot be empty', request.requestId))
      }

      const trimmedUsername = username.trim()
      const existingUser = userStore.getByUsername(trimmedUsername)
      if (existingUser) {
        return reply.code(409).send(envelopeError('CONFLICT', 'Username already exists', request.requestId))
      }

      const passwordHash = await hashPassword(password)
      const userId = randomUUID()

      const user = userStore.create({
        userId,
        username: trimmedUsername,
        passwordHash,
      })

      await migrateLocalUserSessions(context, user.userId)

      const sessionToken = generateSessionToken()
      const tokenHash = hashToken(sessionToken)
      const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString()

      authTokenStore.create({
        tokenHash,
        userId: user.userId,
        expiresAt,
      })

      setSessionCookie(reply, sessionToken)

      const response: AuthSuccessResponse = {
        user: {
          userId: user.userId,
          username: user.username,
          role: user.role,
          createdAt: user.createdAt,
        },
      }

      return reply.code(201).send(success(response, request.requestId))
    },
  )
}
