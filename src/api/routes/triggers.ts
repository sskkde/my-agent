import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
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

  // POST /api/triggers/schedules - Create a schedule trigger
  server.post<{ Body: CreateScheduleTriggerRequest }>(
    '/api/triggers/schedules',
    async (request: FastifyRequest<{ Body: CreateScheduleTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { name, schedulePattern, maxRuns } = request.body || {};

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        const error = ApiErrorFactory.badRequest('name is required and must be a non-empty string');
        return reply.code(400).send(error);
      }

      if (!schedulePattern || typeof schedulePattern !== 'string') {
        const error = ApiErrorFactory.badRequest('schedulePattern is required');
        return reply.code(400).send(error);
      }

      const scheduleId = generateId(SCHEDULE_ID_PREFIX);
      const trigger = scheduleTriggerStore.create({
        scheduleId,
        ownerUserId: userId,
        name: name.trim(),
        schedulePattern,
        maxRuns,
      });

      return reply.code(201).send({ data: mapScheduleTriggerToResponse(trigger) });
    }
  );

  // GET /api/triggers/schedules - List schedule triggers for current user
  server.get(
    '/api/triggers/schedules',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const triggers = scheduleTriggerStore.findByOwner(userId);
      const response = triggers.map(mapScheduleTriggerToResponse);

      return reply.code(200).send({ data: response });
    }
  );

  // GET /api/triggers/schedules/:scheduleId - Get a specific schedule trigger
  server.get<{ Params: { scheduleId: string } }>(
    '/api/triggers/schedules/:scheduleId',
    async (request: FastifyRequest<{ Params: { scheduleId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { scheduleId } = request.params;
      const trigger = scheduleTriggerStore.getById(scheduleId);

      if (!trigger || trigger.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Schedule trigger not found');
        return reply.code(404).send(error);
      }

      return reply.code(200).send({ data: mapScheduleTriggerToResponse(trigger) });
    }
  );

  // PATCH /api/triggers/schedules/:scheduleId - Update a schedule trigger
  server.patch<{ Params: { scheduleId: string }; Body: UpdateScheduleTriggerRequest }>(
    '/api/triggers/schedules/:scheduleId',
    async (request: FastifyRequest<{ Params: { scheduleId: string }; Body: UpdateScheduleTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { scheduleId } = request.params;
      const existing = scheduleTriggerStore.getById(scheduleId);

      if (!existing || existing.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Schedule trigger not found');
        return reply.code(404).send(error);
      }

      const { status } = request.body || {};

      if (status !== undefined && !['active', 'paused'].includes(status)) {
        const error = ApiErrorFactory.badRequest('status must be "active" or "paused"');
        return reply.code(400).send(error);
      }

      if (status) {
        const updated = scheduleTriggerStore.updateStatus(scheduleId, status);
        if (updated) {
          return reply.code(200).send({ data: mapScheduleTriggerToResponse(updated) });
        }
      }

      return reply.code(200).send({ data: mapScheduleTriggerToResponse(existing) });
    }
  );

  // DELETE /api/triggers/schedules/:scheduleId - Delete a schedule trigger
  server.delete<{ Params: { scheduleId: string } }>(
    '/api/triggers/schedules/:scheduleId',
    async (request: FastifyRequest<{ Params: { scheduleId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { scheduleId } = request.params;
      const existing = scheduleTriggerStore.getById(scheduleId);

      if (!existing || existing.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Schedule trigger not found');
        return reply.code(404).send(error);
      }

      scheduleTriggerStore.delete(scheduleId);
      return reply.code(204).send();
    }
  );

  // POST /api/triggers/webhooks - Create a webhook trigger
  server.post<{ Body: CreateWebhookTriggerRequest }>(
    '/api/triggers/webhooks',
    async (request: FastifyRequest<{ Body: CreateWebhookTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { name } = request.body || {};

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        const error = ApiErrorFactory.badRequest('name is required and must be a non-empty string');
        return reply.code(400).send(error);
      }

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

      return reply.code(201).send({ data: response });
    }
  );

  // GET /api/triggers/webhooks - List webhook triggers for current user
  server.get(
    '/api/triggers/webhooks',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const triggers = webhookTriggerStore.findByOwner(userId);
      const response = triggers.map(mapWebhookTriggerToResponse);

      return reply.code(200).send({ data: response });
    }
  );

  // GET /api/triggers/webhooks/:webhookId - Get a specific webhook trigger
  server.get<{ Params: { webhookId: string } }>(
    '/api/triggers/webhooks/:webhookId',
    async (request: FastifyRequest<{ Params: { webhookId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { webhookId } = request.params;
      const trigger = webhookTriggerStore.getById(webhookId);

      if (!trigger || trigger.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Webhook trigger not found');
        return reply.code(404).send(error);
      }

      return reply.code(200).send({ data: mapWebhookTriggerToResponse(trigger) });
    }
  );

  // PATCH /api/triggers/webhooks/:webhookId - Update a webhook trigger
  server.patch<{ Params: { webhookId: string }; Body: UpdateWebhookTriggerRequest }>(
    '/api/triggers/webhooks/:webhookId',
    async (request: FastifyRequest<{ Params: { webhookId: string }; Body: UpdateWebhookTriggerRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { webhookId } = request.params;
      const existing = webhookTriggerStore.getById(webhookId);

      if (!existing || existing.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Webhook trigger not found');
        return reply.code(404).send(error);
      }

      const { status } = request.body || {};

      if (status !== undefined && !['active', 'paused'].includes(status)) {
        const error = ApiErrorFactory.badRequest('status must be "active" or "paused"');
        return reply.code(400).send(error);
      }

      if (status) {
        const updated = webhookTriggerStore.updateStatus(webhookId, status);
        if (updated) {
          return reply.code(200).send({ data: mapWebhookTriggerToResponse(updated) });
        }
      }

      return reply.code(200).send({ data: mapWebhookTriggerToResponse(existing) });
    }
  );

  // DELETE /api/triggers/webhooks/:webhookId - Delete a webhook trigger
  server.delete<{ Params: { webhookId: string } }>(
    '/api/triggers/webhooks/:webhookId',
    async (request: FastifyRequest<{ Params: { webhookId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { webhookId } = request.params;
      const existing = webhookTriggerStore.getById(webhookId);

      if (!existing || existing.ownerUserId !== userId) {
        const error = ApiErrorFactory.notFound('Webhook trigger not found');
        return reply.code(404).send(error);
      }

      webhookTriggerStore.delete(webhookId);
      return reply.code(204).send();
    }
  );

  // POST /api/webhooks/:webhookId/deliver - Receive webhook delivery (no session auth, uses HMAC)
  server.post<{ Params: { webhookId: string }; Body: unknown }>(
    '/api/webhooks/:webhookId/deliver',
    async (request: FastifyRequest<{ Params: { webhookId: string }; Body: unknown }>, reply: FastifyReply) => {
      const { webhookId } = request.params;
      const trigger = webhookTriggerStore.getById(webhookId);

      if (!trigger) {
        const error = ApiErrorFactory.notFound('Webhook trigger not found');
        return reply.code(404).send(error);
      }

      if (trigger.status !== 'active') {
        const error = ApiErrorFactory.forbidden('Webhook trigger is not active');
        return reply.code(403).send(error);
      }

      const signature = request.headers['x-hub-signature-256'] as string | undefined
        || request.headers['x-signature-256'] as string | undefined;

      if (!signature) {
        const error = ApiErrorFactory.unauthorized('Missing signature header');
        return reply.code(401).send(error);
      }

      const rawBody = JSON.stringify(request.body);
      const secret = trigger.secretHash;

      if (!verifyHmacSignature(secret, rawBody, signature)) {
        const error = ApiErrorFactory.unauthorized('Invalid signature');
        return reply.code(401).send(error);
      }

      const deliveryId = request.headers['x-delivery-id'] as string | undefined;
      if (deliveryId && webhookDeliveryStore.exists(webhookId, deliveryId)) {
        return reply.code(200).send({ data: { status: 'duplicate', message: 'Delivery already processed' } });
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

      return reply.code(200).send({ data: { status: 'accepted', eventId } });
    }
  );
}
