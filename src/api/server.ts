import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { ApiErrorFactory } from './errors.js';
import type { HealthResponse } from './types.js';
import { registerSessionsRoutes } from './routes/sessions.js';
import { registerStatusRoutes } from './routes/status.js';
import { registerApprovalRoutes } from './routes/approvals.js';
import { registerRunRoutes } from './routes/runs.js';
import type { ApiContext } from './context.js';

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
    await registerSessionsRoutes(server, context);
    registerStatusRoutes(server, context);
    registerApprovalRoutes(server, context);
    registerRunRoutes(server, context);
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
      const error = new Error('Invalid JSON in request body');
      (error as any).statusCode = 400;
      done(error, undefined);
    }
  });

  server.setErrorHandler(async (error: Error, _request: FastifyRequest, reply: FastifyReply) => {
    const errorStatusCode = (error as any).statusCode;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const start = async () => {
    try {
      const server = await createApiServer();
      await server.listen({ port: 3000, host: '0.0.0.0' });
      console.log('API server listening on http://localhost:3000');
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  };
  start();
}

export { FastifyInstance };