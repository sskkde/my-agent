import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import { OAuthService } from '../../connectors/oauth/oauth-service.js';
import { OAuthCallbackHandler } from '../../connectors/oauth/oauth-callback.js';
import { OAuthRefreshManager } from '../../connectors/oauth/oauth-refresh.js';
import type { OAuthProviderConfig } from '../../connectors/oauth/oauth-types.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';
import type { ConnectorStatus } from '../../storage/connector-store.js';

function getOAuthConfig(type: string): OAuthProviderConfig | undefined {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  const baseUrl = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3003';

  const configs: Record<string, OAuthProviderConfig> = {
    calendar: {
      providerId: 'google',
      clientId,
      clientSecret,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/calendar'],
      redirectUri: `${baseUrl}/api/v1/connectors/calendar/oauth/callback`,
    },
    contacts: {
      providerId: 'google',
      clientId,
      clientSecret,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/contacts'],
      redirectUri: `${baseUrl}/api/v1/connectors/contacts/oauth/callback`,
    },
    docs: {
      providerId: 'google',
      clientId,
      clientSecret,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/documents'],
      redirectUri: `${baseUrl}/api/v1/connectors/docs/oauth/callback`,
    },
  };

  return configs[type];
}

const SUPPORTED_TYPES = ['calendar', 'contacts', 'docs'];

const CONNECTOR_DEFINITION_MAP: Record<string, string> = {
  calendar: 'google_calendar',
  contacts: 'google_contacts',
  docs: 'google_docs',
};

export function registerOAuthRoutes(server: FastifyInstance, context: ApiContext): void {
  const oauthService = new OAuthService();
  const callbackHandler = new OAuthCallbackHandler(oauthService, oauthService.getStateManager());
  const refreshManager = new OAuthRefreshManager(oauthService);
  const { connectorStore } = context.stores;

  server.addHook('onClose', () => {
    oauthService.destroy();
  });

  server.get<{ Params: { type: string } }>(
    '/api/v1/connectors/:type/oauth/authorize',
    async (request: FastifyRequest<{ Params: { type: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.connectors, Action.read)) {
        return reply;
      }
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { type } = request.params;
      const config = getOAuthConfig(type);
      if (!config) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', `Unsupported connector type: ${type}. Supported: ${SUPPORTED_TYPES.join(', ')}`, request.requestId));
      }

      if (!config.clientId || !config.clientSecret) {
        return reply.code(503).send(envelopeError('SERVICE_UNAVAILABLE', 'OAuth not configured: missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET', request.requestId));
      }

      const authRequest = oauthService.generateAuthorizationUrl(config, userId);
      return reply.code(200).send(success({
        authorizeUrl: authRequest.authorizeUrl,
        stateId: authRequest.stateId,
        codeVerifier: authRequest.codeVerifier,
        expiresAt: authRequest.expiresAt,
      }, request.requestId));
    }
  );

  server.post<{ Params: { type: string } }>(
    '/api/v1/connectors/:type/oauth/callback',
    async (request: FastifyRequest<{ Params: { type: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.connectors, Action.create)) {
        return reply;
      }
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { type } = request.params;
      const config = getOAuthConfig(type);
      if (!config) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', `Unsupported connector type: ${type}`, request.requestId));
      }

      const body = request.body as { code?: string; state?: string; codeVerifier?: string };
      if (!body.code || !body.state || !body.codeVerifier) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Missing required fields: code, state, codeVerifier', request.requestId));
      }

      const result = await callbackHandler.handleCallback(config, body.code, body.state, body.codeVerifier);
      if (!result.success) {
        return reply.code(400).send(envelopeError('OAUTH_ERROR', result.error, request.requestId));
      }

      try {
        const definitionId = CONNECTOR_DEFINITION_MAP[type];
        if (!definitionId) {
          return reply.code(400).send(envelopeError('BAD_REQUEST', `No connector definition mapping for type: ${type}`, request.requestId));
        }

        let definition = connectorStore.findDefinitionByConnectorId(definitionId);
        if (!definition) {
          definition = connectorStore.createDefinition({
            connectorId: definitionId,
            name: `Google ${type.charAt(0).toUpperCase() + type.slice(1)}`,
            connectorType: 'api',
            version: '1.0.0',
            description: `Google ${type} OAuth connector`,
            capabilities: ['oauth2'],
            status: 'active',
          });
        }

        const instanceId = crypto.randomUUID();
        const instance = connectorStore.createInstance({
          connectorInstanceId: instanceId,
          connectorDefinitionId: definition.id,
          userId,
          name: `${type}-${instanceId.slice(0, 8)}`,
          authStateRef: result.encryptedAuthState,
          config: {},
          status: 'active' as ConnectorStatus,
        });

        return reply.code(200).send(success({
          instanceId: instance.id,
          connectorType: type,
          providerId: result.providerId,
        }, request.requestId));
      } catch (error) {
        return reply.code(500).send(envelopeError('STORE_ERROR', `Failed to create connector instance: ${error instanceof Error ? error.message : 'Unknown error'}`, request.requestId));
      }
    }
  );

  server.post<{ Params: { instanceId: string } }>(
    '/api/v1/connectors/:instanceId/oauth/revoke',
    async (request: FastifyRequest<{ Params: { instanceId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.connectors, Action.delete)) {
        return reply;
      }

      const { instanceId } = request.params;
      const instance = connectorStore.findInstanceById(instanceId);
      if (!instance) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Connector instance not found', request.requestId));
      }

      const definition = connectorStore.findDefinitionById(instance.connectorDefinitionId);
      if (!definition) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Connector definition not found', request.requestId));
      }

      const typeMap: Record<string, string> = {
        google_calendar: 'calendar',
        google_contacts: 'contacts',
        google_docs: 'docs',
      };
      const oauthType = typeMap[definition.connectorId];
      const config = oauthType ? getOAuthConfig(oauthType) : undefined;

      if (!config || !instance.authStateRef) {
        return reply.code(400).send(envelopeError('BAD_REQUEST', 'Instance does not support OAuth revocation', request.requestId));
      }

      const revokeResult = await refreshManager.revokeToken(config, instance.authStateRef);
      if (!revokeResult.success) {
        return reply.code(500).send(envelopeError('REVOKE_FAILED', revokeResult.error ?? 'Token revocation failed', request.requestId));
      }

      return reply.code(200).send(success({ revoked: true, instanceId }, request.requestId));
    }
  );
}
