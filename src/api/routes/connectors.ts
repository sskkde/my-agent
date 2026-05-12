import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import type { ConnectorType } from '../../storage/connector-store.js';

const ALL_CONNECTOR_TYPES: ConnectorType[] = ['api', 'messaging', 'storage', 'database', 'custom'];

interface UpdateInstanceConfigRequest {
  config?: Record<string, unknown>;
}

export function registerConnectorRoutes(server: FastifyInstance, context: ApiContext): void {
  const { connectorStore } = context.stores;

  // GET /api/connectors — list all connector definitions
  server.get(
    '/api/connectors',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user?.userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const definitions = ALL_CONNECTOR_TYPES.flatMap(type =>
        connectorStore.findDefinitionsByType(type)
      );

      return reply.code(200).send(success(definitions, request.requestId));
    }
  );

  // GET /api/connectors/:id — get connector definition detail
  server.get<{ Params: { id: string } }>(
    '/api/connectors/:id',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!request.user?.userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { id } = request.params;
      const definition = connectorStore.findDefinitionById(id);

      if (!definition) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Connector definition not found', request.requestId));
      }

      return reply.code(200).send(success(definition, request.requestId));
    }
  );

  // GET /api/connectors/:id/instances — list instances for a connector
  server.get<{ Params: { id: string } }>(
    '/api/connectors/:id/instances',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { id } = request.params;

      const definition = connectorStore.findDefinitionById(id);
      if (!definition) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Connector definition not found', request.requestId));
      }

      const instances = connectorStore.findInstancesByUserAndConnector(userId, id);

      return reply.code(200).send(success(instances, request.requestId));
    }
  );

  // PATCH /api/connectors/:id/instances/:iid/config — update instance config
  server.patch<{ Params: { id: string; iid: string }; Body: UpdateInstanceConfigRequest }>(
    '/api/connectors/:id/instances/:iid/config',
    async (request: FastifyRequest<{ Params: { id: string; iid: string }; Body: UpdateInstanceConfigRequest }>, reply: FastifyReply) => {
      if (!request.user?.userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { iid } = request.params;
      const body = request.body || {};

      const instance = connectorStore.findInstanceById(iid);
      if (!instance) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Connector instance not found', request.requestId));
      }

      const updated = connectorStore.updateInstance(iid, {
        config: body.config,
      });

      if (!updated) {
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', 'Failed to update instance config', request.requestId));
      }

      return reply.code(200).send(success(updated, request.requestId));
    }
  );
}
