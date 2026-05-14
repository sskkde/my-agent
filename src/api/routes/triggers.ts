import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import { scheduleIdParamsSchema, webhookIdParamsSchema } from '../schemas/shared.js';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { generateId } from '../../shared/ids.js';

const WEBHOOK_ID_PREFIX = 'wh_';
const SCHEDULE_ID_PREFIX = 'sched_';

interface CreateScheduleTriggerRequest {
  name: string;
  schedulePattern: string;
  maxRuns?: number;
}

interface CreateWebhookTriggerRequest {
  name: string;
}

interface UpdateScheduleTriggerRequest {
  status?: 'active' | 'paused';
}

interface UpdateWebhookTriggerRequest {
  status?: 'active' | 'paused';
}

interface ScheduleTriggerResponse {
  scheduleId: string;
  name: string;
  schedulePattern: string;
  status: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  runCount: number;
  maxRuns?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface WebhookTriggerResponse {
  webhookId: string;
  name: string;
  status: string;
  secretLast4: string;
  createdAt: string;
  updatedAt: string;
}

interface WebhookTriggerCreatedResponse extends WebhookTriggerResponse {
  secret: string;
}

function mapScheduleTriggerToResponse(trigger: {
  scheduleId: string;
  name: string;
  schedulePattern: string;
  status: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  runCount: number;
  maxRuns?: number | null;
  createdAt: string;
  updatedAt: string;
}): ScheduleTriggerResponse {
  return {
    scheduleId: trigger.scheduleId,
    name: trigger.name,
    schedulePattern: trigger.schedulePattern,
    status: trigger.status,
    lastRunAt: trigger.lastRunAt,
    nextRunAt: trigger.nextRunAt,
    runCount: trigger.runCount,
    maxRuns: trigger.maxRuns,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
  };
}

function mapWebhookTriggerToResponse(trigger: {
  webhookId: string;
  name: string;
  status: string;
  secretLast4: string;
  createdAt: string;
  updatedAt: string;
}): WebhookTriggerResponse {
  return {
    webhookId: trigger.webhookId,
    name: trigger.name,
    status: trigger.status,
    secretLast4: trigger.secretLast4,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
  };
}

function generateWebhookSecret(): { secret: string; last4: string } {
  const secret = randomBytes(32).toString('hex');
  const last4 = secret.slice(-4);
  return { secret, last4 };
}

function verifyHmacSignature(secret: string, payload: string, signature: string): boolean {
  const expectedSignature = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

export function registerTriggerRoutes(server: FastifyInstance, context: ApiContext): void {
  const { stores } = context;
  const { scheduleTriggerStore, webhookTriggerStore, webhookDeliveryStore, eventStore } = stores;

  // POST /api/triggers/schedules
  server.post<{ Body: CreateScheduleTriggerRequest }>(
    '/api/triggers/schedules',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'schedulePattern'],
          properties: {
            name: { type: 'string', minLength: 1 },
            schedulePattern: { type: 'string', minLength: 1 },
            maxRuns: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateScheduleTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { name, schedulePattern, maxRuns } = request.body;

      const scheduleId = generateId(SCHEDULE_ID_PREFIX);
      const trigger = scheduleTriggerStore.create({
        scheduleId,
        ownerUserId: userId,
        name: name.trim(),
        schedulePattern,
        maxRuns,
      });

      return reply.code(201).send(success(mapScheduleTriggerToResponse(trigger), request.requestId));
    }
  );

  // GET /api/triggers/schedules
  server.get(
    '/api/triggers/schedules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const triggers = scheduleTriggerStore.findByOwner(userId);
      const response = triggers.map(mapScheduleTriggerToResponse);

      return reply.code(200).send(success(response, request.requestId));
    }
  );

  // GET /api/triggers/schedules/:scheduleId
  server.get<{ Params: { scheduleId: string } }>(
    '/api/triggers/schedules/:scheduleId',
    {
      schema: {
        params: scheduleIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { scheduleId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { scheduleId } = request.params;
      const trigger = scheduleTriggerStore.getById(scheduleId);

      if (!trigger || trigger.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Schedule trigger not found', request.requestId));
      }

      return reply.code(200).send(success(mapScheduleTriggerToResponse(trigger), request.requestId));
    }
  );

  // PATCH /api/triggers/schedules/:scheduleId
  server.patch<{ Params: { scheduleId: string }; Body: UpdateScheduleTriggerRequest }>(
    '/api/triggers/schedules/:scheduleId',
    {
      schema: {
        params: scheduleIdParamsSchema,
        body: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['active', 'paused'] },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { scheduleId: string }; Body: UpdateScheduleTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { scheduleId } = request.params;
      const existing = scheduleTriggerStore.getById(scheduleId);

      if (!existing || existing.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Schedule trigger not found', request.requestId));
      }

      const { status } = request.body;

      if (status) {
        const updated = scheduleTriggerStore.updateStatus(scheduleId, status);
        if (updated) {
          return reply.code(200).send(success(mapScheduleTriggerToResponse(updated), request.requestId));
        }
      }

      return reply.code(200).send(success(mapScheduleTriggerToResponse(existing), request.requestId));
    }
  );

  // DELETE /api/triggers/schedules/:scheduleId
  server.delete<{ Params: { scheduleId: string } }>(
    '/api/triggers/schedules/:scheduleId',
    {
      schema: {
        params: scheduleIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { scheduleId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { scheduleId } = request.params;
      const existing = scheduleTriggerStore.getById(scheduleId);

      if (!existing || existing.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Schedule trigger not found', request.requestId));
      }

      scheduleTriggerStore.delete(scheduleId);
      return reply.code(204).send();
    }
  );

  // POST /api/triggers/webhooks
  server.post<{ Body: CreateWebhookTriggerRequest }>(
    '/api/triggers/webhooks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Body: CreateWebhookTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { name } = request.body;

      const webhookId = generateId(WEBHOOK_ID_PREFIX);
      const { secret, last4 } = generateWebhookSecret();

      const trigger = webhookTriggerStore.create({
        webhookId,
        ownerUserId: userId,
        name: name.trim(),
        secretHash: secret,
        secretLast4: last4,
      });

      const response: WebhookTriggerCreatedResponse = {
        ...mapWebhookTriggerToResponse(trigger),
        secret,
      };

      return reply.code(201).send(success(response, request.requestId));
    }
  );

  // GET /api/triggers/webhooks
  server.get(
    '/api/triggers/webhooks',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const triggers = webhookTriggerStore.findByOwner(userId);
      const response = triggers.map(mapWebhookTriggerToResponse);

      return reply.code(200).send(success(response, request.requestId));
    }
  );

  // GET /api/triggers/webhooks/:webhookId
  server.get<{ Params: { webhookId: string } }>(
    '/api/triggers/webhooks/:webhookId',
    {
      schema: {
        params: webhookIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { webhookId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { webhookId } = request.params;
      const trigger = webhookTriggerStore.getById(webhookId);

      if (!trigger || trigger.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Webhook trigger not found', request.requestId));
      }

      return reply.code(200).send(success(mapWebhookTriggerToResponse(trigger), request.requestId));
    }
  );

  // PATCH /api/triggers/webhooks/:webhookId
  server.patch<{ Params: { webhookId: string }; Body: UpdateWebhookTriggerRequest }>(
    '/api/triggers/webhooks/:webhookId',
    {
      schema: {
        params: webhookIdParamsSchema,
        body: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['active', 'paused'] },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { webhookId: string }; Body: UpdateWebhookTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { webhookId } = request.params;
      const existing = webhookTriggerStore.getById(webhookId);

      if (!existing || existing.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Webhook trigger not found', request.requestId));
      }

      const { status } = request.body;

      if (status) {
        const updated = webhookTriggerStore.updateStatus(webhookId, status);
        if (updated) {
          return reply.code(200).send(success(mapWebhookTriggerToResponse(updated), request.requestId));
        }
      }

      return reply.code(200).send(success(mapWebhookTriggerToResponse(existing), request.requestId));
    }
  );

  // DELETE /api/triggers/webhooks/:webhookId
  server.delete<{ Params: { webhookId: string } }>(
    '/api/triggers/webhooks/:webhookId',
    {
      schema: {
        params: webhookIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { webhookId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { webhookId } = request.params;
      const existing = webhookTriggerStore.getById(webhookId);

      if (!existing || existing.ownerUserId !== userId) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Webhook trigger not found', request.requestId));
      }

      webhookTriggerStore.delete(webhookId);
      return reply.code(204).send();
    }
  );

  // POST /api/webhooks/:webhookId/deliver (no session auth, uses HMAC)
  server.post<{ Params: { webhookId: string }; Body: unknown }>(
    '/api/webhooks/:webhookId/deliver',
    {
      schema: {
        params: webhookIdParamsSchema,
      },
    },
    async (request: FastifyRequest<{ Params: { webhookId: string }; Body: unknown }>, reply: FastifyReply) => {
      const { webhookId } = request.params;
      const trigger = webhookTriggerStore.getById(webhookId);

      if (!trigger) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Webhook trigger not found', request.requestId));
      }

      if (trigger.status !== 'active') {
        return reply.code(403).send(envelopeError('FORBIDDEN', 'Webhook trigger is not active', request.requestId));
      }

      const signature = request.headers['x-hub-signature-256'] as string | undefined
        || request.headers['x-signature-256'] as string | undefined;

      if (!signature) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Missing signature header', request.requestId));
      }

      const rawBody = JSON.stringify(request.body);
      const secret = trigger.secretHash;

      if (!verifyHmacSignature(secret, rawBody, signature)) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Invalid signature', request.requestId));
      }

      const deliveryId = request.headers['x-delivery-id'] as string | undefined;
      if (deliveryId && webhookDeliveryStore.exists(webhookId, deliveryId)) {
        return reply.code(200).send(success({ status: 'duplicate', message: 'Delivery already processed' }, request.requestId));
      }

      const eventId = generateId('evt_');
      const now = new Date().toISOString();

      eventStore.append({
        eventId,
        eventType: 'webhook_received',
        sourceModule: 'trigger',
        userId: trigger.ownerUserId,
        correlationId: deliveryId ?? eventId,
        payload: {
          webhookId,
          deliveryId,
          body: request.body,
          receivedAt: now,
        },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: now,
      });

      if (deliveryId) {
        webhookDeliveryStore.create({
          deliveryId,
          webhookId,
          eventId,
          status: 'accepted',
        });
      }

      return reply.code(200).send(success({ status: 'accepted', eventId }, request.requestId));
    }
  );
}
