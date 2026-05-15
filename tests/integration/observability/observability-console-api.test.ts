import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createAuthenticatedTestContext,
  closeAuthenticatedTestContext,
  type AuthenticatedTestContext,
} from '../../helpers/auth.js';

describe('Observability Console API', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;
  let plannerRunId: string;
  let workflowRunId: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';

    ctx = await createAuthenticatedTestContext(':memory:');
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;

    const stores = ctx.apiContext.stores;
    const now = new Date().toISOString();

    plannerRunId = `pr-${Date.now()}`;
    const planId = `plan-${Date.now()}`;

    stores.planStore.createPlan({
      planId,
      userId: 'testuser',
      objective: 'Test console plan',
      status: 'in_execution',
      currentVersion: 1,
      steps: [{ stepId: 'step-1', description: 'First step', status: 'completed' }],
      createdAt: now,
      updatedAt: now,
    });

    stores.plannerRunStore.create({
      plannerRunId,
      planId,
      userId: 'testuser',
      status: 'completed',
      checkpoint: null,
      createdAt: now,
      updatedAt: now,
    });

    stores.eventStore.append({
      eventId: `evt-planner-${Date.now()}`,
      eventType: 'planner_started',
      sourceModule: 'planner',
      userId: 'testuser',
      relatedRefs: { plannerRunId, planId },
      payload: { objective: 'Test plan' },
      sensitivity: 'low',
      retentionClass: 'short',
      createdAt: now,
    });

    workflowRunId = `wfr-${Date.now()}`;
    ctx.apiContext.stores.workflowRunStore.createWorkflowRun({
      workflowRunId,
      workflowId: 'wf-template-1',
      workflowVersion: '1.0',
      ownerUserId: 'testuser',
      status: 'running',
      startedAt: now,
    });
  }, 30000);

  afterAll(async () => {
    process.env = originalEnv;
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  describe('GET /api/observability/runs', () => {
    it('should return merged list of planner and workflow runs', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { runs: Array<Record<string, unknown>> } };
      expect(body.data.runs).toBeDefined();
      expect(Array.isArray(body.data.runs)).toBe(true);
      expect(body.data.runs.length).toBeGreaterThanOrEqual(2);

      const plannerEntry = body.data.runs.find((r) => r.id === plannerRunId);
      expect(plannerEntry).toBeDefined();
      expect(plannerEntry!.type).toBe('planner_run');

      const workflowEntry = body.data.runs.find((r) => r.id === workflowRunId);
      expect(workflowEntry).toBeDefined();
      expect(workflowEntry!.type).toBe('workflow_run');
    });

    it('should sort runs by createdAt descending', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { runs: Array<{ createdAt: string }> } };
      expect(body.data.runs.length).toBeGreaterThanOrEqual(2);

      for (let i = 1; i < body.data.runs.length; i++) {
        const prevTime = new Date(body.data.runs[i - 1]!.createdAt).getTime();
        const currTime = new Date(body.data.runs[i]!.createdAt).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });

    it('should filter runs by status query param', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs?status=completed`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { runs: Array<{ status: string }> } };
      expect(body.data.runs.length).toBeGreaterThanOrEqual(1);
      for (const run of body.data.runs) {
        expect(run.status).toBe('completed');
      }
    });

    it('should return empty list for non-matching status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs?status=nonexistentstatus`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: { runs: unknown[] } };
      expect(body.data.runs).toEqual([]);
    });
  });

  describe('GET /api/observability/runs/:runId/console', () => {
    it('should return console view for planner run', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs/${plannerRunId}/console`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: Record<string, unknown> };
      expect(body.data.runId).toBe(plannerRunId);
      expect(body.data.runType).toBe('planner_run');
      expect(body.data.timeline).toBeDefined();
      expect(body.data.audit).toBeDefined();
      expect(body.data.status).toBeDefined();

      const timeline = body.data.timeline as Record<string, unknown>;
      expect(timeline.events).toBeDefined();
      expect(Array.isArray(timeline.events)).toBe(true);
      expect(timeline.startTime).toBeDefined();
      expect(timeline.status).toBeDefined();

      const statusInfo = body.data.status as Record<string, unknown>;
      expect(statusInfo.runStatus).toBe('completed');
    });

    it('should return console view for workflow run', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs/${workflowRunId}/console`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as { data: Record<string, unknown> };
      expect(body.data.runId).toBe(workflowRunId);
      expect(body.data.runType).toBe('workflow_run');
    });

    it('should return 404 for unknown runId', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs/unknown-run-id/console`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('should return 401 for unauthenticated request', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs/${plannerRunId}/console`);
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/observability/runs/:runId/replay-preview', () => {
    it('should return replay preview for planner run', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/observability/runs/${plannerRunId}/replay-preview`,
        { headers: { 'Cookie': authCookie } },
      );
      expect(response.status).toBe(200);

      const body = await response.json() as { data: Record<string, unknown> };
      expect(body.data.runId).toBe(plannerRunId);
      expect(body.data.runType).toBe('planner_run');
      expect(body.data.status).toBeDefined();
      expect(body.data.timeline).toBeDefined();
      expect(body.data.blockedActions).toBeDefined();
      expect(Array.isArray(body.data.blockedActions)).toBe(true);
      expect(body.data.warnings).toBeDefined();
      expect(Array.isArray(body.data.warnings)).toBe(true);
    });

    it('should return replay preview for workflow run', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/observability/runs/${workflowRunId}/replay-preview`,
        { headers: { 'Cookie': authCookie } },
      );
      expect(response.status).toBe(200);

      const body = await response.json() as { data: Record<string, unknown> };
      expect(body.data.runId).toBe(workflowRunId);
      expect(body.data.runType).toBe('workflow_run');
    });

    it('should return 404 for unknown runId', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/observability/runs/unknown-run/replay-preview`,
        { headers: { 'Cookie': authCookie } },
      );
      expect(response.status).toBe(404);

      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });
});
