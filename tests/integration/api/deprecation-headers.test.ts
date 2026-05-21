import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';

describe('Legacy Route Deprecation Headers', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
  }, 60000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 60000);

  describe('Deprecation Headers on Legacy Routes', () => {
    it('GET /api/health should include Deprecation header', async () => {
      const response = await fetch(`${baseUrl}/api/health`, { redirect: 'manual' });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
    });

    it('GET /api/health should include Link header with successor-version', async () => {
      const response = await fetch(`${baseUrl}/api/health`, { redirect: 'manual' });
      expect(response.status).toBe(307);
      const linkHeader = response.headers.get('Link');
      expect(linkHeader).toBe('</api/v1/health>; rel="successor-version"');
    });

    it('GET /api/sessions should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/sessions`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/sessions>; rel="successor-version"');
    });

    it('GET /api/tools should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/tools`, { redirect: 'manual' });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/tools>; rel="successor-version"');
    });

    it('GET /api/providers should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/providers`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/providers>; rel="successor-version"');
    });

    it('GET /api/models should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/models`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/models>; rel="successor-version"');
    });

    it('GET /api/settings should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/settings`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/settings>; rel="successor-version"');
    });

    it('GET /api/usage should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/usage`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/usage>; rel="successor-version"');
    });

    it('GET /api/logs should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/logs`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/logs>; rel="successor-version"');
    });

    it('GET /api/channels should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/channels`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/channels>; rel="successor-version"');
    });

    it('GET /api/skills should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/skills`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/skills>; rel="successor-version"');
    });

    it('GET /api/instances should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/instances`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/instances>; rel="successor-version"');
    });

    it('GET /api/approvals should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/approvals`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/approvals>; rel="successor-version"');
    });

    it('GET /api/runs should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/runs`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/runs>; rel="successor-version"');
    });

    it('GET /api/memory should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/memory`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/memory>; rel="successor-version"');
    });

    it('GET /api/setup/status should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/setup/status`, { redirect: 'manual' });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/setup/status>; rel="successor-version"');
    });

    it('GET /api/debug/events should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/debug/events`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/debug/events>; rel="successor-version"');
    });

    it('GET /api/workflows/drafts should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/drafts`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/workflows/drafts>; rel="successor-version"');
    });

    it('GET /api/workflows/definitions should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/definitions`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/workflows/definitions>; rel="successor-version"');
    });

    it('GET /api/workflows/runs should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/runs`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/workflows/runs>; rel="successor-version"');
    });

    it('GET /api/triggers/schedules should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/triggers/schedules`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/triggers/schedules>; rel="successor-version"');
    });

    it('GET /api/triggers/webhooks should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/triggers/webhooks`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/triggers/webhooks>; rel="successor-version"');
    });

    it('GET /api/connectors should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/connectors`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/connectors>; rel="successor-version"');
    });

    it('GET /api/planner-runs should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/planner-runs`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/planner-runs>; rel="successor-version"');
    });

    it('GET /api/observability/runs should include deprecation headers', async () => {
      const response = await fetch(`${baseUrl}/api/observability/runs`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/observability/runs>; rel="successor-version"');
    });
  });

  describe('Deprecation Headers with Parameter Substitution', () => {
    it('GET /api/sessions/:sessionId should include correct Link header with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/test-session-123`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/sessions/test-session-123>; rel="successor-version"');
    });

    it('GET /api/agents/:agentId/config should include correct Link header with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/agents/foreground.default/config`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/agents/foreground.default/config>; rel="successor-version"');
    });

    it('GET /api/providers/:providerId should include correct Link header with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/providers/test-provider`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/providers/test-provider>; rel="successor-version"');
    });

    it('GET /api/workflows/drafts/:draftId should include correct Link header with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/workflows/drafts/draft-123`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/workflows/drafts/draft-123>; rel="successor-version"');
    });

    it('GET /api/triggers/schedules/:scheduleId should include correct Link header with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/triggers/schedules/schedule-123`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/triggers/schedules/schedule-123>; rel="successor-version"');
    });

    it('GET /api/connectors/:connectorId should include correct Link header with param substitution', async () => {
      const response = await fetch(`${baseUrl}/api/connectors/connector-123`, { redirect: 'manual', headers: { Cookie: ctx.authCookie } });
      expect(response.status).toBe(307);
      expect(response.headers.get('Deprecation')).toBe('true');
      expect(response.headers.get('Link')).toBe('</api/v1/connectors/connector-123>; rel="successor-version"');
    });
  });

  describe('V1 Routes Do Not Have Deprecation Headers', () => {
    it('GET /api/v1/health should not have Deprecation header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      expect(response.status).toBe(200);
      expect(response.headers.get('Deprecation')).toBeNull();
    });

    it('GET /api/v1/sessions should not have Deprecation header', async () => {
      const response = await fetch(`${baseUrl}/api/v1/sessions`, {
        headers: { Cookie: ctx.authCookie },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('Deprecation')).toBeNull();
    });
  });
});
