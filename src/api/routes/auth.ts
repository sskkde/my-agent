import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import type { AuthSuccessResponse, LoginRequest } from '../types.js';
import { verifyPassword, generateSessionToken, hashToken } from '../../storage/auth-crypto.js';
import { setSessionCookie, clearSessionCookie, getSessionTokenFromRequest } from '../middleware/auth.js';

const SESSION_TTL_HOURS = 24;

export function registerAuthRoutes(server: FastifyInstance, context: ApiContext): void {
  const userStore = context.stores.userStore;
  const authTokenStore = context.stores.authTokenStore;

  server.post<{ Body: LoginRequest }>(
    '/api/v1/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: LoginRequest }>, reply: FastifyReply) => {
      const { username, password } = request.body;

      const user = userStore.getByUsername(username.trim());
      if (!user) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Invalid username or password', request.requestId));
      }

      const isPasswordValid = await verifyPassword(password, user.passwordHash);
      if (!isPasswordValid) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Invalid username or password', request.requestId));
      }

      const sessionToken = generateSessionToken();
      const tokenHash = hashToken(sessionToken);
      const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

      authTokenStore.create({
        tokenHash,
        userId: user.userId,
        expiresAt,
      });

      setSessionCookie(reply, sessionToken);

      const response: AuthSuccessResponse = {
        user: {
          userId: user.userId,
          username: user.username,
          createdAt: user.createdAt,
        },
      };

      return reply.code(200).send(success(response, request.requestId));
    }
  );

  server.post(
    '/api/v1/auth/logout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = getSessionTokenFromRequest(request);

      if (token) {
        const tokenHash = hashToken(token);
        authTokenStore.revoke(tokenHash);
      }

      clearSessionCookie(reply);

      return reply.code(200).send(success({ success: true }, request.requestId));
    }
  );

  server.get(
    '/api/v1/auth/me',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Not authenticated', request.requestId));
      }

      const user = userStore.getById(request.user.userId);
      if (!user) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'User not found', request.requestId));
      }

      const response = {
        user: {
          userId: user.userId,
          username: user.username,
          createdAt: user.createdAt,
        },
      };

      return reply.code(200).send(success(response, request.requestId));
    }
  );
}
