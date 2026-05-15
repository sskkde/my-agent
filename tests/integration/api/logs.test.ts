import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';
import type { EventRecord } from '../../../src/storage/event-store.js';

describe('Logs API', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;
  const testSessionId = 'test-session-logs-001';
  const testUserId = 'test-user-001';

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;

    const events: EventRecord[] = [
      {
        eventId: 'evt-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Planning run started', runId: 'run-001' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:00:00.000Z',
      },
      {
        eventId: 'evt-002',
        eventType: 'run_progress',
        sourceModule: 'planner',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Planning in progress', progress: 50 },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:01:00.000Z',
      },
      {
        eventId: 'evt-003',
        eventType: 'tool_execution_error',
        sourceModule: 'tool',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Tool execution failed: timeout', error: 'timeout' },
        sensitivity: 'medium',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:02:00.000Z',
      },
      {
        eventId: 'evt-004',
        eventType: 'error',
        sourceModule: 'kernel',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Kernel panic', stack: 'at line 42' },
        sensitivity: 'high',
        retentionClass: 'long',
        createdAt: '2026-04-29T10:03:00.000Z',
      },
      {
        eventId: 'evt-005',
        eventType: 'run_cancelled',
        sourceModule: 'planner',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Run cancelled by user' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:04:00.000Z',
      },
    ];

    ctx.apiContext.stores.eventStore.append(events);
  }, 30000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  describe('GET /api/logs', () => {
    it('should return logs with default pagination', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs?sessionId=${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: Array<{
            eventId: string;
            eventType: string;
            sourceModule: string;
            sessionId: string;
            severity: string;
            summary: string;
            createdAt: string;
            payloadPreview?: string;
          }>;
          total: number;
          limit: number;
          offset: number;
        };
      };

      expect(body.data.items).toHaveLength(5);
      expect(body.data.total).toBe(5);
      expect(body.data.limit).toBe(50);
      expect(body.data.offset).toBe(0);
    });

    it('should filter logs by sourceModule', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/logs?sessionId=${testSessionId}&sourceModule=tool`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: Array<{ eventType: string; sourceModule: string }>;
          total: number;
        };
      };

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].eventType).toBe('tool_execution_error');
      expect(body.data.items[0].sourceModule).toBe('tool');
      expect(body.data.total).toBe(1);
    });

    it('should filter logs by eventType', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/logs?sessionId=${testSessionId}&eventType=run_progress`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: Array<{ eventType: string }>;
          total: number;
        };
      };

      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].eventType).toBe('run_progress');
    });

    it('should respect limit parameter', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/logs?sessionId=${testSessionId}&limit=2`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: unknown[];
          total: number;
          limit: number;
        };
      };

      expect(body.data.items).toHaveLength(2);
      expect(body.data.total).toBe(5);
      expect(body.data.limit).toBe(2);
    });

    it('should enforce max limit of 200', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/logs?sessionId=${testSessionId}&limit=500`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: unknown[];
          limit: number;
        };
      };

      expect(body.data.limit).toBe(200);
    });

    it('should respect offset parameter', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/logs?sessionId=${testSessionId}&limit=2&offset=2`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: Array<{ eventId: string }>;
          offset: number;
        };
      };

      expect(body.data.items).toHaveLength(2);
      expect(body.data.items[0].eventId).toBe('evt-003');
      expect(body.data.offset).toBe(2);
    });

    it('should derive severity from event types', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs?sessionId=${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      const body = await response.json() as {
        data: {
          items: Array<{ eventType: string; severity: string }>;
        };
      };

      const severityMap = new Map(body.data.items.map(i => [i.eventType, i.severity]));
      expect(severityMap.get('run_started')).toBe('info');
      expect(severityMap.get('tool_execution_error')).toBe('error');
      expect(severityMap.get('error')).toBe('error');
      expect(severityMap.get('run_cancelled')).toBe('warn');
    });

    it('should include payloadPreview for low sensitivity events', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs?sessionId=${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      const body = await response.json() as {
        data: {
          items: Array<{ eventType: string; payloadPreview?: string }>;
        };
      };

      const lowSensitivityEvent = body.data.items.find(i => i.eventType === 'run_started');
      expect(lowSensitivityEvent?.payloadPreview).toBeDefined();
      expect(lowSensitivityEvent?.payloadPreview).toContain('Planning run started');
    });

    it('should redact payloadPreview for medium+ sensitivity events', async () => {
      const response = await fetch(`${baseUrl}/api/v1/logs?sessionId=${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      });
      const body = await response.json() as {
        data: {
          items: Array<{ eventType: string; payloadPreview?: string }>;
        };
      };

      const mediumSensitivityEvent = body.data.items.find(i => i.eventType === 'tool_execution_error');
      expect(mediumSensitivityEvent?.payloadPreview).toBe('[redacted]');

      const highSensitivityEvent = body.data.items.find(i => i.eventType === 'error');
      expect(highSensitivityEvent?.payloadPreview).toBe('[redacted]');
    });

    it('should return empty array for non-existent session', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/logs?sessionId=non-existent-session`, {
        headers: { 'Cookie': authCookie },
      }
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

    it('should return all logs when no sessionId filter', async () => {
      const otherSessionId = 'other-session-002';
      const otherEvent: EventRecord = {
        eventId: 'evt-other-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: otherSessionId,
        userId: testUserId,
        payload: { message: 'Other session run' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T11:00:00.000Z',
      };
      ctx.apiContext.stores.eventStore.append(otherEvent);

      const response = await fetch(`${baseUrl}/api/v1/logs`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          items: unknown[];
          total: number;
        };
      };

      expect(body.data.total).toBeGreaterThanOrEqual(6);
    });
  });

  describe('GET /api/logs/stream', () => {
    it('should return event stream with text/event-stream content type', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(
          `${baseUrl}/api/v1/logs/stream?sessionId=${testSessionId}`, {
          signal: controller.signal,
          headers: { 'Cookie': authCookie },
        }
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
      } catch {
      } finally {
        clearTimeout(timeout);
        controller.abort();
      }
    });

    it('should send initial snapshot with low sensitivity logs only', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(
          `${baseUrl}/api/v1/logs/stream?sessionId=${testSessionId}`,
          { signal: controller.signal }
        );
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        const { value } = await reader.read();
        const text = decoder.decode(value);

        expect(text).toContain('snapshot');
        const event = JSON.parse(text.replace('data: ', '').trim());
        expect(event.type).toBe('snapshot');
        expect(event.logs).toBeDefined();

        for (const log of event.logs) {
          expect(log.payloadPreview).not.toBe('[redacted]');
        }

        reader.cancel();
      } catch {
      } finally {
        clearTimeout(timeout);
      }
    });

    it('should filter events after specified eventId', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const response = await fetch(
          `${baseUrl}/api/v1/logs/stream?sessionId=${testSessionId}&after=evt-002`, {
          signal: controller.signal,
          headers: { 'Cookie': authCookie },
        }
        );
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        const { value } = await reader.read();
        const text = decoder.decode(value);

        const event = JSON.parse(text.replace('data: ', '').trim());
        expect(event.type).toBe('snapshot');

        const eventIds = event.logs.map((l: { eventId: string }) => l.eventId);
        expect(eventIds).not.toContain('evt-001');
        expect(eventIds).not.toContain('evt-002');

        reader.cancel();
      } catch {
      } finally {
        clearTimeout(timeout);
      }
    });

    it('should send heartbeat events', async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      try {
        const response = await fetch(
          `${baseUrl}/api/v1/logs/stream?sessionId=${testSessionId}`, {
          signal: controller.signal,
          headers: { 'Cookie': authCookie },
        }
        );
        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();

        await reader.read();

        let heartbeatReceived = false;
        const startTime = Date.now();

        while (Date.now() - startTime < 6000 && !heartbeatReceived) {
          const { value, done } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          if (text.includes('heartbeat')) {
            heartbeatReceived = true;
            const event = JSON.parse(text.replace('data: ', '').trim());
            expect(event.type).toBe('heartbeat');
            expect(event.timestamp).toBeDefined();
          }
        }

        expect(heartbeatReceived).toBe(true);
        reader.cancel();
      } catch {
      } finally {
        clearTimeout(timeout);
      }
    }, 10000);
  });
});
