import '../config/load-env.js';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { envelopeError } from './response-envelope.js';
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
import { registerWorkflowRoutes } from './routes/workflows.js';
import { registerToolResultsRoutes } from './routes/tool-results.js';
import { registerTriggerRoutes } from './routes/triggers.js';
import { registerConnectorRoutes } from './routes/connectors.js';
import { registerPlannerRunRoutes } from './routes/planner-runs.js';
import { registerObservabilityRoutes } from './routes/observability.js';
import { registerApiKeyRoutes } from './routes/api-keys.js';
import { registerApiKeyAuth } from './middleware/api-key-auth.js';
import { registerAuthMiddleware } from './middleware/auth.js';
import { registerAuthToken } from './middleware/auth-token.js';
import { registerRequestIdMiddleware } from './middleware/request-id.js';
import { registerRateLimitMiddleware } from './middleware/rate-limit.js';
import { registerRbacMiddleware } from './middleware/rbac.js';
import { registerSecurityHeaders } from './middleware/security-headers.js';
import { getCorsOrigin } from './middleware/cors-production.js';
import { createApiContext, type ApiContext } from './context.js';
import { createLegacyRedirect, ROUTE_MAP } from './v1-prefix.js';
import { checkProductionConfig } from '../config/production-guard.js';

export async function createApiServer(context?: ApiContext): Promise<FastifyInstance> {
  const server = Fastify({
    logger: true
  });

  await server.register(cors, getCorsOrigin());

  await server.register(compress, { global: true, threshold: 0 });

  await registerSecurityHeaders(server);

  // Register Swagger/OpenAPI documentation
  await server.register(swagger, {
    openapi: {
      info: {
        title: 'Agent Platform API',
        description: 'Agent Platform Product Experience API - A multi-agent platform for task orchestration and execution with LLM providers, background task processing, workflows, triggers, and connectors.',
        version: '0.7.0-rc.1',
      },
      servers: [
        { url: 'http://localhost:3003', description: 'Development' },
        { url: 'http://localhost:3103', description: 'E2E Testing' },
      ],
      components: {
        securitySchemes: {
          cookieSession: {
            type: 'apiKey',
            in: 'cookie',
            name: 'agent-platform-session',
            description: 'Session cookie set after login',
          },
        },
      },
    },
  });

  await server.register(swaggerUi, {
    routePrefix: '/api/v1/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  registerRequestIdMiddleware(server);

  if (context) {
    await registerRateLimitMiddleware(server);
    registerSetupRoutes(server, context);
    registerAuthRoutes(server, context);

    registerAuthMiddleware(server, {
      userStore: context.stores.userStore,
      authTokenStore: context.stores.authTokenStore,
      excludedPaths: [
        '/api/health',
        '/api/health/ready',
        '/api/docs',
        '/api/docs/json',
        '/api/setup/status',
        '/api/setup/user',
        '/api/auth/login',
        '/api/auth/logout',
        '/api/tools',
        '/api/webhooks/*',
        '/api/metrics',
        '/api/v1/health',
        '/api/v1/health/ready',
        '/api/v1/docs',
        '/api/v1/docs/json',
        '/api/v1/setup/status',
        '/api/v1/setup/user',
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/tools',
        '/api/v1/webhooks/*',
        '/api/v1/metrics',
      ],
    });

    await registerAuthToken(server, { token: process.env.API_AUTH_TOKEN });

    registerApiKeyAuth(server, context.stores.apiKeyStore);

    // Register RBAC middleware after auth and api-key-auth
    await registerRbacMiddleware(server);

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
    registerWorkflowRoutes(server, context);
    registerToolResultsRoutes(server, context);
    registerTriggerRoutes(server, context);
    registerConnectorRoutes(server, context);
    registerPlannerRunRoutes(server, context);
    registerObservabilityRoutes(server, context);
    registerApiKeyRoutes(server, context);

    // Register legacy 301 redirects for all old /api/ paths → /api/v1/
    for (const [legacyPath, v1Path] of Object.entries(ROUTE_MAP)) {
      server.route(createLegacyRedirect(legacyPath, v1Path, 'GET'));
      // Also register POST/PATCH/PUT/DELETE redirects for routes that use those methods
      if (legacyPath.includes('/sessions') && !legacyPath.includes(':sessionId/messages') && !legacyPath.includes(':sessionId/resume') && !legacyPath.includes(':sessionId/model')) {
        // Skip - POST/PATCH handled by the GET redirect matching
      }
    }

    // Additional legacy redirects for non-GET methods
    // Sessions
    server.route(createLegacyRedirect('/api/sessions', '/api/v1/sessions', 'POST'));
    server.route(createLegacyRedirect('/api/sessions/:sessionId', '/api/v1/sessions/:sessionId', 'PATCH'));
    server.route(createLegacyRedirect('/api/sessions/:sessionId/messages', '/api/v1/sessions/:sessionId/messages', 'POST'));
    server.route(createLegacyRedirect('/api/sessions/:sessionId/resume', '/api/v1/sessions/:sessionId/resume', 'POST'));
    server.route(createLegacyRedirect('/api/sessions/:sessionId/model', '/api/v1/sessions/:sessionId/model', 'PATCH'));
    // Approvals
    server.route(createLegacyRedirect('/api/approvals/:approvalId', '/api/v1/approvals/:approvalId', 'PATCH'));
    // Setup
    server.route(createLegacyRedirect('/api/setup/user', '/api/v1/setup/user', 'POST'));
    // Auth
    server.route(createLegacyRedirect('/api/auth/login', '/api/v1/auth/login', 'POST'));
    server.route(createLegacyRedirect('/api/auth/logout', '/api/v1/auth/logout', 'POST'));
    // Providers
    server.route(createLegacyRedirect('/api/providers', '/api/v1/providers', 'POST'));
    server.route(createLegacyRedirect('/api/providers/:providerId', '/api/v1/providers/:providerId', 'PATCH'));
    server.route(createLegacyRedirect('/api/providers/:providerId', '/api/v1/providers/:providerId', 'DELETE'));
    server.route(createLegacyRedirect('/api/providers/:providerId/test', '/api/v1/providers/:providerId/test', 'POST'));
    // Agents
    server.route(createLegacyRedirect('/api/agents/:agentId/config/global', '/api/v1/agents/:agentId/config/global', 'PATCH'));
    server.route(createLegacyRedirect('/api/agents/:agentId/config/override', '/api/v1/agents/:agentId/config/override', 'PATCH'));
    server.route(createLegacyRedirect('/api/agents/:agentId/config/override', '/api/v1/agents/:agentId/config/override', 'DELETE'));
    // Memory
    server.route(createLegacyRedirect('/api/memory', '/api/v1/memory', 'POST'));
    server.route(createLegacyRedirect('/api/memory/:memoryId', '/api/v1/memory/:memoryId', 'DELETE'));
    // Workflows
    server.route(createLegacyRedirect('/api/workflows/drafts', '/api/v1/workflows/drafts', 'POST'));
    server.route(createLegacyRedirect('/api/workflows/drafts/:draftId', '/api/v1/workflows/drafts/:draftId', 'PATCH'));
    server.route(createLegacyRedirect('/api/workflows/drafts/:draftId/validate', '/api/v1/workflows/drafts/:draftId/validate', 'POST'));
    server.route(createLegacyRedirect('/api/workflows/drafts/:draftId/publish', '/api/v1/workflows/drafts/:draftId/publish', 'POST'));
    server.route(createLegacyRedirect('/api/workflows/drafts/:draftId', '/api/v1/workflows/drafts/:draftId', 'DELETE'));
    server.route(createLegacyRedirect('/api/workflows/runs', '/api/v1/workflows/runs', 'POST'));
    server.route(createLegacyRedirect('/api/workflows/runs/:workflowRunId', '/api/v1/workflows/runs/:workflowRunId', 'PATCH'));
    // Triggers
    server.route(createLegacyRedirect('/api/triggers/schedules', '/api/v1/triggers/schedules', 'POST'));
    server.route(createLegacyRedirect('/api/triggers/schedules/:scheduleId', '/api/v1/triggers/schedules/:scheduleId', 'PATCH'));
    server.route(createLegacyRedirect('/api/triggers/schedules/:scheduleId', '/api/v1/triggers/schedules/:scheduleId', 'DELETE'));
    server.route(createLegacyRedirect('/api/triggers/webhooks', '/api/v1/triggers/webhooks', 'POST'));
    server.route(createLegacyRedirect('/api/triggers/webhooks/:webhookId', '/api/v1/triggers/webhooks/:webhookId', 'PATCH'));
    server.route(createLegacyRedirect('/api/triggers/webhooks/:webhookId', '/api/v1/triggers/webhooks/:webhookId', 'DELETE'));
    server.route(createLegacyRedirect('/api/webhooks/:webhookId/deliver', '/api/v1/webhooks/:webhookId/deliver', 'POST'));
    // Connectors
    server.route(createLegacyRedirect('/api/connectors/:id/instances', '/api/v1/connectors/:id/instances', 'POST'));
    server.route(createLegacyRedirect('/api/connectors/:id/instances/:iid/config', '/api/v1/connectors/:id/instances/:iid/config', 'PATCH'));
    // Debug
    server.route(createLegacyRedirect('/api/debug/replay/:sessionId', '/api/v1/debug/replay/:sessionId', 'POST'));
    // Logs stream
    server.route(createLegacyRedirect('/api/logs/stream', '/api/v1/logs/stream', 'GET'));
    // Usage
    server.route(createLegacyRedirect('/api/sessions/:sessionId/usage', '/api/v1/sessions/:sessionId/usage', 'GET'));
    // Planner runs
    server.route(createLegacyRedirect('/api/planner-runs/:plannerRunId/events', '/api/v1/planner-runs/:plannerRunId/events', 'GET'));
    server.route(createLegacyRedirect('/api/planner-runs/:plannerRunId/summary', '/api/v1/planner-runs/:plannerRunId/summary', 'GET'));
    // Observability
    server.route(createLegacyRedirect('/api/observability/runs/:runId/console', '/api/v1/observability/runs/:runId/console', 'GET'));
    server.route(createLegacyRedirect('/api/observability/runs/:runId/replay-preview', '/api/v1/observability/runs/:runId/replay-preview', 'POST'));
    // Tags
    server.route(createLegacyRedirect('/api/tags', '/api/v1/tags', 'GET'));
    // Runs stream
    server.route(createLegacyRedirect('/api/runs/stream', '/api/v1/runs/stream', 'GET'));
    // API Keys (GET already registered via ROUTE_MAP)
    server.route(createLegacyRedirect('/api/api-keys', '/api/v1/api-keys', 'POST'));
    server.route(createLegacyRedirect('/api/api-keys/:id', '/api/v1/api-keys/:id', 'DELETE'));
  } else {
    server.get('/api/v1/health', async (): Promise<HealthResponse> => {
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

  server.setErrorHandler(async (error: Error & { statusCode?: number; validation?: Array<{ message: string }> }, request: FastifyRequest, reply: FastifyReply) => {
    const errorStatusCode = error.statusCode;
    const errorMsg = error.message || String(error);
    if (errorStatusCode === 429) {
      return reply.code(429).send(envelopeError('RATE_LIMIT_EXCEEDED', errorMsg, request.requestId));
    }
    if (error.validation && error.validation.length > 0) {
      const messages = error.validation.map(e => e.message).join('; ');
      return reply.code(400).send(envelopeError('VALIDATION_ERROR', messages, request.requestId));
    }
    if (errorStatusCode === 400 || errorMsg.includes('Invalid JSON') || errorMsg.includes('Unexpected token') || errorMsg.includes('JSON')) {
      return reply.code(400).send(envelopeError('BAD_REQUEST', 'Invalid JSON in request body', request.requestId));
    }
    return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMsg || 'Unknown error', request.requestId));
  });

  server.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send(envelopeError('NOT_FOUND', `Route ${request.method} ${request.url} not found`, request.requestId));
  });

  return server;
}

const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === decodeURI(`file://${process.argv[1]}`) ||
  process.argv[1]?.endsWith('/server.ts');

if (isMainModule) {
  const start = async () => {
    try {
      const productionGuard = checkProductionConfig();
      if (!productionGuard.ok) {
        console.error('Production configuration check FAILED:');
        for (const err of productionGuard.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }

      const dbPath = process.env.DATABASE_PATH || './data/agent-platform.db';
      const contextResult = createApiContext({ dbPath });
      if ('code' in contextResult) {
        console.error('Failed to create API context:', contextResult);
        process.exit(1);
      }
      const server = await createApiServer(contextResult);
      const { port, host } = resolveListenOptions();
      await server.listen({ port, host });
      console.log(`API server listening on http://${host}:${port}`);
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  };
  start();
}

/**
 * Resolve API listen options from environment.
 * - Default port: 3003
 * - Default host: localhost (always, regardless of NODE_ENV)
 * - HOST env var explicitly overrides the default host.
 *   Production public ingress requires explicit HOST=0.0.0.0.
 * - PORT must be a valid integer in Node.js listen range (0-65535).
 *   Port 0 is allowed for dynamic port assignment (used by tests).
 */
export function resolveListenOptions(env: Record<string, string | undefined> = process.env): { port: number; host: string } {
  const portStr = env.PORT ?? '3003';

  // Strict validation: only pure decimal digit strings are accepted.
  // This rejects empty strings, partial numerics (123abc), decimals (3003.5),
  // negatives (-1), and non-numeric values (abc).
  if (!/^\d+$/.test(portStr)) {
    throw new Error(`Invalid PORT "${portStr}": must be an integer between 0 and 65535`);
  }

  const port = Number(portStr);
  if (port < 0 || port > 65535) {
    throw new Error(`Invalid PORT "${portStr}": must be an integer between 0 and 65535`);
  }
  
  // Default host is always localhost; production public ingress requires explicit HOST=0.0.0.0
  const host = env.HOST ?? 'localhost';
  return { port, host };
}

export { FastifyInstance };
