import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import type { EventRecord } from '../../storage/event-store.js';
import { success, envelopeError } from '../response-envelope.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

const SENSITIVE_KEY_PATTERNS = /^(apiKey|secret|password|token|key)$/i;

function redactSensitiveFields(obj: unknown, parentKey?: string): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveFields(item));
  }

  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERNS.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitiveFields(value, key);
      }
    }
    if (parentKey && SENSITIVE_KEY_PATTERNS.test(parentKey)) {
      return '[REDACTED]';
    }
    return result;
  }

  if (typeof obj === 'string' && parentKey && SENSITIVE_KEY_PATTERNS.test(parentKey)) {
    return '[REDACTED]';
  }

  return obj;
}

function deriveCurrentStep(steps: Array<{ stepId: string; status: string }>): string | null {
  const inProgress = steps.find(s => s.status === 'in_progress');
  if (inProgress) return inProgress.stepId;

  const completed = [...steps].reverse().find(s => s.status === 'completed');
  if (completed) return completed.stepId;

  return null;
}

export function registerPlannerRunRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get<{ Params: { plannerRunId: string } }>(
    '/api/v1/planner-runs/:plannerRunId/events',
    async (request: FastifyRequest<{ Params: { plannerRunId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission('run' as ResourceType, Action.read)) {
        return reply;
      }
      const { plannerRunId } = request.params;

      const run = context.stores.plannerRunStore.getById(plannerRunId);
      if (!run) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Planner run not found', request.requestId));
      }

      const events = context.stores.eventStore.query({ plannerRunId });

      const redactedEvents: EventRecord[] = events.map(event => ({
        ...event,
        payload: redactSensitiveFields(event.payload) as Record<string, unknown>,
      }));

      return reply.code(200).send(success({ events: redactedEvents }, request.requestId));
    }
  );

  server.get<{ Params: { plannerRunId: string } }>(
    '/api/v1/planner-runs/:plannerRunId/summary',
    async (request: FastifyRequest<{ Params: { plannerRunId: string } }>, reply: FastifyReply) => {
      if (!request.requirePermission('run' as ResourceType, Action.read)) {
        return reply;
      }
      const { plannerRunId } = request.params;

      const run = context.stores.plannerRunStore.getById(plannerRunId);
      if (!run) {
        return reply.code(404).send(envelopeError('NOT_FOUND', 'Planner run not found', request.requestId));
      }

      const plan = context.stores.planStore.getPlan(run.planId);
      const stepCount = plan?.steps?.length ?? 0;
      const currentStep = plan ? deriveCurrentStep(plan.steps) : null;
      const planVersion = plan?.currentVersion ?? 1;

      return reply.code(200).send(success({
        status: run.status,
        stepCount,
        currentStep,
        planVersion,
      }, request.requestId));
    }
  );
}
