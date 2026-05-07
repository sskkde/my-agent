import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';
import type { EventRecord } from '../../../src/storage/event-store.js';

describe('Logs & Debug API - Extended', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;
  const testSessionId = 'test-session-logs-debug-001';
  const testUserId = 'test-user-001';

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;

    const events: EventRecord[] = [
      {
        eventId: 'evt-ld-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Planning run started', apiKey: 'sk-secret123' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:00:00.000Z',
        relatedRefs: {
          runId: 'run-ld-001',
          plannerRunId: 'planner-run-ld-001',
        },
      },
      {
        eventId: 'evt-ld-002',
        eventType: 'approval_requested',
        sourceModule: 'permission',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Approval requested', token: 'bearer-xyz' },
        sensitivity: 'high',
        retentionClass: 'long',
        createdAt: '2026-04-29T10:01:00.000Z',
        relatedRefs: {
          approvalId: 'approval-ld-001',
        },
      },
      {
        eventId: 'evt-ld-003',
        eventType: 'run_progress',
        sourceModule: 'planner',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Run in progress', progress: 50 },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:02:00.000Z',
        relatedRefs: {
          runId: 'run-ld-001',
        },
      },
      {
        eventId: 'evt-ld-004',
        eventType: 'workflow_started',
        sourceModule: 'workflow',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Workflow started' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:03:00.000Z',
        relatedRefs: {
          workflowRunId: 'workflow-run-ld-001',
        },
      },
    ];

    ctx.apiContext.stores.eventStore.append(events);
  }, 30000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  describe('GET /api/debug/replay/:sessionId - redactedPreviews', () => {
    it('should return redactedPreviews array in replay response', async () => {
      const response = await fetch(
        `${baseUrl}/api/debug/replay/${testSessionId}`,
        { headers: { 'Cookie': authCookie } }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          redactedPreviews: Array<{
            eventId: string;
            eventType: string;
            preview: string;
          }>;
        };
      };

      expect(body.data.redactedPreviews).toBeDefined();
      expect(Array.isArray(body.data.redactedPreviews)).toBe(true);
      expect(body.data.redactedPreviews.length).toBeGreaterThan(0);
    });

    it('should redact sensitive fields in low sensitivity previews', async () => {
      const response = await fetch(
        `${baseUrl}/api/debug/replay/${testSessionId}`,
        { headers: { 'Cookie': authCookie } }
      );
      const body = await response.json() as {
        data: {
          redactedPreviews: Array<{
            eventId: string;
            eventType: string;
            preview: string;
          }>;
        };
      };

      const lowSensitivityPreview = body.data.redactedPreviews.find(
        (p) => p.eventId === 'evt-ld-001'
      );
      expect(lowSensitivityPreview).toBeDefined();
      expect(lowSensitivityPreview!.preview).toContain('[redacted]');
      expect(lowSensitivityPreview!.preview).not.toContain('sk-secret123');
    });

    it('should fully redact high sensitivity previews', async () => {
      const response = await fetch(
        `${baseUrl}/api/debug/replay/${testSessionId}`,
        { headers: { 'Cookie': authCookie } }
      );
      const body = await response.json() as {
        data: {
          redactedPreviews: Array<{
            eventId: string;
            eventType: string;
            preview: string;
          }>;
        };
      };

      const highSensitivityPreview = body.data.redactedPreviews.find(
        (p) => p.eventId === 'evt-ld-002'
      );
      expect(highSensitivityPreview).toBeDefined();
      expect(highSensitivityPreview!.preview).toBe('[redacted]');
    });

    it('should return all event previews', async () => {
      const manyEventsSessionId = 'test-session-many-events';
      const events: EventRecord[] = [];
      for (let i = 0; i < 15; i++) {
        events.push({
          eventId: `evt-many-${String(i).padStart(3, '0')}`,
          eventType: 'run_progress',
          sourceModule: 'planner',
          sessionId: manyEventsSessionId,
          userId: testUserId,
          payload: { message: `Event ${i}` },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: `2026-04-29T10:${String(i).padStart(2, '0')}:00.000Z`,
        });
      }
      ctx.apiContext.stores.eventStore.append(events);

      const response = await fetch(
        `${baseUrl}/api/debug/replay/${manyEventsSessionId}`,
        { headers: { 'Cookie': authCookie } }
      );
      const body = await response.json() as {
        data: {
          redactedPreviews: Array<{ eventId: string }>;
        };
      };

      expect(body.data.redactedPreviews.length).toBe(10);
    });
  });

  describe('GET /api/logs - runRef filter', () => {
    it('should filter logs by runRef', async () => {
      const response = await fetch(
        `${baseUrl}/api/logs?sessionId=${testSessionId}&runRef=run-ld-001`,
        { headers: { 'Cookie': authCookie } }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: Array<{ eventId: string; eventType: string }>;
          total: number;
        };
      };

      expect(body.data.items.length).toBe(2);
      expect(body.data.items.map((i) => i.eventId)).toContain('evt-ld-001');
      expect(body.data.items.map((i) => i.eventId)).toContain('evt-ld-003');
      expect(body.data.total).toBe(2);
    });

    it('should return empty when runRef matches no events', async () => {
      const response = await fetch(
        `${baseUrl}/api/logs?sessionId=${testSessionId}&runRef=non-existent-run`,
        { headers: { 'Cookie': authCookie } }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: unknown[];
          total: number;
        };
      };

      expect(body.data.items).toEqual([]);
      expect(body.data.total).toBe(0);
    });

    it('should combine runRef with other filters', async () => {
      const response = await fetch(
        `${baseUrl}/api/logs?sessionId=${testSessionId}&runRef=run-ld-001&eventType=run_started`,
        { headers: { 'Cookie': authCookie } }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: Array<{ eventId: string; eventType: string }>;
          total: number;
        };
      };

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].eventId).toBe('evt-ld-001');
    });
  });
});
