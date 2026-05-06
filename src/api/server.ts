import '../config/load-env.js';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { ApiErrorFactory } from './errors.js';
import type { HealthResponse } from './types.js';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerUsageRoutes } from './routes/usage.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerDebugRoutes } from './routes/debug.js';
import { registerInstanceRoutes } from './routes/instances.js';
import { registerChannelRoutes } from './routes/channels.js';
import { registerSkillRoutes } from './routes/skills.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerSetupRoutes } from './routes/setup.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerModelsRoutes } from './routes/models.js';
import { registerToolsRoutes } from './routes/tools.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerAuthMiddleware } from './middleware/auth.js';
import { createApiContext, type ApiContext } from './context.js';

export async function createApiServer(context?: ApiContext): Promise<FastifyInstance> {
  const server = Fastify({
    logger: true
  });

  await server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });

  if (context) {
    registerSetupRoutes(server, context);
    registerAuthRoutes(server, context);

    registerAuthMiddleware(server, {
      userStore: context.stores.userStore,
      authTokenStore: context.stores.authTokenStore,
      excludedPaths: [
        '/api/health',
        '/api/setup/status',
        '/api/setup/user',
        '/api/auth/login',
        '/api/auth/logout',
        '/api/tools',
      ],
    });

    await registerSessionsRoutes(server, context);
    registerStatusRoutes(server, context);
    registerApprovalRoutes(server, context);
    registerRunRoutes(server, context);
    registerUsageRoutes(server, context);
    registerLogRoutes(server, context);
    registerDebugRoutes(server, context);
    registerInstanceRoutes(server, context);
    registerChannelRoutes(server, context);
    registerSkillRoutes(server, context);
    registerSettingsRoutes(server, context);
    registerProviderRoutes(server, context);
    registerModelsRoutes(server, context);
    registerToolsRoutes(server, context);
    registerAgentRoutes(server, context);
    registerMemoryRoutes(server, context);
  } else {
    server.get('/api/health', async (): Promise<HealthResponse> => {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        modules: {}
      };
    });
  }

  server.addContentTypeParser('application/json', { parseAs: 'string' }, function (request, body, done) {
    try {
      const json = JSON.parse(body as string);
      request.body = json;
      done(null, json);
    } catch (err) {
      const error = new Error('Invalid JSON in request body') as Error & { statusCode?: number };
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  server.setErrorHandler(async (error: Error & { statusCode?: number }, _request: FastifyRequest, reply: FastifyReply) => {
    const errorStatusCode = error.statusCode;
    const errorMsg = error.message || String(error);
    if (errorStatusCode === 400 || errorMsg.includes('Invalid JSON') || errorMsg.includes('Unexpected token') || errorMsg.includes('JSON')) {
      const apiError = ApiErrorFactory.badRequest('Invalid JSON in request body');
      return reply.code(400).send(apiError);
    }
    const apiError = ApiErrorFactory.internalError(errorMsg || 'Unknown error');
    return reply.code(500).send(apiError);
  });

  server.setNotFoundHandler(async (request, reply) => {
    const error = ApiErrorFactory.notFound(`Route ${request.method} ${request.url} not found`);
    reply.code(404).send(error);
  });

  return server;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === decodeURI(`file://${process.argv[1]}`) ||
  process.argv[1]?.endsWith('/server.ts');

if (isMainModule) {
  const start = async () => {
    try {
      const dbPath = process.env.DATABASE_PATH || './data/agent-platform.db';
      const contextResult = createApiContext({ dbPath });
      if ('code' in contextResult) {
        console.error('Failed to create API context:', contextResult);
        process.exit(1);
      }
      const server = await createApiServer(contextResult);
      const apiPort = parseInt(process.env.PORT || '3003', 10);
      await server.listen({ port: apiPort, host: '0.0.0.0' });
      console.log(`API server listening on http://localhost:${apiPort}`);
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  };
  start();
}

export { FastifyInstance };
