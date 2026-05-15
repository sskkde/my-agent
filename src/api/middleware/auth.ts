import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AuthTokenStore } from '../../storage/auth-token-store.js';
import type { UserStore } from '../../storage/user-store.js';
import type { UserRole } from '../../storage/user-store.js';
import { hashToken } from '../../storage/auth-crypto.js';
import { ApiErrorFactory } from '../errors.js';

const SESSION_COOKIE_NAME = 'agent-platform-session';

export interface AuthenticatedUser {
  userId: string;
  username: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

interface AuthMiddlewareOptions {
  userStore: UserStore;
  authTokenStore: AuthTokenStore;
  excludedPaths: string[];
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=');
    if (name && rest.length > 0) {
      cookies[name] = rest.join('=');
    }
  }

  return cookies;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const maxAge = 24 * 60 * 60;
  reply.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

export function getSessionTokenFromRequest(request: FastifyRequest): string | null {
  const cookies = parseCookies(request.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export async function authenticateRequest(
  request: FastifyRequest,
  userStore: UserStore,
  authTokenStore: AuthTokenStore
): Promise<AuthenticatedUser | null> {
  const token = getSessionTokenFromRequest(request);
  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const authToken = authTokenStore.findByHash(tokenHash);

  if (!authToken) {
    return null;
  }

  if (authToken.revokedAt) {
    return null;
  }

  const now = new Date().toISOString();
  if (authToken.expiresAt < now) {
    return null;
  }

  const user = userStore.getById(authToken.userId);
  if (!user) {
    return null;
  }

  return {
    userId: user.userId,
    username: user.username,
    role: user.role,
  };
}

function isPathExcluded(path: string, excludedPaths: string[]): boolean {
  return excludedPaths.some(excludedPath => {
    if (excludedPath.endsWith('*')) {
      return path.startsWith(excludedPath.slice(0, -1));
    }
    return path === excludedPath;
  });
}

export function registerAuthMiddleware(
  server: FastifyInstance,
  options: AuthMiddlewareOptions
): void {
  server.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isPathExcluded(request.url, options.excludedPaths)) {
      return;
    }

    // Skip session auth for API key auth (Bearer ak_* tokens)
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ak_')) {
      return;
    }

    const user = await authenticateRequest(request, options.userStore, options.authTokenStore);

    if (!user) {
      const error = ApiErrorFactory.unauthorized('Invalid or expired session');
      return reply.code(401).send(error);
    }

    request.user = user;
  });
}
