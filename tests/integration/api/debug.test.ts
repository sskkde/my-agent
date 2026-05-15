import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';
import type { EventRecord } from '../../../src/storage/event-store.js';
import type { TurnTranscript } from '../../../src/storage/transcript-store.js';

describe('Debug API', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;
  const testSessionId = 'test-session-debug-001';
  const testUserId = 'test-user-001';

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;

    const events: EventRecord[] = [
      {
        eventId: 'evt-debug-001',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Planning run started' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:00:00.000Z',
        relatedRefs: {
          plannerRunId: 'planner-run-001',
          runId: 'run-001',
        },
      },
      {
        eventId: 'evt-debug-002',
        eventType: 'approval_requested',
        sourceModule: 'permission',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Approval requested for sensitive action' },
        sensitivity: 'high',
        retentionClass: 'long',
        createdAt: '2026-04-29T10:01:00.000Z',
        relatedRefs: {
          approvalId: 'approval-001',
        },
      },
      {
        eventId: 'evt-debug-003',
        eventType: 'workflow_started',
        sourceModule: 'workflow',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Workflow started' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:02:00.000Z',
        relatedRefs: {
          workflowRunId: 'workflow-run-001',
        },
      },
      {
        eventId: 'evt-debug-004',
        eventType: 'background_task_started',
        sourceModule: 'subagent',
        sessionId: testSessionId,
        userId: testUserId,
        payload: { message: 'Background task started' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T10:03:00.000Z',
        relatedRefs: {
          backgroundRunId: 'bg-run-001',
          subagentRunId: 'subagent-run-001',
        },
      },
    ];

    ctx.apiContext.stores.eventStore.append(events);

    const transcript: TurnTranscript = {
      turnId: 'turn-debug-001',
      sessionId: testSessionId,
      userId: testUserId,
      input: {
        userMessageSummary: 'Debug test message',
        inboundEventId: 'evt-debug-000',
      },
      output: {
        visibleMessages: [
          { messageId: 'msg-001', role: 'assistant', content: 'Debug response' },
        ],
      },
      runtimeSummary: {
        plannerRunIds: ['planner-run-002'],
        toolCallSummaries: ['Tool call summary'],
      },
      visibility: 'public',
      createdAt: '2026-04-29T10:00:30.000Z',
    };

    ctx.apiContext.stores.transcriptStore.saveTurn(transcript);
  }, 30000);

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  }, 30000);

  describe('GET /api/debug/replay/:sessionId', () => {
    it('should return replay summary for existing session', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          eventCount: number;
          transcriptCount: number;
          runRefs: string[];
          approvalRefs: string[];
          lastEventId: string | null;
        };
      };

      expect(body.data.eventCount).toBe(4);
      expect(body.data.transcriptCount).toBe(1);
      expect(body.data.lastEventId).toBe('evt-debug-004');
    });

    it('should aggregate run references from events', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      }
      );
      const body = await response.json() as {
        data: { runRefs: string[] };
      };

      expect(body.data.runRefs).toContain('planner-run-001');
      expect(body.data.runRefs).toContain('run-001');
      expect(body.data.runRefs).toContain('workflow-run-001');
      expect(body.data.runRefs).toContain('bg-run-001');
      expect(body.data.runRefs).toContain('subagent-run-001');
      expect(body.data.runRefs).toContain('planner-run-002');
    });

    it('should aggregate approval references from events', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      }
      );
      const body = await response.json() as {
        data: { approvalRefs: string[] };
      };

      expect(body.data.approvalRefs).toContain('approval-001');
    });

    it('should return 404 for non-existent session', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/non-existent-session`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(404);

      const body = await response.json() as {
        error: { code: string; message: string };
      };

      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toContain('Session not found');
    });

    it('should return empty arrays for session with no events', async () => {
      const emptySessionId = 'empty-session-001';
      const transcript: TurnTranscript = {
        turnId: 'turn-empty-001',
        sessionId: emptySessionId,
        userId: testUserId,
        input: { userMessageSummary: 'Empty session' },
        output: { visibleMessages: [] },
        visibility: 'public',
        createdAt: '2026-04-29T11:00:00.000Z',
      };

      ctx.apiContext.stores.transcriptStore.saveTurn(transcript);

      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/${emptySessionId}`, {
        headers: { 'Cookie': authCookie },
      }
      );
      expect(response.status).toBe(200);

      const body = await response.json() as {
        data: {
          eventCount: number;
          transcriptCount: number;
          runRefs: string[];
          approvalRefs: string[];
          lastEventId: string | null;
        };
      };

      expect(body.data.eventCount).toBe(0);
      expect(body.data.transcriptCount).toBe(1);
      expect(body.data.runRefs).toEqual([]);
      expect(body.data.approvalRefs).toEqual([]);
      expect(body.data.lastEventId).toBeNull();
    });

    it('should deduplicate run references', async () => {
      const dedupeSessionId = 'dedupe-session-001';
      const events: EventRecord[] = [
        {
          eventId: 'evt-dedupe-001',
          eventType: 'run_started',
          sourceModule: 'planner',
          sessionId: dedupeSessionId,
          userId: testUserId,
          payload: { message: 'First event' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2026-04-29T12:00:00.000Z',
          relatedRefs: {
            runId: 'same-run-id',
          },
        },
        {
          eventId: 'evt-dedupe-002',
          eventType: 'run_progress',
          sourceModule: 'planner',
          sessionId: dedupeSessionId,
          userId: testUserId,
          payload: { message: 'Second event' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2026-04-29T12:01:00.000Z',
          relatedRefs: {
            runId: 'same-run-id',
          },
        },
      ];

      ctx.apiContext.stores.eventStore.append(events);

      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/${dedupeSessionId}`, {
        headers: { 'Cookie': authCookie },
      }
      );
      const body = await response.json() as {
        data: { runRefs: string[] };
      };

      const runIdCount = body.data.runRefs.filter(id => id === 'same-run-id').length;
      expect(runIdCount).toBe(1);
    });

    it('should collect plannerRunIds from transcript runtimeSummary', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      }
      );
      const body = await response.json() as {
        data: { runRefs: string[] };
      };

      expect(body.data.runRefs).toContain('planner-run-002');
    });

    it('should return metadata only without raw content', async () => {
      const response = await fetch(
        `${baseUrl}/api/v1/debug/replay/${testSessionId}`, {
        headers: { 'Cookie': authCookie },
      }
      );
      const body = await response.json() as {
        data: Record<string, unknown>;
      };

      expect(body.data.eventCount).toBeDefined();
      expect(body.data.transcriptCount).toBeDefined();
      expect(body.data.runRefs).toBeDefined();
      expect(body.data.approvalRefs).toBeDefined();
      expect(body.data.lastEventId).toBeDefined();

      expect(body.data.events).toBeUndefined();
      expect(body.data.transcripts).toBeUndefined();
      expect(body.data.payloads).toBeUndefined();
    });
  });
});
