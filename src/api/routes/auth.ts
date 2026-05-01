import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
import type { AuthSuccessResponse, UserMetadata, LoginRequest } from '../types.js';
import { verifyPassword, generateSessionToken, hashToken } from '../../storage/auth-crypto.js';
import { setSessionCookie, clearSessionCookie, getSessionTokenFromRequest } from '../middleware/auth.js';

const SESSION_TTL_HOURS = 24;

export function registerAuthRoutes(server: FastifyInstance, context: ApiContext): void {
  const userStore = context.stores.userStore;
  const authTokenStore = context.stores.authTokenStore;

  server.post<{ Body: LoginRequest; Reply: { data: AuthSuccessResponse } }>(
    '/api/auth/login',
    async (request: FastifyRequest<{ Body: LoginRequest }>, reply: FastifyReply) => {
      const { username, password } = request.body || {};

      if (!username || typeof username !== 'string') {
        const error = ApiErrorFactory.badRequest('Username is required');
        return reply.code(400).send(error);
      }

      if (!password || typeof password !== 'string') {
        const error = ApiErrorFactory.badRequest('Password is required');
        return reply.code(400).send(error);
      }

      const user = userStore.getByUsername(username.trim());
      if (!user) {
        const error = ApiErrorFactory.unauthorized('Invalid username or password');
        return reply.code(401).send(error);
      }

      const isPasswordValid = await verifyPassword(password, user.passwordHash);
      if (!isPasswordValid) {
        const error = ApiErrorFactory.unauthorized('Invalid username or password');
        return reply.code(401).send(error);
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

      return reply.code(200).send({ data: response });
    }
  );

  server.post(
    '/api/auth/logout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = getSessionTokenFromRequest(request);

      if (token) {
        const tokenHash = hashToken(token);
        authTokenStore.revoke(tokenHash);
      }

      clearSessionCookie(reply);

      return reply.code(200).send({ data: { success: true } });
    }
  );

  server.get<{ Reply: { data: { user: UserMetadata } } }>(
    '/api/auth/me',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user) {
        const error = ApiErrorFactory.unauthorized('Not authenticated');
        return reply.code(401).send(error);
      }

      const user = userStore.getById(request.user.userId);
      if (!user) {
        const error = ApiErrorFactory.unauthorized('User not found');
        return reply.code(401).send(error);
      }

      const response = {
        user: {
          userId: user.userId,
          username: user.username,
          createdAt: user.createdAt,
        },
      };

      return reply.code(200).send({ data: response });
    }
  );
}
