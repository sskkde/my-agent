import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Planner Run Timeline / Summary API', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;
  let plannerRunId: string;
  let planId: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';

    ctx = await createAuthenticatedTestContext(':memory:');
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;

    const stores = ctx.apiContext.stores;
    const now = new Date().toISOString();
    const userId = 'testuser';

    planId = `plan-${Date.now()}`;
    plannerRunId = `run-${Date.now()}`;

    stores.planStore.createPlan({
      planId,
      userId,
      objective: 'Test plan for timeline',
      status: 'in_execution',
      currentVersion: 2,
      steps: [
        { stepId: 'step-1', description: 'First step', status: 'completed' },
        { stepId: 'step-2', description: 'Second step', status: 'in_progress' },
        { stepId: 'step-3', description: 'Third step', status: 'pending' },
      ],
      createdAt: now,
      updatedAt: now,
    });

    stores.plannerRunStore.create({
      plannerRunId,
      planId,
      userId,
      status: 'planning',
      checkpoint: null,
      createdAt: now,
      updatedAt: now,
    });

    stores.eventStore.append([
      {
        eventId: `evt-${Date.now()}-1`,
        eventType: 'planner_run_started',
        sourceModule: 'planner',
        userId,
        relatedRefs: { plannerRunId, planId },
        payload: { objective: 'Test plan', initiation: 'manual' },
        sensitivity: 'low',
        retentionClass: 'short',
        createdAt: new Date(Date.now() - 2000).toISOString(),
      },
      {
        eventId: `evt-${Date.now()}-2`,
        eventType: 'plan_step_started',
        sourceModule: 'planner',
        userId,
        relatedRefs: { plannerRunId, planId },
        payload: {
          stepId: 'step-2',
          apiKey: 'sk-sensitive-key-12345',
          config: { secret: 'my-secret-value', token: 'bearer-token-abc' },
          nested: { password: 'p@ssw0rd', normal: 'visible' },
          items: [{ key: 'item-key', name: 'visible-name' }],
        },
        sensitivity: 'high',
        retentionClass: 'standard',
        createdAt: new Date(Date.now() - 1000).toISOString(),
      },
      {
        eventId: `evt-${Date.now()}-3`,
        eventType: 'plan_step_completed',
        sourceModule: 'planner',
        userId,
        relatedRefs: { plannerRunId, planId },
        payload: { stepId: 'step-1', result: 'success' },
        sensitivity: 'low',
        retentionClass: 'short',
        createdAt: new Date().toISOString(),
      },
    ]);
  }, 30000);

  afterAll(async () => {
    process.env = originalEnv;
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  describe('GET /api/planner-runs/:plannerRunId/events', () => {
    it('should return events sorted by timestamp for valid plannerRunId', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs/${plannerRunId}/events`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { events: Array<Record<string, unknown>> };
      expect(body.events).toBeDefined();
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.events.length).toBe(3);

      const timestamps = body.events.map((e: Record<string, unknown>) => e.createdAt as string);
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]! >= timestamps[i - 1]!).toBe(true);
      }
    });

    it('should redact sensitive fields in event payloads', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs/${plannerRunId}/events`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { events: Array<{ payload: Record<string, unknown> }> };
      const sensitiveEvent = body.events[1];
      expect(sensitiveEvent).toBeDefined();

      const payload = sensitiveEvent!.payload;
      expect(payload.apiKey).toBe('[REDACTED]');
      expect((payload.config as Record<string, unknown>).secret).toBe('[REDACTED]');
      expect((payload.config as Record<string, unknown>).token).toBe('[REDACTED]');
      expect(((payload.nested as Record<string, unknown>)).password).toBe('[REDACTED]');
      expect((payload.nested as Record<string, unknown>).normal).toBe('visible');

      const items = payload.items as Array<Record<string, unknown>>;
      expect(items[0]!.key).toBe('[REDACTED]');
      expect(items[0]!.name).toBe('visible-name');
    });

    it('should return 404 for non-existent plannerRunId', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs/nonexistent-run/events`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs/${plannerRunId}/events`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/planner-runs/:plannerRunId/summary', () => {
    it('should return status, stepCount, currentStep, and planVersion', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs/${plannerRunId}/summary`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        status: string;
        stepCount: number;
        currentStep: string | null;
        planVersion: number;
      };

      expect(body.status).toBe('planning');
      expect(body.stepCount).toBe(3);
      expect(body.currentStep).toBe('step-2');
      expect(body.planVersion).toBe(2);
    });

    it('should return 404 for non-existent plannerRunId', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs/nonexistent-run/summary`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs/${plannerRunId}/summary`);
      expect(response.status).toBe(401);
    });

    it('should return null currentStep when no in_progress or completed steps', async () => {
      const stores = ctx.apiContext.stores;
      const emptyPlanId = `plan-${Date.now()}-empty`;
      const emptyRunId = `run-${Date.now()}-empty`;
      const now = new Date().toISOString();

      stores.planStore.createPlan({
        planId: emptyPlanId,
        userId: 'testuser',
        objective: 'Empty plan',
        status: 'draft',
        currentVersion: 1,
        steps: [],
        createdAt: now,
        updatedAt: now,
      });

      stores.plannerRunStore.create({
        plannerRunId: emptyRunId,
        planId: emptyPlanId,
        userId: 'testuser',
        status: 'initializing',
        checkpoint: null,
        createdAt: now,
        updatedAt: now,
      });

      const response = await fetch(`${baseUrl}/api/planner-runs/${emptyRunId}/summary`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { currentStep: string | null; stepCount: number; planVersion: number };
      expect(body.currentStep).toBeNull();
      expect(body.stepCount).toBe(0);
      expect(body.planVersion).toBe(1);
    });
  });
});
