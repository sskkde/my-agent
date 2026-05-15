import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('V1 Routes Migration', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
  }, 30000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  describe('V1 Prefix Routes', () => {
    it('GET /api/v1/health should return health status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: { status: string } };
      expect(body.ok).toBe(true);
      expect(body.data.status).toBeDefined();
    });

    it('GET /api/v1/health/ready should return readiness status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health/ready`);
      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: { status: string } };
      expect(body.ok).toBe(true);
    });

    it('GET /api/v1/sessions should return sessions list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: { items: unknown[] } };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.items)).toBe(true);
    });

    it('GET /api/v1/tools should return tools list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/tools`);
      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: { tools: unknown[] } };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.tools)).toBe(true);
    });

    it('GET /api/v1/providers should return providers list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/providers`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: unknown[] };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('GET /api/v1/models should return models list', async () => {
      const response = await fetch(`${baseUrl}/api/v1/models`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { ok: boolean; data: { providers: unknown[] } };
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.providers)).toBe(true);
    });

    it('GET /api/v1/settings should return settings', async () => {
      const response = await fetch(`${baseUrl}/api/v1/settings`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/usage should return usage stats', async () => {
      const response = await fetch(`${baseUrl}/api/v1/usage`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/logs should return logs', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/channels should return channels', async () => {
      const response = await fetch(`${baseUrl}/api/v1/channels`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/skills should return skills', async () => {
      const response = await fetch(`${baseUrl}/api/v1/skills`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/instances should return instances', async () => {
      const response = await fetch(`${baseUrl}/api/v1/instances`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/approvals should return approvals', async () => {
      const response = await fetch(`${baseUrl}/api/v1/approvals`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/runs should return runs', async () => {
      const response = await fetch(`${baseUrl}/api/v1/runs`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/memory should return memory', async () => {
      const response = await fetch(`${baseUrl}/api/v1/memory`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/setup/status should return setup status', async () => {
      const response = await fetch(`${baseUrl}/api/v1/setup/status`);
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/auth/me should return current user', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/agents/:agentId/config should return agent config', async () => {
      const response = await fetch(`${baseUrl}/api/v1/agents/foreground.default/config`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/workflows/drafts should return drafts', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/drafts`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/workflows/definitions should return definitions', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/definitions`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/workflows/runs should return workflow runs', async () => {
      const response = await fetch(`${baseUrl}/api/v1/workflows/runs`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/triggers/schedules should return schedules', async () => {
      const response = await fetch(`${baseUrl}/api/v1/triggers/schedules`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/triggers/webhooks should return webhooks', async () => {
      const response = await fetch(`${baseUrl}/api/v1/triggers/webhooks`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/connectors should return connectors', async () => {
      const response = await fetch(`${baseUrl}/api/v1/connectors`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });

    it('GET /api/v1/planner-runs/:plannerRunId/events should return 404 for non-existent run', async () => {
      const response = await fetch(`${baseUrl}/api/v1/planner-runs/nonexistent/events`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(404);
    });

    it('GET /api/v1/observability/runs should return observability runs', async () => {
      const response = await fetch(`${baseUrl}/api/v1/observability/runs`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
    });
  });

  describe('Legacy Route Redirects (301)', () => {
    it('GET /api/health should redirect 301 to /api/v1/health', async () => {
      const response = await fetch(`${baseUrl}/api/health`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/health');
    });

    it('GET /api/health/ready should redirect 301 to /api/v1/health/ready', async () => {
      const response = await fetch(`${baseUrl}/api/health/ready`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/health/ready');
    });

    it('GET /api/sessions should redirect 301 to /api/v1/sessions', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/sessions');
    });

    it('GET /api/tools should redirect 301 to /api/v1/tools', async () => {
      const response = await fetch(`${baseUrl}/api/tools`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/tools');
    });

    it('GET /api/providers should redirect 301 to /api/v1/providers', async () => {
      const response = await fetch(`${baseUrl}/api/providers`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/providers');
    });

    it('GET /api/models should redirect 301 to /api/v1/models', async () => {
      const response = await fetch(`${baseUrl}/api/models`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/models');
    });

    it('GET /api/settings should redirect 301 to /api/v1/settings', async () => {
      const response = await fetch(`${baseUrl}/api/settings`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/settings');
    });

    it('GET /api/usage should redirect 301 to /api/v1/usage', async () => {
      const response = await fetch(`${baseUrl}/api/usage`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/usage');
    });

    it('GET /api/logs should redirect 301 to /api/v1/logs', async () => {
      const response = await fetch(`${baseUrl}/api/logs`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/logs');
    });

    it('GET /api/channels should redirect 301 to /api/v1/channels', async () => {
      const response = await fetch(`${baseUrl}/api/channels`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/channels');
    });

    it('GET /api/skills should redirect 301 to /api/v1/skills', async () => {
      const response = await fetch(`${baseUrl}/api/skills`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/skills');
    });

    it('GET /api/instances should redirect 301 to /api/v1/instances', async () => {
      const response = await fetch(`${baseUrl}/api/instances`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/instances');
    });

    it('GET /api/approvals should redirect 301 to /api/v1/approvals', async () => {
      const response = await fetch(`${baseUrl}/api/approvals`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/approvals');
    });

    it('GET /api/runs should redirect 301 to /api/v1/runs', async () => {
      const response = await fetch(`${baseUrl}/api/runs`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/runs');
    });

    it('GET /api/memory should redirect 301 to /api/v1/memory', async () => {
      const response = await fetch(`${baseUrl}/api/memory`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/memory');
    });

    it('GET /api/setup/status should redirect 301 to /api/v1/setup/status', async () => {
      const response = await fetch(`${baseUrl}/api/setup/status`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/setup/status');
    });

    it('GET /api/debug/events should redirect 301 to /api/v1/debug/events', async () => {
      const response = await fetch(`${baseUrl}/api/debug/events`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/debug/events');
    });

    it('GET /api/workflows/drafts should redirect 301 to /api/v1/workflows/drafts', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/drafts`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/workflows/drafts');
    });

    it('GET /api/workflows/definitions should redirect 301 to /api/v1/workflows/definitions', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/definitions`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/workflows/definitions');
    });

    it('GET /api/workflows/runs should redirect 301 to /api/v1/workflows/runs', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/runs`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/workflows/runs');
    });

    it('GET /api/triggers/schedules should redirect 301 to /api/v1/triggers/schedules', async () => {
      const response = await fetch(`${baseUrl}/api/triggers/schedules`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/triggers/schedules');
    });

    it('GET /api/triggers/webhooks should redirect 301 to /api/v1/triggers/webhooks', async () => {
      const response = await fetch(`${baseUrl}/api/triggers/webhooks`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/triggers/webhooks');
    });

    it('GET /api/connectors should redirect 301 to /api/v1/connectors', async () => {
      const response = await fetch(`${baseUrl}/api/connectors`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/connectors');
    });

    it('GET /api/planner-runs should redirect 301 to /api/v1/planner-runs', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/planner-runs');
    });

    it('GET /api/observability/runs should redirect 301 to /api/v1/observability/runs', async () => {
      const response = await fetch(`${baseUrl}/api/observability/runs`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/observability/runs');
    });

    it('GET /api/sessions/:sessionId should redirect 301 with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/test-session-123`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/sessions/test-session-123');
    });

    it('GET /api/agents/:agentId/config should redirect 301 with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/agents/foreground.default/config`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/agents/foreground.default/config');
    });

    it('GET /api/providers/:providerId should redirect 301 with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/providers/test-provider`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/providers/test-provider');
    });

    it('GET /api/workflows/drafts/:draftId should redirect 301 with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/drafts/draft-123`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/workflows/drafts/draft-123');
    });

    it('GET /api/triggers/schedules/:scheduleId should redirect 301 with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/triggers/schedules/schedule-123`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/triggers/schedules/schedule-123');
    });

    it('GET /api/connectors/:connectorId should redirect 301 with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/connectors/connector-123`, { redirect: 'manual' });
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('/api/v1/connectors/connector-123');
    });
  });
});
